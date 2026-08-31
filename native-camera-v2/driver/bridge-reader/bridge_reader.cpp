#include "bridge_reader.h"

#include <intrin.h>
#include <shlobj.h>
#include <strsafe.h>

#include <cstring>

namespace henshin {
namespace {

// x64 aligned loads are acquire at the hardware level; the barrier stops the
// compiler from reordering around them. Mirrors atomic.rs Acquire loads.
inline uint64_t LoadAcquire64(const void* p) {
  uint64_t v = static_cast<uint64_t>(
      __iso_volatile_load64(reinterpret_cast<const long long*>(p)));
  _ReadWriteBarrier();
  return v;
}

inline uint32_t LoadAcquire32(const void* p) {
  uint32_t v = static_cast<uint32_t>(
      __iso_volatile_load32(reinterpret_cast<const int*>(p)));
  _ReadWriteBarrier();
  return v;
}

inline void FenceAcquire() {
  _ReadWriteBarrier();
  MemoryBarrier();
}

template <typename T>
inline T ReadUnaligned(const void* p) {
  T value;
  std::memcpy(&value, p, sizeof(T));
  return value;
}

bool MulOverflows(uint64_t a, uint64_t b, uint64_t* out) {
  if (a != 0 && b > UINT64_MAX / a) {
    return true;
  }
  *out = a * b;
  return false;
}

bool AddOverflows(uint64_t a, uint64_t b, uint64_t* out) {
  if (a > UINT64_MAX - b) {
    return true;
  }
  *out = a + b;
  return false;
}

constexpr wchar_t kCameraDir[] = L"Henshin\\Camera";
constexpr wchar_t kBufferName[] = L"camera-buffer.bin";

bool ProgramDataCameraDir(wchar_t* out, size_t out_len) {
  PWSTR program_data = nullptr;
  if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_ProgramData, 0, nullptr, &program_data))) {
    HRESULT hr = StringCchPrintfW(out, out_len, L"%s\\%s", program_data, kCameraDir);
    CoTaskMemFree(program_data);
    return SUCCEEDED(hr);
  }
  wchar_t env[MAX_PATH] = {};
  if (GetEnvironmentVariableW(L"ProgramData", env, ARRAYSIZE(env)) == 0) {
    wcscpy_s(env, L"C:\\ProgramData");
  }
  return SUCCEEDED(StringCchPrintfW(out, out_len, L"%s\\%s", env, kCameraDir));
}

// Refuse a bridge file that resolves outside the installed camera directory:
// a reparse point or a substituted file is explicit attack surface (ARCH 8).
bool ResolvesInsideCameraDir(HANDLE file, const wchar_t* camera_dir) {
  wchar_t final_path[MAX_PATH * 2] = {};
  DWORD n = GetFinalPathNameByHandleW(file, final_path, ARRAYSIZE(final_path) - 1,
                                      FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
  if (n == 0 || n >= ARRAYSIZE(final_path)) {
    return false;
  }
  const wchar_t* path = final_path;
  if (wcsncmp(path, L"\\\\?\\", 4) == 0) {
    path += 4;
  }
  const size_t dir_len = wcslen(camera_dir);
  if (_wcsnicmp(path, camera_dir, dir_len) != 0) {
    return false;
  }
  return path[dir_len] == L'\\';
}

}  // namespace

const wchar_t* BridgeStatusName(BridgeStatus status) {
  switch (status) {
    case BridgeStatus::Ok: return L"Ok";
    case BridgeStatus::NoMapping: return L"NoMapping";
    case BridgeStatus::TruncatedMapping: return L"TruncatedMapping";
    case BridgeStatus::InvalidMagic: return L"InvalidMagic";
    case BridgeStatus::UnsupportedVersion: return L"UnsupportedVersion";
    case BridgeStatus::InvalidHeaderSize: return L"InvalidHeaderSize";
    case BridgeStatus::InvalidSlotCount: return L"InvalidSlotCount";
    case BridgeStatus::ZeroDimension: return L"ZeroDimension";
    case BridgeStatus::OddDimensions: return L"OddDimensions";
    case BridgeStatus::InvalidPixelFormat: return L"InvalidPixelFormat";
    case BridgeStatus::InvalidFps: return L"InvalidFps";
    case BridgeStatus::InvalidStride: return L"InvalidStride";
    case BridgeStatus::InvalidSlotStride: return L"InvalidSlotStride";
    case BridgeStatus::InvalidOffset: return L"InvalidOffset";
    case BridgeStatus::PayloadTooLarge: return L"PayloadTooLarge";
    case BridgeStatus::ArithmeticOverflow: return L"ArithmeticOverflow";
  }
  return L"Unknown";
}

