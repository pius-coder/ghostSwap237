#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shlobj.h>
#include <stddef.h>
#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include <string>

#include "../driver/include/henshin_bridge.h"
#include "../driver/include/vcam_ids.h"

// Concurrent mapper: hold camera-buffer.bin read-only, then start/restart the
// publisher with no stdin frames. CREATE_ALWAYS / SetEndOfFile would yield 1224.

namespace {

struct Layout {
  uint64_t total_size;
};

Layout ComputeLayout() {
  Layout L{};
  const uint32_t stride_y = HENSHIN_VCAM_WIDTH;
  const uint32_t stride_uv = HENSHIN_VCAM_WIDTH;
  const uint64_t y_bytes = uint64_t(stride_y) * HENSHIN_VCAM_HEIGHT;
  const uint64_t uv_bytes = uint64_t(stride_uv) * (HENSHIN_VCAM_HEIGHT / 2);
  const uint32_t offset_y = SLOT_HEADER_SIZE;
  const uint32_t offset_uv = uint32_t(offset_y + y_bytes);
  const uint64_t used = uint64_t(offset_uv) + uv_bytes;
  const uint64_t slot_stride = (used + 63) & ~uint64_t(63);
  L.total_size = uint64_t(HEADER_SIZE) + SLOT_COUNT * slot_stride;
  return L;
}

int g_failures = 0;
int g_checks = 0;

void Check(bool ok, const char* what) {
  ++g_checks;
  if (ok) {
    std::printf("  ok %s\n", what);
  } else {
    ++g_failures;
    std::printf("  FAIL %s\n", what);
  }
}

bool ContainsAscii(const std::string& hay, const char* needle) {
  if (hay.find(needle) != std::string::npos) return true;
  std::string wide;
  for (const char* p = needle; *p; ++p) {
    wide.push_back(*p);
    wide.push_back('\0');
  }
  return hay.find(wide) != std::string::npos;
}

void CameraDir(wchar_t* out, size_t cap) {
  PWSTR pd = nullptr;
  if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_ProgramData, 0, nullptr, &pd))) {
    swprintf_s(out, cap, L"%s\\Henshin\\Camera", pd);
    CoTaskMemFree(pd);
    return;
  }
  swprintf_s(out, cap, L"C:\\ProgramData\\Henshin\\Camera");
}

bool EnsureSizedBuffer(const wchar_t* path, uint64_t total_size) {
  CreateDirectoryW(L"C:\\ProgramData\\Henshin", nullptr);
  wchar_t dir[MAX_PATH * 2]{};
  CameraDir(dir, ARRAYSIZE(dir));
  CreateDirectoryW(dir, nullptr);

  HANDLE file = CreateFileW(path, GENERIC_READ | GENERIC_WRITE,
                            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr,
                            OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) {
    std::printf("  FAIL EnsureSizedBuffer CreateFile %lu\n", GetLastError());
    return false;
  }
  LARGE_INTEGER have{};
  if (!GetFileSizeEx(file, &have)) {
    CloseHandle(file);
    return false;
  }
  if (uint64_t(have.QuadPart) != total_size) {
    LARGE_INTEGER size{};
    size.QuadPart = LONGLONG(total_size);
    if (!SetFilePointerEx(file, size, nullptr, FILE_BEGIN) || !SetEndOfFile(file)) {
      std::printf("  FAIL EnsureSizedBuffer SetEndOfFile %lu\n", GetLastError());
      CloseHandle(file);
      return false;
    }
  }
  CloseHandle(file);
  return true;
}

bool PublisherPath(wchar_t* out, size_t cap) {
  wchar_t self[MAX_PATH]{};
  if (!GetModuleFileNameW(nullptr, self, MAX_PATH)) return false;
  wchar_t* slash = wcsrchr(self, L'\\');
  if (!slash) return false;
  slash[1] = 0;
  swprintf_s(out, cap, L"%shenshin-vcam-publisher.exe", self);
  return GetFileAttributesW(out) != INVALID_FILE_ATTRIBUTES;
}

