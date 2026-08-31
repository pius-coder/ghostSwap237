#include "media_stream.h"

#include <ks.h>
#include <ksmedia.h>
#include <mferror.h>
#include <mfapi.h>

#include <cstring>
#include <new>

#include "../com/module.h"
#include "vcam_ids.h"
#include "../media-source/media_source.h"
#include "../trace/etw.h"

#ifndef PINNAME_VIDEO_CAPTURE
DEFINE_GUID(PINNAME_VIDEO_CAPTURE, 0xfb6c4281, 0x0353, 0x11d1, 0x90, 0x5f, 0x00, 0x00, 0xc0, 0xcc,
            0x16, 0xba);
#endif

using Microsoft::WRL::ComPtr;

namespace henshin {
namespace {

constexpr int64_t kHnsPerSecond = 10'000'000;

// QPC counts machine ticks, not 100 ns units (ARCHITECTURE 7). Split the
// division so a large delta cannot overflow before the scaling.
int64_t QpcDeltaToHns(uint64_t delta, uint64_t frequency) {
  if (frequency == 0) {
    return 0;
  }
  const uint64_t whole = delta / frequency;
  const uint64_t rest = delta % frequency;
  return static_cast<int64_t>(whole * kHnsPerSecond + (rest * kHnsPerSecond) / frequency);
}

// The destination pitch is never assumed equal to the source stride.
void CopyPlane(uint8_t* dst, LONG dst_pitch, const uint8_t* src, uint32_t src_pitch,
               uint32_t width_bytes, uint32_t rows) {
  if (static_cast<uint32_t>(dst_pitch) == src_pitch && src_pitch == width_bytes) {
    std::memcpy(dst, src, static_cast<size_t>(width_bytes) * rows);
    return;
  }
  for (uint32_t row = 0; row < rows; ++row) {
    std::memcpy(dst + static_cast<size_t>(row) * dst_pitch,
                src + static_cast<size_t>(row) * src_pitch, width_bytes);
  }
}

struct CopyContext {
  IMFMediaBuffer* buffer = nullptr;
  IMF2DBuffer2* buffer2d = nullptr;
  DWORD current_length = 0;
  uint32_t copy_us = 0;
  uint64_t frame_id = 0;
  uint64_t capture_qpc = 0;
  uint32_t flags = 0;
  bool ok = false;
};

// Runs while the seqlock sequence is still being watched: if the producer
// reuses the slot mid-copy the reader discards this data and retries.
bool CopyIntoBuffer(const FrameView& view, void* context) {
  auto* ctx = static_cast<CopyContext*>(context);
  ctx->ok = false;

  const size_t required_length =
      static_cast<size_t>(view.width) * view.height * 3 / 2;

  BYTE* scanline0 = nullptr;
  LONG pitch = 0;
  BYTE* start = nullptr;
  DWORD length = 0;
  bool locked_2d = false;

  if (ctx->buffer2d != nullptr) {
    if (FAILED(ctx->buffer2d->Lock2DSize(MF2DBuffer_LockFlags_Write, &scanline0, &pitch,
                                         &start, &length))) {
      return false;
    }
    locked_2d = true;
    if (pitch <= 0 || scanline0 < start) {
      ctx->buffer2d->Unlock2D();  // bottom-up buffers are not part of the contract
      return false;
    }
    const size_t offset = static_cast<size_t>(scanline0 - start);
    const size_t pitched_length =
        static_cast<size_t>(pitch) * (view.height + view.height / 2);
    if (offset > length || pitched_length > static_cast<size_t>(length) - offset) {
      ctx->buffer2d->Unlock2D();
      return false;
    }
  } else {
    DWORD max_length = 0;
    if (ctx->buffer == nullptr ||
        FAILED(ctx->buffer->Lock(&scanline0, &max_length, nullptr))) {
      return false;
    }
    if (required_length > max_length) {
      ctx->buffer->Unlock();
      return false;
    }
    pitch = static_cast<LONG>(view.width);
  }

  LARGE_INTEGER t0{};
  QueryPerformanceCounter(&t0);

  CopyPlane(scanline0, pitch, view.y, view.stride_y, view.width, view.height);
  CopyPlane(scanline0 + static_cast<size_t>(pitch) * view.height, pitch, view.uv,
            view.stride_uv, view.width, view.height / 2);

  LARGE_INTEGER t1{};
  QueryPerformanceCounter(&t1);
  LARGE_INTEGER freq{};
  QueryPerformanceFrequency(&freq);
  if (freq.QuadPart > 0) {
    ctx->copy_us = static_cast<uint32_t>(((t1.QuadPart - t0.QuadPart) * 1'000'000) /
                                         freq.QuadPart);
  }

  if (locked_2d) {
    ctx->buffer2d->Unlock2D();
  } else {
    ctx->buffer->Unlock();
  }
  ctx->current_length = static_cast<DWORD>(required_length);
  ctx->frame_id = view.frame_id;
  ctx->capture_qpc = view.capture_qpc;
  ctx->flags = view.flags;
  ctx->ok = true;
  trace::CopyDuration(ctx->copy_us, static_cast<uint32_t>(pitch), view.stride_y);
  return true;
}

}  // namespace

MediaStream::MediaStream() {
  InitializeSRWLock(&lock_);
  Module::ObjectCreated(L"MediaStream");
}

MediaStream::~MediaStream() { Module::ObjectDestroyed(L"MediaStream"); }

HRESULT MediaStream::CreateInstance(MediaSource* source, IMFStreamDescriptor* descriptor,
                                    MediaStream** out) {
  if (source == nullptr || descriptor == nullptr || out == nullptr) {
    return E_POINTER;
  }
  *out = nullptr;
  auto* stream = new (std::nothrow) MediaStream();
  if (stream == nullptr) {
    return E_OUTOFMEMORY;
  }
  HRESULT hr = stream->Initialize(source, descriptor);
  if (FAILED(hr)) {
    stream->Release();
    return hr;
  }
  *out = stream;  // reference transferred
  return S_OK;
}

HRESULT MediaStream::Initialize(MediaSource* source, IMFStreamDescriptor* descriptor) {
  HRESULT hr = MFCreateEventQueue(&event_queue_);
  if (FAILED(hr)) {
    return hr;
  }
  hr = MFCreateAttributes(&attributes_, 8);
  if (FAILED(hr)) {
    return hr;
  }
  // Windows-Camera sets the four MF_DEVICESTREAM_* keys on BOTH the stream
  // attribute store and the stream descriptor.
  hr = attributes_->SetUINT32(MF_DEVICESTREAM_STREAM_ID, 0);
  if (FAILED(hr)) {
    return hr;
  }
  hr = attributes_->SetGUID(MF_DEVICESTREAM_STREAM_CATEGORY, PINNAME_VIDEO_CAPTURE);
  if (FAILED(hr)) {
    return hr;
  }
  hr = attributes_->SetUINT32(MF_DEVICESTREAM_ATTRIBUTE_FRAMESOURCE_TYPES,
                              MFFrameSourceTypes_Color);
  if (FAILED(hr)) {
    return hr;
  }
  hr = attributes_->SetUINT32(MF_DEVICESTREAM_FRAMESERVER_SHARED, 1);
  if (FAILED(hr)) {
    return hr;
  }
  descriptor_ = descriptor;
  hr = source->QueryInterface(IID_PPV_ARGS(&source_));
  if (FAILED(hr)) {
    return hr;
  }
  duration_hns_ = kHnsPerSecond * HENSHIN_VCAM_FPS_DEN / HENSHIN_VCAM_FPS_NUM;
  return S_OK;
}

HRESULT MediaStream::EnsureAllocator() {
  ComPtr<IMFMediaTypeHandler> handler;
  HRESULT hr = descriptor_->GetMediaTypeHandler(&handler);
  if (FAILED(hr)) {
    trace::MfError(L"GetMediaTypeHandler(allocator)", hr);
    return hr;
  }

  ComPtr<IMFMediaType> media_type;
  hr = handler->GetCurrentMediaType(&media_type);
  if (FAILED(hr)) {
    trace::MfError(L"GetCurrentMediaType(allocator)", hr);
    return hr;
  }

  BOOL same_type = FALSE;
  if (allocator_ && allocator_media_type_ &&
      SUCCEEDED(allocator_media_type_->Compare(media_type.Get(), MF_ATTRIBUTES_MATCH_ALL_ITEMS,
                                               &same_type)) &&
      same_type) {
    return S_OK;
  }

  ComPtr<IMFVideoSampleAllocator> allocator = provided_allocator_;
  if (!allocator) {
    hr = MFCreateVideoSampleAllocatorEx(IID_PPV_ARGS(&allocator));
    if (FAILED(hr)) {
      trace::MfError(L"MFCreateVideoSampleAllocatorEx", hr);
      return hr;
    }
  }
  hr = allocator->InitializeSampleAllocator(10, media_type.Get());
  if (FAILED(hr)) {
    trace::MfError(L"InitializeSampleAllocator", hr);
    return hr;
  }

  allocator_ = std::move(allocator);
  allocator_media_type_ = std::move(media_type);
  return S_OK;
}

HRESULT MediaStream::SetSampleAllocator(IMFVideoSampleAllocator* allocator) {
  if (allocator == nullptr) {
    return E_POINTER;
  }
  AcquireSRWLockExclusive(&lock_);
  HRESULT hr = CheckShutdown(L"SetSampleAllocator");
  if (SUCCEEDED(hr) && stream_state_ == MF_STREAM_STATE_RUNNING) {
    hr = MF_E_INVALIDREQUEST;
  }
  if (SUCCEEDED(hr)) {
    provided_allocator_ = allocator;
    allocator_.Reset();
    allocator_media_type_.Reset();
  }
  ReleaseSRWLockExclusive(&lock_);
  return hr;
}

IFACEMETHODIMP MediaStream::QueryInterface(REFIID riid, void** ppv) {
  if (ppv == nullptr) {
    return E_POINTER;
  }
  *ppv = nullptr;
  if (riid == IID_IUnknown || riid == IID_IMFMediaEventGenerator ||
      riid == IID_IMFMediaStream || riid == IID_IMFMediaStream2) {
    *ppv = static_cast<IMFMediaStream2*>(this);
    AddRef();
    return S_OK;
  }
  return E_NOINTERFACE;
}

IFACEMETHODIMP_(ULONG) MediaStream::AddRef() { return InterlockedIncrement(&ref_count_); }

IFACEMETHODIMP_(ULONG) MediaStream::Release() {
  const ULONG count = InterlockedDecrement(&ref_count_);
  if (count == 0) {
    delete this;
  }
  return count;
}

HRESULT MediaStream::CheckShutdown(const wchar_t* method) const {
  if (shutdown_) {
    trace::MethodAfterShutdown(method);
    return MF_E_SHUTDOWN;
  }
  return S_OK;
}

IFACEMETHODIMP MediaStream::BeginGetEvent(IMFAsyncCallback* callback, IUnknown* state) {
  AcquireSRWLockExclusive(&lock_);
  HRESULT hr = CheckShutdown(L"BeginGetEvent");
  ComPtr<IMFMediaEventQueue> queue = event_queue_;
  ReleaseSRWLockExclusive(&lock_);
  return SUCCEEDED(hr) ? queue->BeginGetEvent(callback, state) : hr;
}

IFACEMETHODIMP MediaStream::EndGetEvent(IMFAsyncResult* result, IMFMediaEvent** event) {
  AcquireSRWLockExclusive(&lock_);
  HRESULT hr = CheckShutdown(L"EndGetEvent");
  ComPtr<IMFMediaEventQueue> queue = event_queue_;
  ReleaseSRWLockExclusive(&lock_);
  return SUCCEEDED(hr) ? queue->EndGetEvent(result, event) : hr;
}

IFACEMETHODIMP MediaStream::GetEvent(DWORD flags, IMFMediaEvent** event) {
  AcquireSRWLockExclusive(&lock_);
  HRESULT hr = CheckShutdown(L"GetEvent");
  ComPtr<IMFMediaEventQueue> queue = event_queue_;
  ReleaseSRWLockExclusive(&lock_);
  // Released on purpose: GetEvent blocks when MF_EVENT_FLAG_NO_WAIT is absent.
  return SUCCEEDED(hr) ? queue->GetEvent(flags, event) : hr;
}

IFACEMETHODIMP MediaStream::QueueEvent(MediaEventType met, REFGUID extended_type, HRESULT status,
                                       const PROPVARIANT* value) {
  AcquireSRWLockExclusive(&lock_);
  HRESULT hr = CheckShutdown(L"QueueEvent");
  ComPtr<IMFMediaEventQueue> queue = event_queue_;
  ReleaseSRWLockExclusive(&lock_);
  return SUCCEEDED(hr) ? queue->QueueEventParamVar(met, extended_type, status, value) : hr;
}

IFACEMETHODIMP MediaStream::GetMediaSource(IMFMediaSource** source) {
  if (source == nullptr) {
    return E_POINTER;
  }
  AcquireSRWLockExclusive(&lock_);
  HRESULT hr = CheckShutdown(L"GetMediaSource");
  if (SUCCEEDED(hr)) {
    hr = source_ ? source_.CopyTo(source) : MF_E_SHUTDOWN;
  }
  ReleaseSRWLockExclusive(&lock_);
  return hr;
}

IFACEMETHODIMP MediaStream::GetStreamDescriptor(IMFStreamDescriptor** descriptor) {
  if (descriptor == nullptr) {
    return E_POINTER;
  }
  AcquireSRWLockExclusive(&lock_);
  HRESULT hr = CheckShutdown(L"GetStreamDescriptor");
  if (SUCCEEDED(hr)) {
    hr = descriptor_.CopyTo(descriptor);
  }
  ReleaseSRWLockExclusive(&lock_);
  return hr;
}

IFACEMETHODIMP MediaStream::RequestSample(IUnknown* token) {
  AcquireSRWLockExclusive(&lock_);
  HRESULT hr = CheckShutdown(L"RequestSample");
  if (FAILED(hr)) {
    ReleaseSRWLockExclusive(&lock_);
    return hr;
  }
  if (stream_state_ == MF_STREAM_STATE_PAUSED) {
    ReleaseSRWLockExclusive(&lock_);
    return MF_E_INVALIDREQUEST;
  }
  if (stream_state_ != MF_STREAM_STATE_RUNNING) {
    ReleaseSRWLockExclusive(&lock_);
    return MF_E_MEDIA_SOURCE_WRONGSTATE;
  }

  // Bounded FIFO: past two pending requests the oldest is abandoned rather
  // than accumulating latency behind a consumer that is already behind.
  if (request_count_ == kMaxPendingRequests) {
    requests_[request_head_].token.Reset();
    requests_[request_head_].in_use = false;
    request_head_ = (request_head_ + 1) % kMaxPendingRequests;
    --request_count_;
    trace::RequestDropped(L"queue full", request_count_);
  }

  const uint32_t slot = (request_head_ + request_count_) % kMaxPendingRequests;
  requests_[slot].token = token;  // never ignored: reattached to the delivered sample
  requests_[slot].in_use = true;
  ++request_count_;
  trace::RequestSample(request_count_, static_cast<uint32_t>(stream_state_));
  ReleaseSRWLockExclusive(&lock_);
  return S_OK;
}

IFACEMETHODIMP MediaStream::SetStreamState(MF_STREAM_STATE state) {
  AcquireSRWLockExclusive(&lock_);
  HRESULT hr = CheckShutdown(L"SetStreamState");
  if (SUCCEEDED(hr)) {
    switch (state) {
      case MF_STREAM_STATE_RUNNING:
        hr = EnsureAllocator();
        if (SUCCEEDED(hr)) {
          stream_state_ = state;
        }
        break;
      case MF_STREAM_STATE_STOPPED:
        stream_state_ = state;
        break;
      case MF_STREAM_STATE_PAUSED:
        // Windows-Camera 2022-07-04: PAUSE does not stop the stream, but
        // RequestSample is rejected. IMFMediaSource::Pause stays invalid.
        if (stream_state_ != MF_STREAM_STATE_RUNNING &&
            stream_state_ != MF_STREAM_STATE_PAUSED) {
          hr = MF_E_INVALID_STATE_TRANSITION;
        } else {
          stream_state_ = MF_STREAM_STATE_PAUSED;
        }
        break;
      default:
        hr = MF_E_INVALIDREQUEST;
        break;
    }
  }
  ReleaseSRWLockExclusive(&lock_);
  return hr;
}

IFACEMETHODIMP MediaStream::GetStreamState(MF_STREAM_STATE* state) {
  if (state == nullptr) {
    return E_POINTER;
  }
  AcquireSRWLockExclusive(&lock_);
  HRESULT hr = CheckShutdown(L"GetStreamState");
  if (SUCCEEDED(hr)) {
    *state = stream_state_;
  }
  ReleaseSRWLockExclusive(&lock_);
  return hr;
}

HRESULT MediaStream::Start() {
  AcquireSRWLockExclusive(&lock_);
  HRESULT hr = CheckShutdown(L"Start");
  if (SUCCEEDED(hr)) {
    hr = EnsureAllocator();
    if (SUCCEEDED(hr)) {
      stream_state_ = MF_STREAM_STATE_RUNNING;
      last_sample_time_hns_ = -1;
    }
  }
  ComPtr<IMFMediaEventQueue> queue = event_queue_;
  ReleaseSRWLockExclusive(&lock_);
  if (SUCCEEDED(hr)) {
    hr = queue->QueueEventParamVar(MEStreamStarted, GUID_NULL, S_OK, nullptr);
  }
  return hr;
}

HRESULT MediaStream::Stop() {
  AcquireSRWLockExclusive(&lock_);
  HRESULT hr = CheckShutdown(L"Stop");
  if (SUCCEEDED(hr)) {
    stream_state_ = MF_STREAM_STATE_STOPPED;
  }
  ComPtr<IMFMediaEventQueue> queue = event_queue_;
  ReleaseSRWLockExclusive(&lock_);
  ReleasePendingRequests(L"stream stopped");
  if (SUCCEEDED(hr)) {
    hr = queue->QueueEventParamVar(MEStreamStopped, GUID_NULL, S_OK, nullptr);
  }
  return hr;
}

void MediaStream::Shutdown() {
  ComPtr<IMFMediaEventQueue> queue;
  uint32_t released = 0;

  AcquireSRWLockExclusive(&lock_);
  shutdown_ = true;
  stream_state_ = MF_STREAM_STATE_STOPPED;
  for (auto& request : requests_) {
    if (request.in_use) {
      ++released;
    }
    request.token.Reset();
    request.in_use = false;
  }
  request_count_ = 0;
  request_head_ = 0;
  queue = event_queue_;
  event_queue_.Reset();
  descriptor_.Reset();
  attributes_.Reset();
  source_.Reset();  // breaks the source <-> stream cycle
  provided_allocator_.Reset();
  allocator_.Reset();
  allocator_media_type_.Reset();
  ReleaseSRWLockExclusive(&lock_);

  if (queue) {
    queue->Shutdown();
  }
  if (released > 0) {
    trace::RequestDropped(L"shutdown", released);
  }
}

void MediaStream::ReleasePendingRequests(const wchar_t* reason) {
  uint32_t released = 0;
  AcquireSRWLockExclusive(&lock_);
  for (auto& request : requests_) {
    if (request.in_use) {
      ++released;
    }
    request.token.Reset();
    request.in_use = false;
  }
  request_count_ = 0;
  request_head_ = 0;
  ReleaseSRWLockExclusive(&lock_);
  if (released > 0) {
    // Unsatisfiable requests are released; the stream never ends.
    trace::RequestDropped(reason, released);
  }
}

uint32_t MediaStream::pending_requests() {
  AcquireSRWLockShared(&lock_);
  const uint32_t count = request_count_;
  ReleaseSRWLockShared(&lock_);
  return count;
}

HRESULT MediaStream::GetAttributes(IMFAttributes** out) {
  if (out == nullptr) {
    return E_POINTER;
  }
  AcquireSRWLockExclusive(&lock_);
  HRESULT hr = CheckShutdown(L"GetAttributes");
  if (SUCCEEDED(hr)) {
    hr = attributes_.CopyTo(out);
  }
  ReleaseSRWLockExclusive(&lock_);
  return hr;
}

int64_t MediaStream::NextSampleTime(uint64_t capture_qpc, uint64_t epoch_qpc,
                                    int64_t epoch_hns, uint64_t qpc_frequency) {
  const uint64_t delta = capture_qpc > epoch_qpc ? capture_qpc - epoch_qpc : 0;
  // Capture sources use the same absolute 100-ns timeline as
  // MESourceStarted/MFGetSystemTime. A relative-to-zero sample timestamp is
  // stale compared with that source-start position and FrameServer drops it.
  int64_t candidate = epoch_hns + QpcDeltaToHns(delta, qpc_frequency);
  if (last_sample_time_hns_ >= 0 && candidate <= last_sample_time_hns_) {
    // Generation change, resume from sleep or a long gap: advance by exactly
    // one frame duration rather than ever going backwards.
    const int64_t corrected = last_sample_time_hns_ + duration_hns_;
    trace::MonotonicityForced(last_sample_time_hns_, candidate, corrected);
    candidate = corrected;
  }
  last_sample_time_hns_ = candidate;
  return candidate;
}

bool MediaStream::PumpFrame(BridgeReader& reader, uint64_t epoch_qpc, int64_t epoch_hns,
                            uint64_t qpc_frequency) {
  // State is checked under the COM lock, but the lock is released before the
  // ~1.4 MB copy: the state machine and the frame path never contend.
  AcquireSRWLockExclusive(&lock_);
  const bool can_deliver =
      !shutdown_ && stream_state_ == MF_STREAM_STATE_RUNNING && request_count_ > 0;
  ComPtr<IMFMediaEventQueue> queue = event_queue_;
  ComPtr<IMFVideoSampleAllocator> allocator = allocator_;
  ReleaseSRWLockExclusive(&lock_);
  if (!can_deliver || !queue || !allocator) {
    return false;
  }

  ComPtr<IMFSample> sample;
  HRESULT hr = allocator->AllocateSample(&sample);
  if (FAILED(hr)) {
    trace::MfError(L"AllocateSample", hr);
    return false;
  }
  ComPtr<IMFMediaBuffer> buffer;
  hr = sample->GetBufferByIndex(0, &buffer);
  if (FAILED(hr)) {
    trace::MfError(L"GetBufferByIndex", hr);
    return false;
  }
  ComPtr<IMF2DBuffer2> buffer2d;
  (void)buffer.As(&buffer2d);  // Some allocators expose only IMFMediaBuffer.

  CopyContext ctx{};
  ctx.buffer = buffer.Get();
  ctx.buffer2d = buffer2d.Get();
  bool delivered_by_reader = false;
  const BridgeStatus status = reader.TryRead(CopyIntoBuffer, &ctx, &delivered_by_reader);
  if (status != BridgeStatus::Ok) {
    trace::BridgeInvalid(BridgeStatusName(status));
    return false;
  }
  if (!delivered_by_reader || !ctx.ok) {
    return false;  // no fresh frame: the request stays pending
  }

  DWORD current_length = ctx.current_length;
  if (buffer2d) {
    DWORD contiguous_length = 0;
    if (SUCCEEDED(buffer2d->GetContiguousLength(&contiguous_length))) {
      current_length = contiguous_length;
    }
  }
  hr = buffer->SetCurrentLength(current_length);
  if (FAILED(hr)) {
    trace::MfError(L"SetCurrentLength", hr);
    return false;
  }

  // Take the request only once a real sample exists, so a failed read never
  // consumes a pending request.
  ComPtr<IUnknown> token;
  bool have_request = false;
  int64_t sample_time = 0;

  AcquireSRWLockExclusive(&lock_);
  if (!shutdown_ && stream_state_ == MF_STREAM_STATE_RUNNING && request_count_ > 0) {
    token = requests_[request_head_].token;
    requests_[request_head_].token.Reset();
    requests_[request_head_].in_use = false;
    request_head_ = (request_head_ + 1) % kMaxPendingRequests;
    --request_count_;
    have_request = true;
    sample_time = NextSampleTime(ctx.capture_qpc, epoch_qpc, epoch_hns, qpc_frequency);
  }
  const int64_t duration = duration_hns_;
  ReleaseSRWLockExclusive(&lock_);

  if (!have_request) {
    return false;
  }

  sample->SetSampleTime(sample_time);
  sample->SetSampleDuration(duration);
  if (token) {
    // pToken is never ignored: it rides back on the delivered sample.
    sample->SetUnknown(MFSampleExtension_Token, token.Get());
  }

  hr = queue->QueueEventParamUnk(MEMediaSample, GUID_NULL, S_OK, sample.Get());
  if (FAILED(hr)) {
    trace::MfError(L"QueueEvent(MEMediaSample)", hr);
    return false;
  }

  uint64_t frame_age_us = 0;
  if (qpc_frequency > 0) {
    LARGE_INTEGER now{};
    QueryPerformanceCounter(&now);
    const uint64_t now_qpc = static_cast<uint64_t>(now.QuadPart);
    if (now_qpc > ctx.capture_qpc) {
      frame_age_us = ((now_qpc - ctx.capture_qpc) * 1'000'000) / qpc_frequency;
    }
  }
  trace::SampleDelivered(ctx.frame_id, sample_time, duration, frame_age_us, ctx.copy_us);
  trace::FrameAge(frame_age_us, ctx.frame_id);
  return true;
}

void MediaStream::EmitStreamTick(uint64_t now_qpc, uint64_t epoch_qpc, int64_t epoch_hns,
                                 uint64_t qpc_frequency) {
  AcquireSRWLockExclusive(&lock_);
  const bool active = !shutdown_ && stream_state_ == MF_STREAM_STATE_RUNNING;
  const uint32_t pending = request_count_;
  ComPtr<IMFMediaEventQueue> queue = event_queue_;
  ReleaseSRWLockExclusive(&lock_);
  if (!active || !queue) {
    return;
  }

  // Short gap: no fabricated frame, no fabricated timestamp on a sample, and
  // above all never MEEndOfStream. A camera does not end.
  const uint64_t delta = now_qpc > epoch_qpc ? now_qpc - epoch_qpc : 0;
  const int64_t tick_time = epoch_hns + QpcDeltaToHns(delta, qpc_frequency);
  PROPVARIANT value{};
  value.vt = VT_I8;
  value.hVal.QuadPart = tick_time;
  queue->QueueEventParamVar(MEStreamTick, GUID_NULL, S_OK, &value);
  trace::StreamTick(tick_time, pending);
}

}  // namespace henshin
