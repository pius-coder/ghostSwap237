#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <aclapi.h>
#include <process.h>
#include <sddl.h>
#include <shlobj.h>
#include <stddef.h>
#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include <algorithm>
#include <vector>

#include "../driver/include/henshin_bridge.h"
#include "../driver/include/vcam_ids.h"

// Stdin frame header (40 bytes). Renderer sends RGBA; we convert to NV12.
static constexpr uint32_t kPipeMagic = 0x484E5348;  // "HNSH"
static constexpr uint32_t kPipeVersion = 1;
static constexpr uint32_t kPipeHeaderBytes = 40;
static constexpr DWORD kHeartbeatPeriodMs = 100;  // 10 Hz, independent of stdin / output clock
static constexpr uint32_t kOutputFps = HENSHIN_VCAM_FPS_NUM;

static const wchar_t kBridgeSddl[] =
    L"D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;LS)(A;;GA;;;AU)";

#pragma pack(push, 1)
struct PipeFrameHeader {
  uint32_t magic;
  uint32_t version;
  uint32_t width;
  uint32_t height;
  uint32_t stride;
  uint32_t fps;
  uint32_t flags;
  uint32_t payload_bytes;
  int64_t timestamp_hns;
};
#pragma pack(pop)
static_assert(sizeof(PipeFrameHeader) == 40, "pipe header is 40 bytes");
static_assert(kPipeHeaderBytes == sizeof(PipeFrameHeader), "pipe header size");

struct Layout {
  uint32_t width;
  uint32_t height;
  uint32_t stride_y;
  uint32_t stride_uv;
  uint32_t offset_y;
  uint32_t offset_uv;
  uint32_t frame_payload_size;
  uint64_t y_bytes;
  uint64_t uv_bytes;
  uint64_t slot_stride;
  uint64_t total_size;
};

struct Publisher {
  Layout layout{};
  uint8_t* view = nullptr;
  HANDLE stop = nullptr;
  CRITICAL_SECTION lock{};
  std::vector<uint8_t> last_nv12;
  std::vector<uint8_t> staging_nv12;
  uint64_t slot_seq[SLOT_COUNT]{};
  uint64_t frame_id = 1;
  uint64_t capture_qpc = 0;
  uint64_t qpc_freq = 0;
  bool have_frame = false;
  bool fresh = false;
};

static Layout ComputeLayout() {
  Layout L{};
  L.width = HENSHIN_VCAM_WIDTH;
  L.height = HENSHIN_VCAM_HEIGHT;
  L.stride_y = HENSHIN_VCAM_WIDTH;
  L.stride_uv = HENSHIN_VCAM_WIDTH;
  L.y_bytes = uint64_t(L.stride_y) * L.height;
  L.uv_bytes = uint64_t(L.stride_uv) * (L.height / 2);
  L.offset_y = SLOT_HEADER_SIZE;
  L.offset_uv = uint32_t(L.offset_y + L.y_bytes);
  L.frame_payload_size = uint32_t(L.y_bytes + L.uv_bytes);
  const uint64_t used = uint64_t(L.offset_uv) + L.uv_bytes;
  L.slot_stride = (used + 63) & ~uint64_t(63);
  L.total_size = uint64_t(HEADER_SIZE) + SLOT_COUNT * L.slot_stride;
  return L;
}

static bool ApplySddl(HANDLE object, SE_OBJECT_TYPE type) {
  PSECURITY_DESCRIPTOR sd = nullptr;
  if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(kBridgeSddl, SDDL_REVISION_1, &sd,
                                                            nullptr)) {
    return false;
  }
  BOOL present = FALSE, defaulted = FALSE;
  PACL dacl = nullptr;
  if (GetSecurityDescriptorDacl(sd, &present, &dacl, &defaulted) && present && dacl) {
    SetSecurityInfo(object, type, DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                    nullptr, nullptr, dacl, nullptr);
  }
  LocalFree(sd);
  return true;
}

