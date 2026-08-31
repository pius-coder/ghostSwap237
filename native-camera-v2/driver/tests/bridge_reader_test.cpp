// Host-side tests for the bridge reader. No COM, no Media Foundation, no
// FrameServer: this binary runs anywhere and is the fast feedback loop for the
// only piece of the DLL that parses untrusted input.

#include <cstdio>
#include <cstring>
#include <vector>

#include "../bridge-reader/bridge_reader.h"

using namespace henshin;

namespace {

int g_failures = 0;
int g_checks = 0;

void Check(bool ok, const char* what) {
  ++g_checks;
  if (!ok) {
    ++g_failures;
    std::printf("  FAIL %s\n", what);
  }
}

void CheckStatus(BridgeStatus got, BridgeStatus want, const char* what) {
  ++g_checks;
  if (got != want) {
    ++g_failures;
    std::printf("  FAIL %s: got %ls want %ls\n", what, BridgeStatusName(got),
                BridgeStatusName(want));
  }
}

uint64_t RoundUp64(uint64_t v) { return (v + 63) & ~static_cast<uint64_t>(63); }

// Mirrors crates/bridge-protocol writer geometry and publish sequence so the
// C++ reader is tested against the same bytes the Rust producer emits.
class FakeBridge {
 public:
  FakeBridge(uint32_t width = 1280, uint32_t height = 720) {
    const uint32_t stride_y = width;
    const uint32_t stride_uv = width;
    const uint64_t y_bytes = static_cast<uint64_t>(stride_y) * height;
    const uint64_t uv_bytes = static_cast<uint64_t>(stride_uv) * (height / 2);
    offset_y_ = SLOT_HEADER_SIZE;
    offset_uv_ = static_cast<uint32_t>(offset_y_ + y_bytes);
    slot_stride_ = RoundUp64(offset_uv_ + uv_bytes);
    total_ = HEADER_SIZE + SLOT_COUNT * slot_stride_;
    bytes_.assign(static_cast<size_t>(total_), 0);

    BridgeHeader h{};
    h.magic = MAGIC;
    h.protocol_major = PROTOCOL_MAJOR;
    h.protocol_minor = PROTOCOL_MINOR;
    h.header_size = HEADER_SIZE;
    h.slot_count = SLOT_COUNT;
    h.total_mapping_size = total_;
    h.slot_stride_bytes = slot_stride_;
    h.capacity_width = width;
    h.capacity_height = height;
    h.generation = 1;
    h.producer_pid = 4242;
    h.pixel_format = PIXEL_FORMAT_NV12;
    h.width = width;
    h.height = height;
    h.fps_num = 30;
    h.fps_den = 1;
    h.stride_y = stride_y;
    h.stride_uv = stride_uv;
    h.offset_y_within_slot = offset_y_;
    h.offset_uv_within_slot = offset_uv_;
    h.frame_payload_size = static_cast<uint32_t>(y_bytes + uv_bytes);
    h.color_matrix = COLOR_MATRIX_BT709;
    h.color_range = COLOR_RANGE_LIMITED;
    h.published_frame_id = 0;
    h.heartbeat_qpc = 1000;
    h.qpc_frequency = 10'000'000;
    std::memcpy(bytes_.data(), &h, sizeof(h));
  }

  BridgeHeader* header() { return reinterpret_cast<BridgeHeader*>(bytes_.data()); }
  const uint8_t* data() const { return bytes_.data(); }
  size_t size() const { return bytes_.size(); }
  uint64_t slot_stride() const { return slot_stride_; }

  uint8_t* SlotBase(uint64_t frame_id) {
    const uint64_t slot = frame_id % SLOT_COUNT;
    return bytes_.data() + HEADER_SIZE + slot * slot_stride_;
  }

  uint64_t* SequenceOf(uint64_t frame_id) {
    return reinterpret_cast<uint64_t*>(SlotBase(frame_id) + offsetof(SlotHeader, sequence));
  }