struct Child {
  PROCESS_INFORMATION pi{};
  HANDLE stderr_rd = nullptr;
  std::string err;

  ~Child() { Close(); }

  void Close() {
    if (pi.hProcess) {
      if (WaitForSingleObject(pi.hProcess, 0) != WAIT_OBJECT_0) {
        TerminateProcess(pi.hProcess, 1);
        WaitForSingleObject(pi.hProcess, 2000);
      }
      CloseHandle(pi.hProcess);
      pi.hProcess = nullptr;
    }
    if (pi.hThread) {
      CloseHandle(pi.hThread);
      pi.hThread = nullptr;
    }
    if (stderr_rd) {
      Drain();
      CloseHandle(stderr_rd);
      stderr_rd = nullptr;
    }
  }

  void Drain() {
    if (!stderr_rd) return;
    for (;;) {
      DWORD avail = 0;
      if (!PeekNamedPipe(stderr_rd, nullptr, 0, nullptr, &avail, nullptr) || avail == 0) break;
      char buf[1024];
      DWORD n = 0;
      const DWORD want = avail > sizeof(buf) ? DWORD(sizeof(buf)) : avail;
      if (!ReadFile(stderr_rd, buf, want, &n, nullptr) || n == 0) break;
      err.append(buf, n);
    }
  }

  bool Saw1224() const { return ContainsAscii(err, "1224") || ContainsAscii(err, "CreateFile failed"); }
};

bool StartPublisher(const wchar_t* exe, Child* child) {
  SECURITY_ATTRIBUTES inh{};
  inh.nLength = sizeof(inh);
  inh.bInheritHandle = TRUE;

  HANDLE nul = CreateFileW(L"NUL", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, &inh,
                           OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (nul == INVALID_HANDLE_VALUE) return false;

  HANDLE err_rd = nullptr;
  HANDLE err_wr = nullptr;
  if (!CreatePipe(&err_rd, &err_wr, &inh, 0)) {
    CloseHandle(nul);
    return false;
  }
  SetHandleInformation(err_rd, HANDLE_FLAG_INHERIT, 0);

  wchar_t cmd[MAX_PATH * 2]{};
  swprintf_s(cmd, L"\"%s\"", exe);

  STARTUPINFOW si{};
  si.cb = sizeof(si);
  si.dwFlags = STARTF_USESTDHANDLES;
  si.hStdInput = nul;
  si.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
  si.hStdError = err_wr;

  PROCESS_INFORMATION pi{};
  const BOOL ok = CreateProcessW(exe, cmd, nullptr, nullptr, TRUE, CREATE_NO_WINDOW, nullptr,
                                 nullptr, &si, &pi);
  const DWORD err = GetLastError();
  CloseHandle(nul);
  CloseHandle(err_wr);
  if (!ok) {
    CloseHandle(err_rd);
    std::printf("  FAIL CreateProcess %lu\n", err);
    return false;
  }
  child->pi = pi;
  child->stderr_rd = err_rd;
  return true;
}

bool WaitReady(Child* child, DWORD timeout_ms) {
  const DWORD start = GetTickCount();
  while (GetTickCount() - start < timeout_ms) {
    child->Drain();
    if (ContainsAscii(child->err, "ready")) return true;
    if (WaitForSingleObject(child->pi.hProcess, 0) == WAIT_OBJECT_0) {
      child->Drain();
      return ContainsAscii(child->err, "ready");
    }
    Sleep(20);
  }
  child->Drain();
  return ContainsAscii(child->err, "ready");
}

void ReadHeader(const uint8_t* view, BridgeHeader* out) {
  memcpy(out, view, sizeof(*out));
}

}  // namespace

