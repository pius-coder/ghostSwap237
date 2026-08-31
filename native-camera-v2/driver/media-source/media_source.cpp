#include <initguid.h>
#include "media_source.h"

#include <ks.h>
#include <ksmedia.h>
#include <mfapi.h>
#include <mferror.h>
#include <process.h>
#include <propvarutil.h>

#include <new>

#include "../com/module.h"
#include "vcam_ids.h"
#include "../media-stream/media_stream.h"
#include "../trace/etw.h"

using Microsoft::WRL::ComPtr;

#ifndef PINNAME_VIDEO_CAPTURE
// ksmedia.h fallback used when the shared kit header is not on the include path.
DEFINE_GUID(PINNAME_VIDEO_CAPTURE, 0xfb6c4281, 0x0353, 0x11d1, 0x90, 0x5f, 0x00, 0x00, 0xc0, 0xcc,
            0x16, 0xba);
#endif

namespace henshin {
namespace {

constexpr DWORD kPollMs = 33;       // ~30 Hz, never blocks RequestSample
constexpr DWORD kTickGapMs = 100;   // short-gap MEStreamTick cadence
constexpr uint64_t kStaleSeconds = 1;

HRESULT SetSize(IMFAttributes* attrs, const GUID& key, UINT32 width, UINT32 height) {
  const UINT64 packed = (static_cast<UINT64>(width) << 32) | height;
  return attrs->SetUINT64(key, packed);
}

HRESULT SetRatio(IMFAttributes* attrs, const GUID& key, UINT32 num, UINT32 den) {
  const UINT64 packed = (static_cast<UINT64>(num) << 32) | den;
  return attrs->SetUINT64(key, packed);
}

}  // namespace

MediaSource::MediaSource() {
  InitializeSRWLock(&lock_);
  Module::ObjectCreated(L"MediaSource");
}

MediaSource::~MediaSource() {
  StopWorker();
  Module::ObjectDestroyed(L"MediaSource");
}

HRESULT MediaSource::CreateInstance(REFIID riid, void** ppv, IMFAttributes* activate_attrs) {
  if (ppv == nullptr) {
    return E_POINTER;
  }
  *ppv = nullptr;
  auto* source = new (std::nothrow) MediaSource();
  if (source == nullptr) {
    return E_OUTOFMEMORY;
  }
  HRESULT hr = source->Initialize(activate_attrs);
  if (SUCCEEDED(hr)) {
    hr = source->QueryInterface(riid, ppv);
  }
  source->Release();
  return hr;
}

HRESULT MediaSource::CreateMediaType(IMFMediaType** out) {
  ComPtr<IMFMediaType> type;
  HRESULT hr = MFCreateMediaType(&type);
  if (FAILED(hr)) {
    return hr;
  }
  hr = type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
  if (FAILED(hr)) {
    return hr;
  }
  hr = type->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_NV12);
  if (FAILED(hr)) {
    return hr;
  }
  hr = type->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
  if (FAILED(hr)) {
    return hr;
  }
  hr = type->SetUINT32(MF_MT_ALL_SAMPLES_INDEPENDENT, TRUE);
  if (FAILED(hr)) {
    return hr;
  }
  hr = SetSize(type.Get(), MF_MT_FRAME_SIZE, HENSHIN_VCAM_WIDTH, HENSHIN_VCAM_HEIGHT);
  if (FAILED(hr)) {
    return hr;
  }
  hr = SetRatio(type.Get(), MF_MT_FRAME_RATE, HENSHIN_VCAM_FPS_NUM, HENSHIN_VCAM_FPS_DEN);
  if (FAILED(hr)) {
    return hr;
  }
  hr = SetRatio(type.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
  if (FAILED(hr)) {
    return hr;
  }
  hr = type->SetUINT32(MF_MT_YUV_MATRIX, MFVideoTransferMatrix_BT709);
  if (FAILED(hr)) {
    return hr;
  }
  hr = type->SetUINT32(MF_MT_VIDEO_NOMINAL_RANGE, MFNominalRange_16_235);
  if (FAILED(hr)) {
    return hr;
  }
  hr = type->SetUINT32(MF_MT_TRANSFER_FUNCTION, MFVideoTransFunc_709);
  if (FAILED(hr)) {
    return hr;
  }
  hr = type->SetUINT32(MF_MT_VIDEO_PRIMARIES, MFVideoPrimaries_BT709);
  if (FAILED(hr)) {
    return hr;
  }
  const UINT32 bitrate =
      static_cast<UINT32>(HENSHIN_VCAM_WIDTH * HENSHIN_VCAM_HEIGHT * 12 * 30);
  hr = type->SetUINT32(MF_MT_AVG_BITRATE, bitrate);
  if (FAILED(hr)) {
    return hr;
  }
  *out = type.Detach();
  return S_OK;
}

HRESULT MediaSource::SetDeviceStreamAttributes(IMFAttributes* attrs) {
  HRESULT hr = attrs->SetUINT32(MF_DEVICESTREAM_STREAM_ID, 0);
  if (FAILED(hr)) {
    return hr;
  }
  hr = attrs->SetGUID(MF_DEVICESTREAM_STREAM_CATEGORY, PINNAME_VIDEO_CAPTURE);
  if (FAILED(hr)) {
    return hr;
  }
  hr = attrs->SetUINT32(MF_DEVICESTREAM_ATTRIBUTE_FRAMESOURCE_TYPES, MFFrameSourceTypes_Color);
  if (FAILED(hr)) {
    return hr;
  }
  return attrs->SetUINT32(MF_DEVICESTREAM_FRAMESERVER_SHARED, 1);
}

HRESULT MediaSource::PublishSensorProfiles() {
  // Legacy profile is mandatory so non-profile-aware apps still enumerate us
  // (Windows-Camera SimpleMediaSource::_CreateSourceAttributes).
  ComPtr<IMFSensorProfileCollection> collection;
  HRESULT hr = MFCreateSensorProfileCollection(&collection);
  if (FAILED(hr)) {
    return S_OK;  // older SDKs: skip, do not fail construction
  }
  ComPtr<IMFSensorProfile> legacy;
  hr = MFCreateSensorProfile(KSCAMERAPROFILE_Legacy, 0, nullptr, &legacy);
  if (SUCCEEDED(hr)) {
    (void)legacy->AddProfileFilter(0, L"((RES==;FRT<=30,1;SUT==))");
    (void)collection->AddProfile(legacy.Get());
  }
  ComPtr<IMFSensorProfile> high;
  hr = MFCreateSensorProfile(KSCAMERAPROFILE_HighFrameRate, 0, nullptr, &high);
  if (SUCCEEDED(hr)) {
    (void)high->AddProfileFilter(0, L"((RES==;FRT>=60,1;SUT==))");
    (void)collection->AddProfile(high.Get());
  }
  (void)attributes_->SetUnknown(MF_DEVICEMFT_SENSORPROFILE_COLLECTION, collection.Get());
  return S_OK;
}

HRESULT MediaSource::Initialize(IMFAttributes* activate_attrs) {
  LARGE_INTEGER freq{};
  QueryPerformanceFrequency(&freq);
  qpc_frequency_ = static_cast<uint64_t>(freq.QuadPart);
  stale_after_qpc_ = qpc_frequency_ * kStaleSeconds;

  HRESULT hr = MFCreateEventQueue(&event_queue_);
  if (FAILED(hr)) {
    return hr;
  }
  // Live store: GetSourceAttributes must return this pointer, not a clone
  // (Windows-Camera README, 2022-07-04 critical fix).
  hr = MFCreateAttributes(&attributes_, 8);
  if (FAILED(hr)) {
    return hr;
  }
  if (activate_attrs != nullptr) {
    // Learn: if IMFActivate and IMFMediaSource are different objects, copy
    // every activate attribute into the source store.
    hr = activate_attrs->CopyAllItems(attributes_.Get());
    if (FAILED(hr)) {
      return hr;
    }
  }
  hr = attributes_->SetGUID(MFT_TRANSFORM_CLSID_Attribute, CLSID_HenshinVirtualCamera);
  if (FAILED(hr)) {
    return hr;
  }
  hr = PublishSensorProfiles();
  if (FAILED(hr)) {
    return hr;
  }

  ComPtr<IMFMediaType> type;
  hr = CreateMediaType(&type);
  if (FAILED(hr)) {
    return hr;
  }
  IMFMediaType* types[] = {type.Get()};
  ComPtr<IMFStreamDescriptor> descriptor;
  hr = MFCreateStreamDescriptor(0, 1, types, &descriptor);
  if (FAILED(hr)) {
    return hr;
  }
  ComPtr<IMFMediaTypeHandler> handler;
  hr = descriptor->GetMediaTypeHandler(&handler);
  if (FAILED(hr)) {
    return hr;
  }
  hr = handler->SetCurrentMediaType(type.Get());
  if (FAILED(hr)) {
    return hr;
  }
  hr = SetDeviceStreamAttributes(descriptor.Get());
  if (FAILED(hr)) {
    return hr;
  }

  IMFStreamDescriptor* streams[] = {descriptor.Get()};
  hr = MFCreatePresentationDescriptor(1, streams, &descriptor_);
  if (FAILED(hr)) {
    return hr;
  }
  hr = descriptor_->SelectStream(0);
  if (FAILED(hr)) {
    return hr;
  }

  MediaStream* stream = nullptr;
  hr = MediaStream::CreateInstance(this, descriptor.Get(), &stream);
  if (FAILED(hr)) {
    return hr;
  }
  stream_.Attach(stream);

  // Construction succeeds without a producer. FrameServer enumerates types
  // with the application off (ARCHITECTURE 7).
  const BridgeStatus opened = reader_.Open();
  if (opened == BridgeStatus::Ok) {
    producer_state_ = ProducerState::ProducerHealthy;
    trace::BridgeOpened(reader_.layout().width, reader_.layout().height,
                        reader_.layout().fps_num, reader_.layout().fps_den);
  } else if (opened == BridgeStatus::UnsupportedVersion) {
    trace::ProtocolMismatch(1, PROTOCOL_MAJOR);
    producer_state_ = ProducerState::NoProducer;
  } else {
    producer_state_ = ProducerState::NoProducer;
  }

  state_ = SourceState::Stopped;
  return S_OK;
}

IFACEMETHODIMP MediaSource::QueryInterface(REFIID riid, void** ppv) {
  if (ppv == nullptr) {
    return E_POINTER;
  }
  *ppv = nullptr;
  if (riid == IID_IUnknown || riid == IID_IMFMediaEventGenerator || riid == IID_IMFMediaSource ||
      riid == IID_IMFMediaSourceEx) {
    *ppv = static_cast<IMFMediaSourceEx*>(this);
  } else if (riid == IID_IMFGetService) {
    *ppv = static_cast<IMFGetService*>(this);
  } else if (riid == __uuidof(IKsControl)) {
    *ppv = static_cast<IKsControl*>(this);
  } else if (riid == IID_IMFSampleAllocatorControl) {
    *ppv = static_cast<IMFSampleAllocatorControl*>(this);
  } else {
    return E_NOINTERFACE;
  }
  AddRef();
  return S_OK;
}

IFACEMETHODIMP_(ULONG) MediaSource::AddRef() { return InterlockedIncrement(&ref_count_); }

IFACEMETHODIMP_(ULONG) MediaSource::Release() {
  const ULONG count = InterlockedDecrement(&ref_count_);
  if (count == 0) {
    delete this;
  }
  return count;
}

HRESULT MediaSource::CheckShutdown(const wchar_t* method) const {
  if (state_ == SourceState::Shutdown) {
    trace::MethodAfterShutdown(method);
    return MF_E_SHUTDOWN;
  }
  return S_OK;
}

SourceState MediaSource::state() {
  AcquireSRWLockShared(&lock_);
  const SourceState s = state_;
  ReleaseSRWLockShared(&lock_);
  return s;
}

IFACEMETHODIMP MediaSource::BeginGetEvent(IMFAsyncCallback* callback, IUnknown* state) {
  AcquireSRWLockExclusive(&lock_);
  HRESULT hr = CheckShutdown(L"BeginGetEvent");
  ComPtr<IMFMediaEventQueue> queue = event_queue_;
  ReleaseSRWLockExclusive(&lock_);
  return SUCCEEDED(hr) ? queue->BeginGetEvent(callback, state) : hr;
}

IFACEMETHODIMP MediaSource::EndGetEvent(IMFAsyncResult* result, IMFMediaEvent** event) {
  AcquireSRWLockExclusive(&lock_);
  HRESULT hr = CheckShutdown(L"EndGetEvent");
  ComPtr<IMFMediaEventQueue> queue = event_queue_;
  ReleaseSRWLockExclusive(&lock_);
  return SUCCEEDED(hr) ? queue->EndGetEvent(result, event) : hr;
}

IFACEMETHODIMP MediaSource::GetEvent(DWORD flags, IMFMediaEvent** event) {
  AcquireSRWLockExclusive(&lock_);
  HRESULT hr = CheckShutdown(L"GetEvent");
  ComPtr<IMFMediaEventQueue> queue = event_queue_;
  ReleaseSRWLockExclusive(&lock_);
  // Released on purpose: GetEvent can block (Windows-Camera SimpleMediaStream).
  return SUCCEEDED(hr) ? queue->GetEvent(flags, event) : hr;
}

IFACEMETHODIMP MediaSource::QueueEvent(MediaEventType met, REFGUID extended_type, HRESULT status,
                                       const PROPVARIANT* value) {
  AcquireSRWLockExclusive(&lock_);
  HRESULT hr = CheckShutdown(L"QueueEvent");
  ComPtr<IMFMediaEventQueue> queue = event_queue_;
  ReleaseSRWLockExclusive(&lock_);
  return SUCCEEDED(hr) ? queue->QueueEventParamVar(met, extended_type, status, value) : hr;
}

IFACEMETHODIMP MediaSource::CreatePresentationDescriptor(IMFPresentationDescriptor** pd) {
  if (pd == nullptr) {
    return E_POINTER;
  }
  AcquireSRWLockExclusive(&lock_);
  HRESULT hr = CheckShutdown(L"CreatePresentationDescriptor");
  if (SUCCEEDED(hr)) {
    hr = descriptor_->Clone(pd);
  }
  ReleaseSRWLockExclusive(&lock_);
  return hr;
}

IFACEMETHODIMP MediaSource::GetCharacteristics(DWORD* characteristics) {
  if (characteristics == nullptr) {
    return E_POINTER;
  }
  AcquireSRWLockExclusive(&lock_);
  HRESULT hr = CheckShutdown(L"GetCharacteristics");
  if (SUCCEEDED(hr)) {
    *characteristics = MFMEDIASOURCE_IS_LIVE;
  }
  ReleaseSRWLockExclusive(&lock_);
  return hr;
}

IFACEMETHODIMP MediaSource::Pause() {
  AcquireSRWLockExclusive(&lock_);
  HRESULT hr = CheckShutdown(L"Pause");
  ReleaseSRWLockExclusive(&lock_);
  if (FAILED(hr)) {
    return hr;
  }
  return MF_E_INVALID_STATE_TRANSITION;
}

IFACEMETHODIMP MediaSource::Start(IMFPresentationDescriptor* pd, const GUID* time_format,
                                  const PROPVARIANT* start_position) {
  AcquireSRWLockExclusive(&lock_);
  HRESULT hr = CheckShutdown(L"Start");
  if (FAILED(hr)) {
    ReleaseSRWLockExclusive(&lock_);
    trace::SourceStart(0, hr);
    return hr;
  }
  if (pd == nullptr) {
    ReleaseSRWLockExclusive(&lock_);
    return E_INVALIDARG;
  }
  // NULL or VT_EMPTY start position means "from the current position"
  // (Windows-Camera SimpleMediaSource). A live camera has no seek position,
  // so any other value is deliberately ignored.
  (void)start_position;
  if (time_format != nullptr && *time_format != GUID_NULL) {
    ReleaseSRWLockExclusive(&lock_);
    return MF_E_UNSUPPORTED_TIME_FORMAT;
  }
  ComPtr<IMFMediaEventQueue> queue = event_queue_;
  ComPtr<MediaStream> stream = stream_;
  const bool already = stream_was_started_;
  const bool need_worker = SUCCEEDED(hr) && worker_ == nullptr;
  if (SUCCEEDED(hr)) {
    LARGE_INTEGER now{};
    QueryPerformanceCounter(&now);
    epoch_qpc_ = static_cast<uint64_t>(now.QuadPart);
    epoch_hns_ = MFGetSystemTime();
    state_ = SourceState::Started;
    stream_was_started_ = true;
  }
  ReleaseSRWLockExclusive(&lock_);
  if (FAILED(hr)) {
    trace::SourceStart(0, hr);
    return hr;
  }

  // Windows-Camera SimpleMediaSource order: MENewStream/MEUpdatedStream,
  // then the stream's own MEStreamStarted, then MESourceStarted.
  ComPtr<IUnknown> unk;
  stream.As(&unk);
  const MediaEventType met = already ? MEUpdatedStream : MENewStream;
  hr = queue->QueueEventParamUnk(met, GUID_NULL, S_OK, unk.Get());
  if (FAILED(hr)) {
    trace::SourceStart(0, hr);
    return hr;
  }
  hr = stream->Start();
  if (FAILED(hr)) {
    trace::SourceStart(0, hr);
    return hr;
  }

  PROPVARIANT start{};
  InitPropVariantFromInt64(epoch_hns_, &start);
  hr = queue->QueueEventParamVar(MESourceStarted, GUID_NULL, S_OK, &start);
  PropVariantClear(&start);

  if (SUCCEEDED(hr) && need_worker) {
    worker_stop_ = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (worker_stop_ == nullptr) {
      hr = HRESULT_FROM_WIN32(GetLastError());
    } else {
      unsigned id = 0;
      worker_ = reinterpret_cast<HANDLE>(_beginthreadex(nullptr, 0, FrameWorkerThunk, this, 0, &id));
      if (worker_ == nullptr) {
        hr = E_OUTOFMEMORY;
      }
    }
  }
  trace::SourceStart(0, hr);
  return hr;
}

IFACEMETHODIMP MediaSource::Stop() {
  AcquireSRWLockExclusive(&lock_);
  HRESULT hr = CheckShutdown(L"Stop");
  if (SUCCEEDED(hr) && state_ != SourceState::Started) {
    hr = MF_E_INVALID_STATE_TRANSITION;
  }
  ComPtr<IMFMediaEventQueue> queue = event_queue_;
  ComPtr<MediaStream> stream = stream_;
  if (SUCCEEDED(hr)) {
    state_ = SourceState::Stopped;
  }
  ReleaseSRWLockExclusive(&lock_);
  if (FAILED(hr)) {
    trace::SourceStop(hr);
    return hr;
  }

  StopWorker();
  if (stream) {
    stream->Stop();
  }
  hr = queue->QueueEventParamVar(MESourceStopped, GUID_NULL, S_OK, nullptr);
  trace::SourceStop(hr);
  return hr;
}

IFACEMETHODIMP MediaSource::Shutdown() {
  uint32_t released = 0;
  ComPtr<IMFMediaEventQueue> queue;
  ComPtr<MediaStream> stream;

  AcquireSRWLockExclusive(&lock_);
  if (state_ == SourceState::Shutdown) {
    ReleaseSRWLockExclusive(&lock_);
    return S_OK;  // idempotent: IMFVirtualCamera teardown calls Shutdown twice
  }
  state_ = SourceState::Shutdown;
  queue = event_queue_;
  event_queue_.Reset();
  stream = stream_;
  stream_.Reset();
  attributes_.Reset();
  descriptor_.Reset();
  if (stream) {
    released = stream->pending_requests();
  }
  ReleaseSRWLockExclusive(&lock_);

  StopWorker();
  reader_.Close();
  if (stream) {
    stream->Shutdown();
  }
  if (queue) {
    queue->Shutdown();
  }
  trace::SourceShutdown(released);
  return S_OK;
}

IFACEMETHODIMP MediaSource::GetSourceAttributes(IMFAttributes** attributes) {
  if (attributes == nullptr) {
    return E_POINTER;
  }
  AcquireSRWLockExclusive(&lock_);
  HRESULT hr = CheckShutdown(L"GetSourceAttributes");
  if (SUCCEEDED(hr)) {
    hr = attributes_.CopyTo(attributes);
  }
  ReleaseSRWLockExclusive(&lock_);
  return hr;
}

IFACEMETHODIMP MediaSource::GetStreamAttributes(DWORD stream_id, IMFAttributes** attributes) {
  if (attributes == nullptr) {
    return E_POINTER;
  }
  *attributes = nullptr;
  if (stream_id != 0) {
    return MF_E_INVALIDSTREAMNUMBER;
  }
  AcquireSRWLockExclusive(&lock_);
  HRESULT hr = CheckShutdown(L"GetStreamAttributes");
  ComPtr<MediaStream> stream = stream_;
  ReleaseSRWLockExclusive(&lock_);
  if (FAILED(hr)) {
    return hr;
  }
  if (!stream) {
    return E_UNEXPECTED;
  }
  return stream->GetAttributes(attributes);
}

IFACEMETHODIMP MediaSource::SetD3DManager(IUnknown*) {
  // GstVCam: refuse the D3D manager so the allocator stays CPU-backed. CPU
  // writes into a GPU surface force a copy + fence every frame.
  AcquireSRWLockExclusive(&lock_);
  HRESULT hr = CheckShutdown(L"SetD3DManager");
  ReleaseSRWLockExclusive(&lock_);
  return SUCCEEDED(hr) ? S_OK : hr;
}

IFACEMETHODIMP MediaSource::GetService(REFGUID, REFIID, LPVOID* ppv) {
  if (ppv == nullptr) {
    return E_POINTER;
  }
  *ppv = nullptr;
  return MF_E_UNSUPPORTED_SERVICE;
}

IFACEMETHODIMP MediaSource::KsProperty(PKSPROPERTY property, ULONG, LPVOID, ULONG,
                                       ULONG* bytes_returned) {
  if (property == nullptr || bytes_returned == nullptr) {
    return E_POINTER;
  }
  *bytes_returned = 0;
  return HRESULT_FROM_WIN32(ERROR_SET_NOT_FOUND);
}

IFACEMETHODIMP MediaSource::KsMethod(PKSMETHOD method, ULONG, LPVOID, ULONG,
                                     ULONG* bytes_returned) {
  if (method == nullptr || bytes_returned == nullptr) {
    return E_POINTER;
  }
  *bytes_returned = 0;
  return HRESULT_FROM_WIN32(ERROR_SET_NOT_FOUND);
}

IFACEMETHODIMP MediaSource::KsEvent(PKSEVENT, ULONG, LPVOID, ULONG, ULONG* bytes_returned) {
  if (bytes_returned != nullptr) {
    *bytes_returned = 0;
  }
  return HRESULT_FROM_WIN32(ERROR_SET_NOT_FOUND);
}

IFACEMETHODIMP MediaSource::SetDefaultAllocator(DWORD stream_id, IUnknown* allocator) {
  if (allocator == nullptr) {
    return E_POINTER;
  }
  if (stream_id != 0) {
    return MF_E_INVALIDSTREAMNUMBER;
  }

  ComPtr<IMFVideoSampleAllocator> video_allocator;
  HRESULT hr = allocator->QueryInterface(IID_PPV_ARGS(&video_allocator));
  if (FAILED(hr)) {
    return hr;
  }

  AcquireSRWLockExclusive(&lock_);
  hr = CheckShutdown(L"SetDefaultAllocator");
  ComPtr<MediaStream> stream = stream_;
  ReleaseSRWLockExclusive(&lock_);
  if (FAILED(hr)) {
    return hr;
  }
  return stream ? stream->SetSampleAllocator(video_allocator.Get()) : MF_E_SHUTDOWN;
}

IFACEMETHODIMP MediaSource::GetAllocatorUsage(DWORD stream_id, DWORD* input_stream_id,
                                              MFSampleAllocatorUsage* usage) {
  if (usage == nullptr || input_stream_id == nullptr) {
    return E_POINTER;
  }
  if (stream_id != 0) {
    return MF_E_INVALIDSTREAMNUMBER;
  }
  AcquireSRWLockShared(&lock_);
  const HRESULT hr = CheckShutdown(L"GetAllocatorUsage");
  ReleaseSRWLockShared(&lock_);
  if (FAILED(hr)) {
    return hr;
  }
  *input_stream_id = stream_id;
  *usage = MFSampleAllocatorUsage_UsesProvidedAllocator;
  return S_OK;
}

unsigned __stdcall MediaSource::FrameWorkerThunk(void* context) {
  static_cast<MediaSource*>(context)->FrameWorker();
  return 0;
}

void MediaSource::StopWorker() {
  if (worker_stop_ != nullptr) {
    SetEvent(worker_stop_);
  }
  if (worker_ != nullptr) {
    WaitForSingleObject(worker_, 2000);
    CloseHandle(worker_);
    worker_ = nullptr;
  }
  if (worker_stop_ != nullptr) {
    CloseHandle(worker_stop_);
    worker_stop_ = nullptr;
  }
}

void MediaSource::PublishProducerState(ProducerState next) {
  if (next == producer_state_) {
    return;
  }
  trace::ProducerTransition(ProducerStateName(producer_state_), ProducerStateName(next),
                            reader_.generation());
  producer_state_ = next;
}

void MediaSource::FrameWorker() {
  last_tick_ms_ = GetTickCount();
  while (WaitForSingleObject(worker_stop_, kPollMs) == WAIT_TIMEOUT) {
    if (state() != SourceState::Started) {
      continue;
    }

    if (!reader_.IsOpen()) {
      const BridgeStatus opened = reader_.Open();
      if (opened == BridgeStatus::Ok) {
        PublishProducerState(ProducerState::ProducerHealthy);
        trace::BridgeOpened(reader_.layout().width, reader_.layout().height,
                            reader_.layout().fps_num, reader_.layout().fps_den);
      } else {
        PublishProducerState(ProducerState::NoProducer);
      }
    }

    LARGE_INTEGER now{};
    QueryPerformanceCounter(&now);
    const uint64_t now_qpc = static_cast<uint64_t>(now.QuadPart);
    const ProducerState next = reader_.IsOpen()
                                   ? reader_.PollProducer(now_qpc, stale_after_qpc_)
                                   : ProducerState::NoProducer;
    PublishProducerState(next);

    ComPtr<MediaStream> stream;
    uint64_t epoch = 0;
    int64_t epoch_hns = 0;
    {
      AcquireSRWLockShared(&lock_);
      stream = stream_;
      epoch = epoch_qpc_;
      epoch_hns = epoch_hns_;
      ReleaseSRWLockShared(&lock_);
    }
    if (!stream) {
      continue;
    }

    // A pending request must never wait with zero events in flight. Samples
    // only arrive while the producer is healthy; in every other state
    // (NoProducer, Stale, Restarted-without-frame) the request stays pending
    // and stream ticks keep clients unblocked (ARCH 7: short gap ->
    // MEStreamTick, never MEEndOfStream; long loss -> source stays alive).
    bool delivered = false;
    if (reader_.IsOpen() && (next == ProducerState::ProducerRestarted ||
                             next == ProducerState::ProducerHealthy)) {
      delivered = stream->PumpFrame(reader_, epoch, epoch_hns, qpc_frequency_);
    }
    if (delivered) {
      last_tick_ms_ = GetTickCount();
    } else if (stream->pending_requests() > 0) {
      const DWORD now_ms = GetTickCount();
      if (now_ms - last_tick_ms_ >= kTickGapMs) {
        stream->EmitStreamTick(now_qpc, epoch, epoch_hns, qpc_frequency_);
        last_tick_ms_ = now_ms;
      }
    }
  }
}

}  // namespace henshin