static bool CameraDir(wchar_t* out, size_t cap) {
  PWSTR program_data = nullptr;
  if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_ProgramData, 0, nullptr, &program_data))) {
    swprintf_s(out, cap, L"%s\\Henshin\\Camera", program_data);
    CoTaskMemFree(program_data);
    return true;
  }
  swprintf_s(out, cap, L"C:\\ProgramData\\Henshin\\Camera");
  return true;
}

static uint64_t QpcNow() {
  LARGE_INTEGER v{};
  QueryPerformanceCounter(&v);
  return uint64_t(v.QuadPart);
}

static uint64_t QpcFreq() {
  LARGE_INTEGER v{};
  QueryPerformanceFrequency(&v);
  return uint64_t(v.QuadPart);
}

static uint64_t LoadAcquire64(const volatile uint64_t* p) {
  MemoryBarrier();
  const uint64_t v = *p;
  MemoryBarrier();
  return v;
}

static void StoreRelease64(volatile uint64_t* p, uint64_t v) {
  MemoryBarrier();
  *p = v;
  MemoryBarrier();
}

static uint32_t LoadU32(const uint8_t* base, size_t off) {
  uint32_t v = 0;
  memcpy(&v, base + off, sizeof(v));
  return v;
}

static uint16_t LoadU16(const uint8_t* base, size_t off) {
  uint16_t v = 0;
  memcpy(&v, base + off, sizeof(v));
  return v;
}

static uint64_t LoadU64(const uint8_t* base, size_t off) {
  uint64_t v = 0;
  memcpy(&v, base + off, sizeof(v));
  return v;
}

static bool HeaderLooksValid(const uint8_t* view, const Layout& layout) {
  return LoadU32(view, offsetof(BridgeHeader, magic)) == MAGIC &&
         LoadU16(view, offsetof(BridgeHeader, protocol_major)) == PROTOCOL_MAJOR &&
         LoadU32(view, offsetof(BridgeHeader, header_size)) == HEADER_SIZE &&
         LoadU32(view, offsetof(BridgeHeader, slot_count)) == SLOT_COUNT &&
         LoadU64(view, offsetof(BridgeHeader, total_mapping_size)) == layout.total_size &&
         LoadU32(view, offsetof(BridgeHeader, width)) == layout.width &&
         LoadU32(view, offsetof(BridgeHeader, height)) == layout.height &&
         LoadU32(view, offsetof(BridgeHeader, pixel_format)) == PIXEL_FORMAT_NV12;
}

// OPEN_ALWAYS / OPEN_EXISTING like vcam-register. Never CREATE_ALWAYS.
// If the file is already layout.total_size, do not SetEndOfFile (1224 when mapped).
static HANDLE OpenBridgeFile(const wchar_t* path, SECURITY_ATTRIBUTES* sa, const Layout& layout) {
  HANDLE file = CreateFileW(path, GENERIC_READ | GENERIC_WRITE,
                            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, sa, OPEN_ALWAYS,
                            FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) {
    const DWORD always_err = GetLastError();
    file = CreateFileW(path, GENERIC_READ | GENERIC_WRITE,
                       FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, sa, OPEN_EXISTING,
                       FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) {
      fwprintf(stderr, L"[vcam-publisher] CreateFile failed %lu (OPEN_ALWAYS %lu)\n", GetLastError(),
               always_err);
      return INVALID_HANDLE_VALUE;
    }
  }

  LARGE_INTEGER existing{};
  if (!GetFileSizeEx(file, &existing)) {
    fwprintf(stderr, L"[vcam-publisher] GetFileSizeEx failed %lu\n", GetLastError());
    CloseHandle(file);
    return INVALID_HANDLE_VALUE;
  }

  const uint64_t have = uint64_t(existing.QuadPart);
  if (have == layout.total_size) {
    return file;
  }

  // Grow a brand-new or undersized file. Never shrink a live mapping.
  if (have > layout.total_size) {
    fwprintf(stderr,
             L"[vcam-publisher] mapping file larger than layout (%llu > %llu); not truncating\n",
             have, layout.total_size);
    return file;
  }

  LARGE_INTEGER size{};
  size.QuadPart = LONGLONG(layout.total_size);
  if (!SetFilePointerEx(file, size, nullptr, FILE_BEGIN) || !SetEndOfFile(file)) {
    const DWORD err = GetLastError();
    fwprintf(stderr, L"[vcam-publisher] SetEndOfFile failed %lu (have %llu want %llu)\n", err, have,
             layout.total_size);
    CloseHandle(file);
    return INVALID_HANDLE_VALUE;
  }
  return file;
}

