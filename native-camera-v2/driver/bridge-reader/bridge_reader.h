// Frame Bridge reader (ARCHITECTURE 8).
//
// Port of crates/bridge-protocol/src/{validate,reader}.rs, which is the test
// oracle for the seqlock protocol. The shared mapping is treated as untrusted
// input: nothing is copied before the header validates, and every offset
// computation is checked for overflow.
//
// This component knows nothing about COM or Media Foundation on purpose, so it
// can be exercised by a host-side unit test without FrameServer.

#pragma once

#include <windows.h>

#include <cstdint>

#include "henshin_bridge.h"

namespace henshin {

enum class BridgeStatus : uint32_t {
  Ok = 0,
  NoMapping,
  TruncatedMapping,
  InvalidMagic,
  UnsupportedVersion,
  InvalidHeaderSize,
  InvalidSlotCount,
  ZeroDimension,
  OddDimensions,
  InvalidPixelFormat,
  InvalidFps,
  InvalidStride,
  InvalidSlotStride,
  InvalidOffset,
  PayloadTooLarge,
  ArithmeticOverflow,
};

const wchar_t* BridgeStatusName(BridgeStatus status);

// Producer liveness as seen by the DLL (ARCHITECTURE 8).
enum class ProducerState : uint32_t {
  NoProducer = 0,
  ProducerHealthy,
  ProducerStale,
  ProducerRestarted,
};

const wchar_t* ProducerStateName(ProducerState state);

struct BridgeLayout {
  uint32_t width = 0;
  uint32_t height = 0;
  uint32_t stride_y = 0;
  uint32_t stride_uv = 0;
  uint32_t offset_y = 0;
  uint32_t offset_uv = 0;
  uint32_t frame_payload_size = 0;
  uint64_t slot_stride_bytes = 0;
  uint64_t total_mapping_size = 0;
  uint32_t fps_num = 0;
  uint32_t fps_den = 0;

  uint64_t y_plane_len() const {
    return static_cast<uint64_t>(stride_y) * height;
  }
  uint64_t uv_plane_len() const {
    return static_cast<uint64_t>(stride_uv) * (height / 2);
  }
};

// Borrowed view of one frame inside the mapping. Valid only until the caller
// finishes the copy and revalidates the sequence via AcceptFrame().
struct FrameView {
  uint64_t frame_id = 0;
  uint64_t capture_qpc = 0;
  uint64_t publish_qpc = 0;
  uint64_t generation = 0;
  uint32_t flags = 0;
  const uint8_t* y = nullptr;
  const uint8_t* uv = nullptr;
  uint32_t stride_y = 0;
  uint32_t stride_uv = 0;
  uint32_t width = 0;
  uint32_t height = 0;
};

// Called with a stable frame to copy the pixels out. Returning false rejects
// the frame (treated as a failed attempt).
using CopyFn = bool (*)(const FrameView& view, void* context);

BridgeStatus ValidateMapping(const uint8_t* bytes, size_t len, BridgeLayout* out);

class BridgeReader {
 public:
  BridgeReader() = default;
  ~BridgeReader();

  BridgeReader(const BridgeReader&) = delete;
  BridgeReader& operator=(const BridgeReader&) = delete;

  // Maps C:\ProgramData\Henshin\Camera\camera-buffer.bin read-only.
  // Absence of a producer is a runtime state, never a construction error.
  BridgeStatus Open();

  // Test seam: adopt an already-mapped region the caller owns.
  BridgeStatus Attach(const uint8_t* base, size_t len);

  void Close();

  bool IsOpen() const { return base_ != nullptr; }

  // Reads the newest published frame, if any is fresh and stable.
  // Bounded to MAX_READ_ATTEMPTS tries, then reports "no fresh frame".
  // `copy` runs before the sequence is rechecked, so a torn read is discarded
  // rather than delivered.
  BridgeStatus TryRead(CopyFn copy, void* context, bool* delivered);

  // Classifies the producer from generation, pid and heartbeat age.
  // `stale_after_qpc` is the configurable threshold of ARCHITECTURE 8.
  ProducerState PollProducer(uint64_t now_qpc, uint64_t stale_after_qpc);

  const BridgeLayout& layout() const { return layout_; }
  uint64_t generation() const;
  uint64_t heartbeat_qpc() const;
  uint64_t published_frame_id() const;
  uint32_t producer_pid() const;
  uint64_t qpc_frequency() const;
  uint64_t last_frame_id() const { return last_frame_id_; }
  bool seen_generation_change() const { return seen_generation_change_; }
  uint32_t seqlock_retries() const { return seqlock_retries_; }

 private:
  const uint8_t* SlotBase(uint32_t slot) const;

  HANDLE file_ = INVALID_HANDLE_VALUE;
  HANDLE mapping_ = nullptr;
  const uint8_t* view_ = nullptr;  // owned mapping, unmapped in Close()
  const uint8_t* base_ = nullptr;  // active base (owned or attached)
  size_t len_ = 0;
  BridgeLayout layout_{};
  uint64_t last_generation_ = 0;
  uint64_t last_frame_id_ = 0;
  uint64_t last_seen_published_ = 0;
  bool seen_generation_change_ = false;
  uint32_t seqlock_retries_ = 0;
};

}  // namespace henshin