const wchar_t* ProducerStateName(ProducerState state) {
  switch (state) {
    case ProducerState::NoProducer: return L"NoProducer";
    case ProducerState::ProducerHealthy: return L"ProducerHealthy";
    case ProducerState::ProducerStale: return L"ProducerStale";
    case ProducerState::ProducerRestarted: return L"ProducerRestarted";
  }
  return L"Unknown";
}

BridgeStatus ValidateMapping(const uint8_t* bytes, size_t len, BridgeLayout* out) {
  if (bytes == nullptr) {
    return BridgeStatus::NoMapping;
  }
  if (len < HEADER_SIZE) {
    return BridgeStatus::TruncatedMapping;
  }

  BridgeHeader h = ReadUnaligned<BridgeHeader>(bytes);

  if (h.magic != MAGIC) {
    return BridgeStatus::InvalidMagic;
  }
  if (h.protocol_major != PROTOCOL_MAJOR) {
    return BridgeStatus::UnsupportedVersion;
  }
  if (h.header_size != HEADER_SIZE) {
    return BridgeStatus::InvalidHeaderSize;
  }
  if (h.slot_count != SLOT_COUNT) {
    return BridgeStatus::InvalidSlotCount;
  }
  if (h.total_mapping_size > static_cast<uint64_t>(len)) {
    return BridgeStatus::TruncatedMapping;
  }
  if (h.width == 0 || h.height == 0) {
    return BridgeStatus::ZeroDimension;
  }
  if ((h.width % 2) != 0 || (h.height % 2) != 0) {
    return BridgeStatus::OddDimensions;
  }
  if (h.pixel_format != PIXEL_FORMAT_NV12) {
    return BridgeStatus::InvalidPixelFormat;
  }
  if (h.fps_num == 0 || h.fps_den == 0) {
    return BridgeStatus::InvalidFps;
  }
  if (h.color_matrix != COLOR_MATRIX_BT709 || h.color_range != COLOR_RANGE_LIMITED) {
    return BridgeStatus::InvalidPixelFormat;
  }
  if (h.stride_y < h.width || h.stride_uv < h.width) {
    return BridgeStatus::InvalidStride;
  }
  if (h.slot_stride_bytes == 0 || (h.slot_stride_bytes % 64) != 0) {
    return BridgeStatus::InvalidSlotStride;
  }

  uint64_t y_bytes = 0;
  if (MulOverflows(h.stride_y, h.height, &y_bytes)) {
    return BridgeStatus::ArithmeticOverflow;
  }
  uint64_t y_end = 0;
  if (AddOverflows(h.offset_y_within_slot, y_bytes, &y_end)) {
    return BridgeStatus::ArithmeticOverflow;
  }
  uint64_t uv_bytes = 0;
  if (MulOverflows(h.stride_uv, h.height / 2, &uv_bytes)) {
    return BridgeStatus::ArithmeticOverflow;
  }
  uint64_t uv_end = 0;
  if (AddOverflows(h.offset_uv_within_slot, uv_bytes, &uv_end)) {
    return BridgeStatus::ArithmeticOverflow;
  }

  if (y_end > h.slot_stride_bytes || uv_end > h.slot_stride_bytes) {
    return BridgeStatus::InvalidOffset;
  }
  if (h.offset_uv_within_slot < h.offset_y_within_slot) {
    return BridgeStatus::InvalidOffset;
  }

  uint64_t payload = 0;
  if (AddOverflows(y_bytes, uv_bytes, &payload)) {
    return BridgeStatus::ArithmeticOverflow;
  }
  if (h.frame_payload_size > payload || h.frame_payload_size > h.slot_stride_bytes) {
    return BridgeStatus::PayloadTooLarge;
  }

  uint64_t slots_bytes = 0;
  if (MulOverflows(SLOT_COUNT, h.slot_stride_bytes, &slots_bytes)) {
    return BridgeStatus::ArithmeticOverflow;
  }
  uint64_t expected_total = 0;
  if (AddOverflows(HEADER_SIZE, slots_bytes, &expected_total)) {
    return BridgeStatus::ArithmeticOverflow;
  }
  if (h.total_mapping_size < expected_total) {
    return BridgeStatus::TruncatedMapping;
  }

  if (out != nullptr) {
    out->width = h.width;
    out->height = h.height;
    out->stride_y = h.stride_y;
    out->stride_uv = h.stride_uv;
    out->offset_y = h.offset_y_within_slot;
    out->offset_uv = h.offset_uv_within_slot;
    out->frame_payload_size = h.frame_payload_size;
    out->slot_stride_bytes = h.slot_stride_bytes;
    out->total_mapping_size = h.total_mapping_size;
    out->fps_num = h.fps_num;
    out->fps_den = h.fps_den;
  }
  return BridgeStatus::Ok;
}