// BT.709 limited-range RGBA (R,G,B,A) → NV12.
static void RgbaToNv12(const uint8_t* rgba, uint32_t src_stride, uint8_t* y_plane, uint32_t stride_y,
                       uint8_t* uv_plane, uint32_t stride_uv, uint32_t w, uint32_t h) {
  for (uint32_t row = 0; row < h; ++row) {
    const uint8_t* src = rgba + row * src_stride;
    uint8_t* y_row = y_plane + row * stride_y;
    for (uint32_t x = 0; x < w; ++x) {
      const int r = src[x * 4 + 0];
      const int g = src[x * 4 + 1];
      const int b = src[x * 4 + 2];
      int y = (47 * r + 157 * g + 16 * b + 128) >> 8;
      y_row[x] = uint8_t(std::clamp(y + 16, 16, 235));
    }
  }
  for (uint32_t row = 0; row < h; row += 2) {
    const uint8_t* src0 = rgba + row * src_stride;
    const uint8_t* src1 = rgba + (row + 1) * src_stride;
    uint8_t* uv_row = uv_plane + (row / 2) * stride_uv;
    for (uint32_t x = 0; x < w; x += 2) {
      int r = (src0[x * 4] + src0[(x + 1) * 4] + src1[x * 4] + src1[(x + 1) * 4]) / 4;
      int g = (src0[x * 4 + 1] + src0[(x + 1) * 4 + 1] + src1[x * 4 + 1] + src1[(x + 1) * 4 + 1]) / 4;
      int b = (src0[x * 4 + 2] + src0[(x + 1) * 4 + 2] + src1[x * 4 + 2] + src1[(x + 1) * 4 + 2]) / 4;
      int u = ((-26 * r - 87 * g + 112 * b + 128) >> 8) + 128;
      int v = ((112 * r - 102 * g - 10 * b + 128) >> 8) + 128;
      uv_row[x] = uint8_t(std::clamp(u, 16, 240));
      uv_row[x + 1] = uint8_t(std::clamp(v, 16, 240));
    }
  }
}

static bool ReadFull(HANDLE in, void* buf, DWORD n) {
  uint8_t* p = static_cast<uint8_t*>(buf);
  DWORD got_total = 0;
  while (got_total < n) {
    DWORD got = 0;
    if (!ReadFile(in, p + got_total, n - got_total, &got, nullptr) || got == 0) {
      return false;
    }
    got_total += got;
  }
  return true;
}

static void WriteHeartbeat(uint8_t* view) {
  StoreRelease64(reinterpret_cast<volatile uint64_t*>(view + offsetof(BridgeHeader, heartbeat_qpc)),
                 QpcNow());
}

static void PatchOrInitHeader(uint8_t* view, const Layout& layout, uint64_t qpc_freq,
                              uint64_t* frame_id) {
  const uint32_t pid = GetCurrentProcessId();
  uint64_t generation = 1;
  uint64_t published = 0;
  if (HeaderLooksValid(view, layout)) {
    generation = LoadU64(view, offsetof(BridgeHeader, generation)) + 1;
    if (generation == 0) generation = 1;
    published = LoadU64(view, offsetof(BridgeHeader, published_frame_id));
  } else {
    BridgeHeader header{};
    header.magic = MAGIC;
    header.protocol_major = PROTOCOL_MAJOR;
    header.protocol_minor = PROTOCOL_MINOR;
    header.header_size = HEADER_SIZE;
    header.slot_count = SLOT_COUNT;
    header.total_mapping_size = layout.total_size;
    header.slot_stride_bytes = layout.slot_stride;
    header.capacity_width = layout.width;
    header.capacity_height = layout.height;
    header.pixel_format = PIXEL_FORMAT_NV12;
    header.width = layout.width;
    header.height = layout.height;
    header.fps_num = HENSHIN_VCAM_FPS_NUM;
    header.fps_den = HENSHIN_VCAM_FPS_DEN;
    header.stride_y = layout.stride_y;
    header.stride_uv = layout.stride_uv;
    header.offset_y_within_slot = layout.offset_y;
    header.offset_uv_within_slot = layout.offset_uv;
    header.frame_payload_size = layout.frame_payload_size;
    header.color_matrix = COLOR_MATRIX_BT709;
    header.color_range = COLOR_RANGE_LIMITED;
    header.qpc_frequency = qpc_freq;
    memcpy(view, &header, sizeof(header));
  }

  memcpy(view + offsetof(BridgeHeader, producer_pid), &pid, sizeof(pid));
  memcpy(view + offsetof(BridgeHeader, qpc_frequency), &qpc_freq, sizeof(qpc_freq));
  StoreRelease64(reinterpret_cast<volatile uint64_t*>(view + offsetof(BridgeHeader, generation)),
                 generation);
  WriteHeartbeat(view);
  *frame_id = published + 1;
  if (*frame_id == 0) *frame_id = 1;
}