  // Full writer sequence: odd sequence, payload, even sequence, publish.
  void Publish(uint64_t frame_id, uint8_t fill, uint32_t flags = 0) {
    uint8_t* slot = SlotBase(frame_id);
    uint64_t* seq = SequenceOf(frame_id);
    *seq |= 1;

    SlotHeader sh{};
    sh.sequence = *seq;
    sh.frame_id = frame_id;
    sh.capture_qpc = 5000 + frame_id;
    sh.publish_qpc = 6000 + frame_id;
    sh.payload_size = header()->frame_payload_size;
    sh.flags = flags;
    std::memcpy(slot + offsetof(SlotHeader, frame_id), &sh.frame_id, sizeof(uint64_t));
    std::memcpy(slot + offsetof(SlotHeader, capture_qpc), &sh.capture_qpc, sizeof(uint64_t));
    std::memcpy(slot + offsetof(SlotHeader, publish_qpc), &sh.publish_qpc, sizeof(uint64_t));
    std::memcpy(slot + offsetof(SlotHeader, payload_size), &sh.payload_size, sizeof(uint32_t));
    std::memcpy(slot + offsetof(SlotHeader, flags), &sh.flags, sizeof(uint32_t));

    std::memset(slot + offset_y_, fill, static_cast<size_t>(offset_uv_ - offset_y_));
    std::memset(slot + offset_uv_, static_cast<uint8_t>(fill + 1),
                static_cast<size_t>(slot_stride_ - offset_uv_));

    *seq += 1;  // even again
    header()->published_frame_id = frame_id;
  }