BridgeReader::~BridgeReader() { Close(); }

BridgeStatus BridgeReader::Open() {
  Close();

  wchar_t camera_dir[MAX_PATH * 2] = {};
  if (!ProgramDataCameraDir(camera_dir, ARRAYSIZE(camera_dir))) {
    return BridgeStatus::NoMapping;
  }
  wchar_t path[MAX_PATH * 2] = {};
  if (FAILED(StringCchPrintfW(path, ARRAYSIZE(path), L"%s\\%s", camera_dir, kBufferName))) {
    return BridgeStatus::NoMapping;
  }

  // The producer keeps the file open for writing; never request exclusive access.
  HANDLE file = CreateFileW(path, GENERIC_READ,
                            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr,
                            OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) {
    return BridgeStatus::NoMapping;
  }
  if (!ResolvesInsideCameraDir(file, camera_dir)) {
    CloseHandle(file);
    return BridgeStatus::NoMapping;
  }

  LARGE_INTEGER size{};
  if (!GetFileSizeEx(file, &size) || size.QuadPart < static_cast<LONGLONG>(HEADER_SIZE)) {
    CloseHandle(file);
    return BridgeStatus::TruncatedMapping;
  }

  HANDLE mapping = CreateFileMappingW(file, nullptr, PAGE_READONLY, 0, 0, nullptr);
  if (mapping == nullptr) {
    CloseHandle(file);
    return BridgeStatus::NoMapping;
  }
  const uint8_t* view =
      static_cast<const uint8_t*>(MapViewOfFile(mapping, FILE_MAP_READ, 0, 0, 0));
  if (view == nullptr) {
    CloseHandle(mapping);
    CloseHandle(file);
    return BridgeStatus::NoMapping;
  }

  BridgeLayout layout{};
  BridgeStatus status =
      ValidateMapping(view, static_cast<size_t>(size.QuadPart), &layout);
  if (status != BridgeStatus::Ok) {
    UnmapViewOfFile(view);
    CloseHandle(mapping);
    CloseHandle(file);
    return status;
  }

  file_ = file;
  mapping_ = mapping;
  view_ = view;
  base_ = view;
  len_ = static_cast<size_t>(size.QuadPart);
  layout_ = layout;
  return BridgeStatus::Ok;
}

BridgeStatus BridgeReader::Attach(const uint8_t* base, size_t len) {
  Close();
  BridgeLayout layout{};
  BridgeStatus status = ValidateMapping(base, len, &layout);
  if (status != BridgeStatus::Ok) {
    return status;
  }
  base_ = base;
  len_ = len;
  layout_ = layout;
  return BridgeStatus::Ok;
}

void BridgeReader::Close() {
  if (view_ != nullptr) {
    UnmapViewOfFile(view_);
    view_ = nullptr;
  }
  if (mapping_ != nullptr) {
    CloseHandle(mapping_);
    mapping_ = nullptr;
  }
  if (file_ != INVALID_HANDLE_VALUE) {
    CloseHandle(file_);
    file_ = INVALID_HANDLE_VALUE;
  }
  base_ = nullptr;
  len_ = 0;
  layout_ = BridgeLayout{};
  last_generation_ = 0;
  last_frame_id_ = 0;
  last_seen_published_ = 0;
  seen_generation_change_ = false;
  seqlock_retries_ = 0;
}

const uint8_t* BridgeReader::SlotBase(uint32_t slot) const {
  return base_ + HEADER_SIZE + static_cast<size_t>(slot) * layout_.slot_stride_bytes;
}

uint64_t BridgeReader::generation() const {
  return base_ ? LoadAcquire64(base_ + offsetof(BridgeHeader, generation)) : 0;
}

uint64_t BridgeReader::heartbeat_qpc() const {
  return base_ ? LoadAcquire64(base_ + offsetof(BridgeHeader, heartbeat_qpc)) : 0;
}

uint64_t BridgeReader::published_frame_id() const {
  return base_ ? LoadAcquire64(base_ + offsetof(BridgeHeader, published_frame_id)) : 0;
}

uint32_t BridgeReader::producer_pid() const {
  return base_ ? LoadAcquire32(base_ + offsetof(BridgeHeader, producer_pid)) : 0;
}