static void PublishSlot(Publisher* p, uint32_t flags, uint64_t capture_qpc, uint64_t publish_qpc,
                        const uint8_t* nv12) {
  const uint64_t frame_id = p->frame_id;
  const uint32_t slot = uint32_t(frame_id % SLOT_COUNT);
  uint8_t* slot_base = p->view + HEADER_SIZE + slot * p->layout.slot_stride;
  volatile uint64_t* seq = reinterpret_cast<volatile uint64_t*>(slot_base);
  const uint64_t odd = p->slot_seq[slot] | 1ull;
  StoreRelease64(seq, odd);

  memcpy(slot_base + offsetof(SlotHeader, frame_id), &frame_id, sizeof(frame_id));
  memcpy(slot_base + offsetof(SlotHeader, capture_qpc), &capture_qpc, sizeof(capture_qpc));
  memcpy(slot_base + offsetof(SlotHeader, publish_qpc), &publish_qpc, sizeof(publish_qpc));
  memcpy(slot_base + offsetof(SlotHeader, payload_size), &p->layout.frame_payload_size,
         sizeof(uint32_t));
  memcpy(slot_base + offsetof(SlotHeader, flags), &flags, sizeof(flags));

  memcpy(slot_base + p->layout.offset_y, nv12, static_cast<size_t>(p->layout.y_bytes));
  memcpy(slot_base + p->layout.offset_uv, nv12 + p->layout.y_bytes,
         static_cast<size_t>(p->layout.uv_bytes));

  const uint64_t even = odd + 1;
  StoreRelease64(seq, even);
  p->slot_seq[slot] = even;

  StoreRelease64(
      reinterpret_cast<volatile uint64_t*>(p->view + offsetof(BridgeHeader, published_frame_id)),
      frame_id);
  p->frame_id = frame_id + 1;
}

static unsigned __stdcall HeartbeatThread(void* arg) {
  Publisher* p = static_cast<Publisher*>(arg);
  for (;;) {
    if (WaitForSingleObject(p->stop, 0) == WAIT_OBJECT_0) break;
    WriteHeartbeat(p->view);
    if (WaitForSingleObject(p->stop, kHeartbeatPeriodMs) == WAIT_OBJECT_0) break;
  }
  return 0;
}

static unsigned __stdcall ClockThread(void* arg) {
  Publisher* p = static_cast<Publisher*>(arg);
  const uint64_t period = p->qpc_freq / kOutputFps;
  uint64_t next = QpcNow();
  while (WaitForSingleObject(p->stop, 0) != WAIT_OBJECT_0) {
    const uint64_t publish_qpc = QpcNow();
    EnterCriticalSection(&p->lock);
    const uint32_t flags = (p->have_frame && p->fresh) ? 0u : SLOT_FLAG_REPEATED;
    const uint64_t capture_qpc = p->have_frame ? p->capture_qpc : publish_qpc;
    p->fresh = false;
    PublishSlot(p, flags, capture_qpc, publish_qpc, p->last_nv12.data());
    LeaveCriticalSection(&p->lock);

    next += period;
    const uint64_t now = QpcNow();
    if (now > next) {
      next = now;
      continue;
    }
    const uint64_t remain = next - now;
    DWORD ms = DWORD((remain * 1000ull) / p->qpc_freq);
    if (ms == 0) ms = 1;
    if (WaitForSingleObject(p->stop, ms) == WAIT_OBJECT_0) break;
  }
  return 0;
}