int wmain() {
  std::printf("mapping_restart_test (no stdin, concurrent RO map)\n");

  const Layout layout = ComputeLayout();
  wchar_t dir[MAX_PATH * 2]{};
  CameraDir(dir, ARRAYSIZE(dir));
  wchar_t path[MAX_PATH * 2]{};
  swprintf_s(path, L"%s\\camera-buffer.bin", dir);

  wchar_t exe[MAX_PATH * 2]{};
  if (!PublisherPath(exe, ARRAYSIZE(exe))) {
    std::printf("  FAIL henshin-vcam-publisher.exe not next to test\n");
    return 1;
  }
  if (!EnsureSizedBuffer(path, layout.total_size)) return 1;

  HANDLE file = CreateFileW(path, GENERIC_READ,
                            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr,
                            OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) {
    std::printf("  FAIL mapper CreateFile %lu\n", GetLastError());
    return 1;
  }
  HANDLE mapping = CreateFileMappingW(file, nullptr, PAGE_READONLY, 0, 0, nullptr);
  if (!mapping) {
    std::printf("  FAIL mapper CreateFileMapping %lu\n", GetLastError());
    CloseHandle(file);
    return 1;
  }
  const uint8_t* view =
      static_cast<const uint8_t*>(MapViewOfFile(mapping, FILE_MAP_READ, 0, 0, 0));
  if (!view) {
    std::printf("  FAIL mapper MapViewOfFile %lu\n", GetLastError());
    CloseHandle(mapping);
    CloseHandle(file);
    return 1;
  }

  Child first;
  Check(StartPublisher(exe, &first), "start publisher while mapped");
  Check(WaitReady(&first, 8000), "publisher ready (start)");
  Check(!first.Saw1224(), "no CreateFile 1224 on start");
  if (first.Saw1224()) {
    std::printf("  stderr: %s\n", first.err.c_str());
  }

  BridgeHeader a{};
  ReadHeader(view, &a);
  Sleep(500);
  BridgeHeader b{};
  ReadHeader(view, &b);
  Check(b.published_frame_id > a.published_frame_id, "published_frame_id advances without stdin");
  Check(b.heartbeat_qpc > a.heartbeat_qpc, "heartbeat advances without stdin");
  Check(b.generation >= 1, "generation set on start");
  const uint64_t gen1 = b.generation;
  const uint32_t pid1 = b.producer_pid;
  std::printf("  info start generation=%llu pid=%lu frame %llu -> %llu heartbeat %llu -> %llu\n",
              static_cast<unsigned long long>(gen1), static_cast<unsigned long>(pid1),
              static_cast<unsigned long long>(a.published_frame_id),
              static_cast<unsigned long long>(b.published_frame_id),
              static_cast<unsigned long long>(a.heartbeat_qpc),
              static_cast<unsigned long long>(b.heartbeat_qpc));

  first.Close();

  Child second;
  Check(StartPublisher(exe, &second), "restart publisher while still mapped");
  Check(WaitReady(&second, 8000), "publisher ready (restart)");
  Check(!second.Saw1224(), "no CreateFile 1224 on restart");
  if (second.Saw1224()) {
    std::printf("  stderr: %s\n", second.err.c_str());
  }

  BridgeHeader c{};
  ReadHeader(view, &c);
  Check(c.generation > gen1, "generation incremented on restart");
  Check(c.producer_pid != 0 && c.producer_pid != pid1, "producer_pid updated");
  Sleep(500);
  BridgeHeader d{};
  ReadHeader(view, &d);
  Check(d.published_frame_id > c.published_frame_id, "published_frame_id advances after restart");
  Check(d.heartbeat_qpc > c.heartbeat_qpc, "heartbeat advances after restart");
  std::printf("  info restart generation=%llu pid=%lu frame %llu -> %llu\n",
              static_cast<unsigned long long>(c.generation),
              static_cast<unsigned long>(c.producer_pid),
              static_cast<unsigned long long>(c.published_frame_id),
              static_cast<unsigned long long>(d.published_frame_id));

  second.Close();
  UnmapViewOfFile(view);
  CloseHandle(mapping);
  CloseHandle(file);

  std::printf("%d checks, %d failures\n", g_checks, g_failures);
  return g_failures ? 1 : 0;
}