uint64_t BridgeReader::qpc_frequency() const {
  return base_ ? LoadAcquire64(base_ + offsetof(BridgeHeader, qpc_frequency)) : 0;
}

BridgeStatus BridgeReader::TryRead(CopyFn copy, void* context, bool* delivered) {
  *delivered = false;
  if (base_ == nullptr) {
    return BridgeStatus::NoMapping;
  }

  // The header is revalidated on every read: the producer may have been
  // replaced by a hostile or truncated file since the last call.
  BridgeLayout layout{};
  BridgeStatus status = ValidateMapping(base_, len_, &layout);
  if (status != BridgeStatus::Ok) {
    return status;
  }
  layout_ = layout;

  const uint64_t generation = LoadAcquire64(base_ + offsetof(BridgeHeader, generation));
  if (last_generation_ != 0 && generation != last_generation_) {
    seen_generation_change_ = true;
    last_frame_id_ = 0;
  }

  const uint64_t published =
      LoadAcquire64(base_ + offsetof(BridgeHeader, published_frame_id));
  last_seen_published_ = published;
  if (published == 0 || published == last_frame_id_) {
    last_generation_ = generation;
    return BridgeStatus::Ok;  // no fresh frame
  }

  for (uint32_t attempt = 0; attempt < MAX_READ_ATTEMPTS; ++attempt) {
    const uint32_t slot = static_cast<uint32_t>(published % SLOT_COUNT);
    const uint8_t* slot_base = SlotBase(slot);
    const void* seq_ptr = slot_base + offsetof(SlotHeader, sequence);

    const uint64_t seq1 = LoadAcquire64(seq_ptr);
    if ((seq1 % 2) == 1) {
      ++seqlock_retries_;
      continue;  // write in progress
    }

    FrameView view{};
    view.frame_id = ReadUnaligned<uint64_t>(slot_base + offsetof(SlotHeader, frame_id));
    view.capture_qpc =
        ReadUnaligned<uint64_t>(slot_base + offsetof(SlotHeader, capture_qpc));
    view.publish_qpc =
        ReadUnaligned<uint64_t>(slot_base + offsetof(SlotHeader, publish_qpc));
    const uint32_t payload_size =
        LoadAcquire32(slot_base + offsetof(SlotHeader, payload_size));
    view.flags = LoadAcquire32(slot_base + offsetof(SlotHeader, flags));
    view.generation = generation;

    if (payload_size > layout_.slot_stride_bytes) {
      return BridgeStatus::PayloadTooLarge;
    }

    view.y = slot_base + layout_.offset_y;
    view.uv = slot_base + layout_.offset_uv;
    view.stride_y = layout_.stride_y;
    view.stride_uv = layout_.stride_uv;
    view.width = layout_.width;
    view.height = layout_.height;

    if (!copy(view, context)) {
      ++seqlock_retries_;
      continue;
    }

    FenceAcquire();
    const uint64_t seq2 = LoadAcquire64(seq_ptr);
    if (seq1 == seq2 && (seq2 % 2) == 0 && view.frame_id == published) {
      last_generation_ = generation;
      last_frame_id_ = view.frame_id;
      *delivered = true;
      return BridgeStatus::Ok;
    }
    ++seqlock_retries_;  // torn read, the copy is discarded
  }

  last_generation_ = generation;
  return BridgeStatus::Ok;  // treated as "no fresh frame"
}

ProducerState BridgeReader::PollProducer(uint64_t now_qpc, uint64_t stale_after_qpc) {
  if (base_ == nullptr) {
    return ProducerState::NoProducer;
  }
  const uint64_t generation = LoadAcquire64(base_ + offsetof(BridgeHeader, generation));
  const uint32_t pid = LoadAcquire32(base_ + offsetof(BridgeHeader, producer_pid));
  const uint64_t heartbeat = LoadAcquire64(base_ + offsetof(BridgeHeader, heartbeat_qpc));

  if (generation == 0 || pid == 0 || heartbeat == 0) {
    return ProducerState::NoProducer;
  }
  if (last_generation_ != 0 && generation != last_generation_) {
    return ProducerState::ProducerRestarted;
  }
  // A deliberately still source must not look dead: the heartbeat advances
  // even when no new frame is published (ARCHITECTURE 8).
  if (now_qpc > heartbeat && (now_qpc - heartbeat) > stale_after_qpc) {
    return ProducerState::ProducerStale;
  }
  return ProducerState::ProducerHealthy;
}

}  // namespace henshin