static unsigned __stdcall StdinThread(void* arg) {
  Publisher* p = static_cast<Publisher*>(arg);
  HANDLE stdin_h = GetStdHandle(STD_INPUT_HANDLE);
  const uint32_t rgba_bytes = p->layout.width * p->layout.height * 4;
  std::vector<uint8_t> rgba(rgba_bytes);
  std::vector<uint8_t> junk;

  while (WaitForSingleObject(p->stop, 0) != WAIT_OBJECT_0) {
    PipeFrameHeader pipe{};
    if (!ReadFull(stdin_h, &pipe, sizeof(pipe))) break;
    if (pipe.magic != kPipeMagic || pipe.version != kPipeVersion) {
      fwprintf(stderr, L"[vcam-publisher] bad pipe header magic=%08x\n", pipe.magic);
      break;
    }
    if (pipe.payload_bytes != rgba_bytes) {
      junk.resize(pipe.payload_bytes);
      if (!ReadFull(stdin_h, junk.data(), pipe.payload_bytes)) break;
      continue;
    }
    if (!ReadFull(stdin_h, rgba.data(), rgba_bytes)) break;

    RgbaToNv12(rgba.data(), p->layout.width * 4, p->staging_nv12.data(), p->layout.stride_y,
               p->staging_nv12.data() + p->layout.y_bytes, p->layout.stride_uv, p->layout.width,
               p->layout.height);

    EnterCriticalSection(&p->lock);
    p->last_nv12.swap(p->staging_nv12);
    p->capture_qpc = QpcNow();
    p->have_frame = true;
    p->fresh = true;
    LeaveCriticalSection(&p->lock);
  }
  return 0;
}

static HANDLE g_stop = nullptr;

static BOOL WINAPI OnCtrl(DWORD type) {
  if (type == CTRL_C_EVENT || type == CTRL_BREAK_EVENT || type == CTRL_CLOSE_EVENT) {
    if (g_stop) SetEvent(g_stop);
    return TRUE;
  }
  return FALSE;
}