 private:
  std::vector<uint8_t> bytes_;
  uint32_t offset_y_ = 0;
  uint32_t offset_uv_ = 0;
  uint64_t slot_stride_ = 0;
  uint64_t total_ = 0;
};

struct Captured {
  uint64_t frame_id = 0;
  uint64_t capture_qpc = 0;
  uint32_t flags = 0;
  uint8_t first_y = 0;
  uint8_t first_uv = 0;
  int calls = 0;
};

bool CaptureCopy(const FrameView& view, void* context) {
  auto* c = static_cast<Captured*>(context);
  c->frame_id = view.frame_id;
  c->capture_qpc = view.capture_qpc;
  c->flags = view.flags;
  c->first_y = view.y[0];
  c->first_uv = view.uv[0];
  ++c->calls;
  return true;
}

// Simulates the writer reusing the slot while the reader copies: every copy
// bumps the sequence, so the post-copy recheck must reject all three attempts.
struct Tearing {
  FakeBridge* bridge = nullptr;
  uint64_t frame_id = 0;
  int calls = 0;
};

bool TearingCopy(const FrameView& view, void* context) {
  auto* t = static_cast<Tearing*>(context);
  ++t->calls;
  (void)view;
  *t->bridge->SequenceOf(t->frame_id) += 2;
  return true;
}

void TestValidMapping() {
  std::printf("valid mapping\n");
  FakeBridge b;
  BridgeLayout layout{};
  CheckStatus(ValidateMapping(b.data(), b.size(), &layout), BridgeStatus::Ok, "validate");
  Check(layout.width == 1280 && layout.height == 720, "dimensions");
  Check(layout.stride_y == 1280 && layout.stride_uv == 1280, "strides");
  Check(layout.offset_y == SLOT_HEADER_SIZE, "offset_y");
  Check(layout.y_plane_len() == 1280u * 720u, "y_plane_len");
  Check(layout.uv_plane_len() == 1280u * 360u, "uv_plane_len");
  Check(layout.fps_num == 30 && layout.fps_den == 1, "fps");
}

void TestRejectsHostileHeaders() {
  std::printf("hostile headers\n");
  {
    FakeBridge b;
    b.header()->magic = 0xDEADBEEF;
    CheckStatus(ValidateMapping(b.data(), b.size(), nullptr), BridgeStatus::InvalidMagic, "magic");
  }
  {
    FakeBridge b;
    b.header()->protocol_major = 2;
    CheckStatus(ValidateMapping(b.data(), b.size(), nullptr), BridgeStatus::UnsupportedVersion,
                "major");
  }
  {
    FakeBridge b;
    b.header()->header_size = 128;
    CheckStatus(ValidateMapping(b.data(), b.size(), nullptr), BridgeStatus::InvalidHeaderSize,
                "header_size");
  }
  {
    FakeBridge b;
    b.header()->slot_count = 4;
    CheckStatus(ValidateMapping(b.data(), b.size(), nullptr), BridgeStatus::InvalidSlotCount,
                "slot_count");
  }
  {
    FakeBridge b;
    CheckStatus(ValidateMapping(b.data(), HEADER_SIZE - 1, nullptr),
                BridgeStatus::TruncatedMapping, "short buffer");
  }
  {
    FakeBridge b;
    CheckStatus(ValidateMapping(b.data(), HEADER_SIZE, nullptr), BridgeStatus::TruncatedMapping,
                "header only");
  }
  {
    FakeBridge b;
    b.header()->width = 0;
    CheckStatus(ValidateMapping(b.data(), b.size(), nullptr), BridgeStatus::ZeroDimension, "zero");
  }
  {
    FakeBridge b;
    b.header()->width = 1279;
    CheckStatus(ValidateMapping(b.data(), b.size(), nullptr), BridgeStatus::OddDimensions, "odd");
  }
  {
    FakeBridge b;
    b.header()->pixel_format = 7;
    CheckStatus(ValidateMapping(b.data(), b.size(), nullptr), BridgeStatus::InvalidPixelFormat,
                "pixel_format");
  }
  {
    FakeBridge b;
    b.header()->color_range = 0;
    CheckStatus(ValidateMapping(b.data(), b.size(), nullptr), BridgeStatus::InvalidPixelFormat,
                "color_range");
  }
  {
    FakeBridge b;
    b.header()->fps_den = 0;
    CheckStatus(ValidateMapping(b.data(), b.size(), nullptr), BridgeStatus::InvalidFps, "fps");
  }
  {
    FakeBridge b;
    b.header()->stride_y = 640;
    CheckStatus(ValidateMapping(b.data(), b.size(), nullptr), BridgeStatus::InvalidStride,
                "stride");
  }
  {
    FakeBridge b;
    b.header()->slot_stride_bytes += 1;
    CheckStatus(ValidateMapping(b.data(), b.size(), nullptr), BridgeStatus::InvalidSlotStride,
                "slot_stride alignment");
  }
  {
    FakeBridge b;
    b.header()->offset_uv_within_slot = 0;  // before offset_y
    CheckStatus(ValidateMapping(b.data(), b.size(), nullptr), BridgeStatus::InvalidOffset,
                "uv before y");
  }
  {
    FakeBridge b;
    b.header()->offset_y_within_slot = static_cast<uint32_t>(b.slot_stride() - 16);
    CheckStatus(ValidateMapping(b.data(), b.size(), nullptr), BridgeStatus::InvalidOffset,
                "y past slot");
  }
  {
    FakeBridge b;
    b.header()->frame_payload_size = 0xFFFFFFFF;
    CheckStatus(ValidateMapping(b.data(), b.size(), nullptr), BridgeStatus::PayloadTooLarge,
                "payload");
  }
  {
    // stride_y * height must not be allowed to wrap.
    FakeBridge b;
    b.header()->stride_y = 0xFFFFFFFF;
    b.header()->height = 0xFFFFFFFE;
    BridgeStatus s = ValidateMapping(b.data(), b.size(), nullptr);
    Check(s == BridgeStatus::InvalidOffset || s == BridgeStatus::ArithmeticOverflow,
          "stride overflow rejected");
  }
}

void TestReadsPublishedFrames() {
  std::printf("reads published frames\n");
  FakeBridge b;
  BridgeReader r;
  CheckStatus(r.Attach(b.data(), b.size()), BridgeStatus::Ok, "attach");

  Captured c{};
  bool delivered = true;
  CheckStatus(r.TryRead(CaptureCopy, &c, &delivered), BridgeStatus::Ok, "read empty");
  Check(!delivered, "no frame before first publish");
  Check(c.calls == 0, "copy not called without a frame");

  b.Publish(1, 0x40);
  CheckStatus(r.TryRead(CaptureCopy, &c, &delivered), BridgeStatus::Ok, "read frame 1");
  Check(delivered, "frame 1 delivered");
  Check(c.frame_id == 1, "frame_id 1");
  Check(c.capture_qpc == 5001, "capture_qpc passed through");
  Check(c.first_y == 0x40 && c.first_uv == 0x41, "planes point at the slot");

  // Same published id twice is not a fresh frame.
  CheckStatus(r.TryRead(CaptureCopy, &c, &delivered), BridgeStatus::Ok, "reread");
  Check(!delivered, "no redelivery of the same frame_id");

  // Walk past the slot count so every slot is exercised.
  for (uint64_t id = 2; id <= 7; ++id) {
    b.Publish(id, static_cast<uint8_t>(0x40 + id), id == 5 ? SLOT_FLAG_REPEATED : 0);
    CheckStatus(r.TryRead(CaptureCopy, &c, &delivered), BridgeStatus::Ok, "read loop");
    Check(delivered, "delivered in loop");
    Check(c.frame_id == id, "frame_id follows publication");
  }
  Check(r.last_frame_id() == 7, "last_frame_id tracks");
}

void TestRepeatedFlagSurvives() {
  std::printf("repeated flag\n");
  FakeBridge b;
  BridgeReader r;
  r.Attach(b.data(), b.size());
  Captured c{};
  bool delivered = false;
  b.Publish(1, 0x10, SLOT_FLAG_REPEATED);
  r.TryRead(CaptureCopy, &c, &delivered);
  Check(delivered && (c.flags & SLOT_FLAG_REPEATED) != 0, "SLOT_FLAG_REPEATED reaches the caller");
}

void TestRejectsWriteInProgress() {
  std::printf("write in progress\n");
  FakeBridge b;
  BridgeReader r;
  r.Attach(b.data(), b.size());
  b.Publish(1, 0x20);
  *b.SequenceOf(1) |= 1;  // writer took the slot again

  Captured c{};
  bool delivered = true;
  CheckStatus(r.TryRead(CaptureCopy, &c, &delivered), BridgeStatus::Ok, "odd sequence");
  Check(!delivered, "odd sequence yields no frame");
  Check(c.calls == 0, "no copy while a write is in flight");
  Check(r.seqlock_retries() == MAX_READ_ATTEMPTS, "attempts are bounded");
}

void TestRejectsTornRead() {
  std::printf("torn read\n");
  FakeBridge b;
  BridgeReader r;
  r.Attach(b.data(), b.size());
  b.Publish(1, 0x30);

  Tearing t{&b, 1, 0};
  bool delivered = true;
  CheckStatus(r.TryRead(TearingCopy, &t, &delivered), BridgeStatus::Ok, "torn read");
  Check(!delivered, "torn frame is never delivered");
  Check(t.calls == static_cast<int>(MAX_READ_ATTEMPTS), "exactly 3 attempts, no infinite loop");
}

void TestGenerationChange() {
  std::printf("generation change\n");
  FakeBridge b;
  BridgeReader r;
  r.Attach(b.data(), b.size());
  Captured c{};
  bool delivered = false;

  b.Publish(1, 0x50);
  r.TryRead(CaptureCopy, &c, &delivered);
  Check(delivered, "first generation frame");
  Check(!r.seen_generation_change(), "no change yet");

  // Producer restarted: new generation, frame ids restart from 1.
  b.header()->generation = 2;
  b.header()->published_frame_id = 0;
  b.Publish(1, 0x60);
  r.TryRead(CaptureCopy, &c, &delivered);
  Check(r.seen_generation_change(), "generation change observed");
  Check(delivered, "frame 1 of the new generation is fresh, not a duplicate");
  Check(c.first_y == 0x60, "new generation pixels");
}

void TestProducerStates() {
  std::printf("producer states\n");
  FakeBridge b;
  BridgeReader r;
  r.Attach(b.data(), b.size());

  const uint64_t stale_after = 10'000'000;  // 1 s at the fake qpc frequency
  Check(r.PollProducer(1000, stale_after) == ProducerState::ProducerHealthy, "healthy");
  Check(r.PollProducer(1000 + stale_after + 1, stale_after) == ProducerState::ProducerStale,
        "stale after the heartbeat gap");

  b.header()->producer_pid = 0;
  Check(r.PollProducer(1000, stale_after) == ProducerState::NoProducer, "no producer");
  b.header()->producer_pid = 4242;

  Captured c{};
  bool delivered = false;
  b.Publish(1, 0x70);
  r.TryRead(CaptureCopy, &c, &delivered);
  b.header()->generation = 9;
  Check(r.PollProducer(1000, stale_after) == ProducerState::ProducerRestarted, "restarted");
}

void TestUnopenedReader() {
  std::printf("unopened reader\n");
  BridgeReader r;
  Captured c{};
  bool delivered = true;
  CheckStatus(r.TryRead(CaptureCopy, &c, &delivered), BridgeStatus::NoMapping, "no mapping");
  Check(!delivered, "nothing delivered");
  Check(r.PollProducer(0, 1) == ProducerState::NoProducer, "no producer without a mapping");
}

}  // namespace

int main() {
  std::printf("bridge-reader tests\n");
  TestValidMapping();
  TestRejectsHostileHeaders();
  TestReadsPublishedFrames();
  TestRepeatedFlagSurvives();
  TestRejectsWriteInProgress();
  TestRejectsTornRead();
  TestGenerationChange();
  TestProducerStates();
  TestUnopenedReader();

  if (g_failures == 0) {
    std::printf("\n%d checks passed\n", g_checks);
    return 0;
  }
  std::printf("\n%d of %d checks FAILED\n", g_failures, g_checks);
  return 1;
}
