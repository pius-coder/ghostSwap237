// Media Source for the Henshin virtual camera (ARCHITECTURE 7).
//
// FrameServer activates this object to discover streams and read media types
// even when no producer is running, so construction never depends on the
// bridge: absence of a producer is a runtime state (NoProducer), never a
// construction error.

#pragma once

#include <windows.h>

#include <ks.h>
#include <ksproxy.h>
#include <mfidl.h>
#include <wrl/client.h>

#include "../bridge-reader/bridge_reader.h"

namespace henshin {

class MediaStream;

enum class SourceState : uint32_t {
  Created = 0,
  Stopped,
  Started,
  Shutdown,
};

class MediaSource : public IMFMediaSourceEx,
                    public IMFGetService,
                    public IKsControl,
                    public IMFSampleAllocatorControl {
 public:
  static HRESULT CreateInstance(REFIID riid, void** ppv, IMFAttributes* activate_attrs = nullptr);

  // IUnknown
  IFACEMETHODIMP QueryInterface(REFIID riid, void** ppv) override;
  IFACEMETHODIMP_(ULONG) AddRef() override;
  IFACEMETHODIMP_(ULONG) Release() override;

  // IMFMediaEventGenerator
  IFACEMETHODIMP BeginGetEvent(IMFAsyncCallback* callback, IUnknown* state) override;
  IFACEMETHODIMP EndGetEvent(IMFAsyncResult* result, IMFMediaEvent** event) override;
  IFACEMETHODIMP GetEvent(DWORD flags, IMFMediaEvent** event) override;
  IFACEMETHODIMP QueueEvent(MediaEventType met, REFGUID extended_type, HRESULT status,
                            const PROPVARIANT* value) override;

  // IMFMediaSource
  IFACEMETHODIMP CreatePresentationDescriptor(IMFPresentationDescriptor** pd) override;
  IFACEMETHODIMP GetCharacteristics(DWORD* characteristics) override;
  IFACEMETHODIMP Pause() override;
  IFACEMETHODIMP Shutdown() override;
  IFACEMETHODIMP Start(IMFPresentationDescriptor* pd, const GUID* time_format,
                       const PROPVARIANT* start_position) override;
  IFACEMETHODIMP Stop() override;

  // IMFMediaSourceEx
  IFACEMETHODIMP GetSourceAttributes(IMFAttributes** attributes) override;
  IFACEMETHODIMP GetStreamAttributes(DWORD stream_id, IMFAttributes** attributes) override;
  IFACEMETHODIMP SetD3DManager(IUnknown* manager) override;

  // IMFGetService
  IFACEMETHODIMP GetService(REFGUID service, REFIID riid, LPVOID* ppv) override;

  // IKsControl — HRESULT, matching the official Windows-Camera sample.
  IFACEMETHODIMP KsProperty(PKSPROPERTY property, ULONG length, LPVOID data, ULONG data_length,
                            ULONG* bytes_returned) override;
  IFACEMETHODIMP KsMethod(PKSMETHOD method, ULONG length, LPVOID data, ULONG data_length,
                          ULONG* bytes_returned) override;
  IFACEMETHODIMP KsEvent(PKSEVENT event, ULONG length, LPVOID data, ULONG data_length,
                         ULONG* bytes_returned) override;

  // IMFSampleAllocatorControl — request container-accessible memory from FrameServer.
  IFACEMETHODIMP SetDefaultAllocator(DWORD stream_id, IUnknown* allocator) override;
  IFACEMETHODIMP GetAllocatorUsage(DWORD stream_id, DWORD* input_stream_id,
                                   MFSampleAllocatorUsage* usage) override;

  // Called by the frame worker and by the stream.
  SourceState state();
  uint64_t qpc_frequency() const { return qpc_frequency_; }

 private:
  MediaSource();
  ~MediaSource();

  HRESULT Initialize(IMFAttributes* activate_attrs);
  HRESULT PublishSensorProfiles();
  HRESULT CheckShutdown(const wchar_t* method) const;
  HRESULT CreateMediaType(IMFMediaType** out);
  HRESULT SetDeviceStreamAttributes(IMFAttributes* attrs);
  static unsigned __stdcall FrameWorkerThunk(void* context);
  void FrameWorker();
  void StopWorker();
  void PublishProducerState(ProducerState next);

  mutable SRWLOCK lock_;  // COM state machine only; never held during a copy
  LONG ref_count_ = 1;
  SourceState state_ = SourceState::Created;

  Microsoft::WRL::ComPtr<IMFMediaEventQueue> event_queue_;
  Microsoft::WRL::ComPtr<IMFAttributes> attributes_;
  Microsoft::WRL::ComPtr<IMFPresentationDescriptor> descriptor_;
  Microsoft::WRL::ComPtr<MediaStream> stream_;  // cross-reference, broken in Shutdown

  // Frame plumbing. The reader is only touched by the worker thread.
  BridgeReader reader_;
  ProducerState producer_state_ = ProducerState::NoProducer;
  uint64_t qpc_frequency_ = 0;
  uint64_t stale_after_qpc_ = 0;

  HANDLE worker_ = nullptr;
  HANDLE worker_stop_ = nullptr;
  uint64_t epoch_qpc_ = 0;
  int64_t epoch_hns_ = 0;
  bool stream_was_started_ = false;
  DWORD last_tick_ms_ = 0;
};

}  // namespace henshin