int wmain() {
  setvbuf(stderr, nullptr, _IONBF, 0);

  Publisher pub{};
  pub.layout = ComputeLayout();
  pub.qpc_freq = QpcFreq();
  pub.last_nv12.assign(pub.layout.frame_payload_size, 0);
  pub.staging_nv12.assign(pub.layout.frame_payload_size, 0);
  InitializeCriticalSection(&pub.lock);

  wchar_t dir[MAX_PATH * 2]{};
  CameraDir(dir, ARRAYSIZE(dir));
  CreateDirectoryW(L"C:\\ProgramData\\Henshin", nullptr);
  CreateDirectoryW(dir, nullptr);

  wchar_t path[MAX_PATH * 2]{};
  swprintf_s(path, L"%s\\camera-buffer.bin", dir);

  SECURITY_ATTRIBUTES sa{};
  sa.nLength = sizeof(sa);
  ConvertStringSecurityDescriptorToSecurityDescriptorW(kBridgeSddl, SDDL_REVISION_1,
                                                       &sa.lpSecurityDescriptor, nullptr);

  HANDLE file = OpenBridgeFile(path, &sa, pub.layout);
  if (file == INVALID_HANDLE_VALUE) {
    if (sa.lpSecurityDescriptor) LocalFree(sa.lpSecurityDescriptor);
    DeleteCriticalSection(&pub.lock);
    return 1;
  }
  ApplySddl(file, SE_FILE_OBJECT);

  HANDLE mapping = CreateFileMappingW(file, &sa, PAGE_READWRITE, 0, 0, nullptr);
  if (!mapping) {
    fwprintf(stderr, L"[vcam-publisher] CreateFileMapping failed %lu\n", GetLastError());
    CloseHandle(file);
    if (sa.lpSecurityDescriptor) LocalFree(sa.lpSecurityDescriptor);
    DeleteCriticalSection(&pub.lock);
    return 1;
  }
  pub.view = static_cast<uint8_t*>(MapViewOfFile(mapping, FILE_MAP_WRITE, 0, 0, 0));
  if (!pub.view) {
    fwprintf(stderr, L"[vcam-publisher] MapViewOfFile failed %lu\n", GetLastError());
    CloseHandle(mapping);
    CloseHandle(file);
    if (sa.lpSecurityDescriptor) LocalFree(sa.lpSecurityDescriptor);
    DeleteCriticalSection(&pub.lock);
    return 1;
  }

  // Never ZeroMemory the live mapping: DLL readers would see magic=0.

  for (uint32_t i = 0; i < SLOT_COUNT; ++i) {
    const uint8_t* slot_base = pub.view + HEADER_SIZE + i * pub.layout.slot_stride;
    pub.slot_seq[i] =
        LoadAcquire64(reinterpret_cast<const volatile uint64_t*>(slot_base));
  }

  PatchOrInitHeader(pub.view, pub.layout, pub.qpc_freq, &pub.frame_id);

  pub.stop = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  g_stop = pub.stop;
  const uintptr_t hb = _beginthreadex(nullptr, 0, HeartbeatThread, &pub, 0, nullptr);
  const uintptr_t clock = _beginthreadex(nullptr, 0, ClockThread, &pub, 0, nullptr);
  const uintptr_t stdin_th = _beginthreadex(nullptr, 0, StdinThread, &pub, 0, nullptr);
  HANDLE hb_h = hb ? reinterpret_cast<HANDLE>(hb) : nullptr;
  HANDLE clock_h = clock ? reinterpret_cast<HANDLE>(clock) : nullptr;
  HANDLE stdin_h = stdin_th ? reinterpret_cast<HANDLE>(stdin_th) : nullptr;
  if (!pub.stop || !hb_h || !clock_h || !stdin_h) {
    fwprintf(stderr, L"[vcam-publisher] failed to start worker threads\n");
    if (pub.stop) SetEvent(pub.stop);
    if (hb_h) {
      WaitForSingleObject(hb_h, 2000);
      CloseHandle(hb_h);
    }
    if (clock_h) {
      WaitForSingleObject(clock_h, 2000);
      CloseHandle(clock_h);
    }
    if (stdin_h) {
      WaitForSingleObject(stdin_h, 200);
      CloseHandle(stdin_h);
    }
    if (pub.stop) CloseHandle(pub.stop);
    UnmapViewOfFile(pub.view);
    CloseHandle(mapping);
    CloseHandle(file);
    if (sa.lpSecurityDescriptor) LocalFree(sa.lpSecurityDescriptor);
    DeleteCriticalSection(&pub.lock);
    return 1;
  }

  SetConsoleCtrlHandler(OnCtrl, TRUE);

  fwprintf(stderr, L"[vcam-publisher] ready %ux%u mapping %llu bytes CLSID %s\n", pub.layout.width,
           pub.layout.height, pub.layout.total_size, HENSHIN_VCAM_CLSID_STRING);
  fflush(stderr);

  // Heartbeat + 30 Hz REPEAT keep running even if stdin is NUL / EOF.
  WaitForSingleObject(pub.stop, INFINITE);
  CancelSynchronousIo(stdin_h);
  WaitForSingleObject(hb_h, 2000);
  WaitForSingleObject(clock_h, 2000);
  WaitForSingleObject(stdin_h, 2000);

  CloseHandle(hb_h);
  CloseHandle(clock_h);
  CloseHandle(stdin_h);
  CloseHandle(pub.stop);
  g_stop = nullptr;
  UnmapViewOfFile(pub.view);
  CloseHandle(mapping);
  CloseHandle(file);
  if (sa.lpSecurityDescriptor) LocalFree(sa.lpSecurityDescriptor);
  DeleteCriticalSection(&pub.lock);
  return 0;
}
