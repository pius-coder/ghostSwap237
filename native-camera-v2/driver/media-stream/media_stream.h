// Media Stream for the Henshin virtual camera (ARCHITECTURE 7).
//
// Requests and frames are deliberately different things: requests are FIFO and
// bounded to two, frames are latest-wins with no queue at all.

#pragma once

#include <mfidl.h>
#include <windows.h>
#include <wrl/client.h>

#include <cstdint>

#include "../bridge-reader/bridge_reader.h"

namespace henshin {

class MediaSource;

// Two is enough: a correct consumer never has more than one request in flight
// plus one being prepared. Anything deeper only adds latency.
constexpr uint32_t kMaxPendingRequests = 2;

class MediaStream : public IMFMediaStream2 {
 public:
  static HRESULT CreateInstance(MediaSource* source, IMFStreamDescriptor* descriptor,
                                MediaStream** out);

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

  // IMFMediaStream
  IFACEMETHODIMP GetMediaSource(IMFMediaSource** source) override;
  IFACEMETHODIMP GetStreamDescriptor(IMFStreamDescriptor** descriptor) override;
  IFACEMETHODIMP RequestSample(IUnknown* token) override;

  // IMFMediaStream2
  IFACEMETHODIMP SetStreamState(MF_STREAM_STATE state) override;
  IFACEMETHODIMP GetStreamState(MF_STREAM_STATE* state) override;

  // Lifecycle, driven by the source.
  HRESULT Start();
  HRESULT Stop();
  void Shutdown();
  HRESULT SetSampleAllocator(IMFVideoSampleAllocator* allocator);

  // Frame plumbing, driven by the source worker thread.
  // Delivers at most one sample; returns true when a sample was delivered.
  bool PumpFrame(BridgeReader& reader, uint64_t epoch_qpc, int64_t epoch_hns,
                 uint64_t qpc_frequency);
  void EmitStreamTick(uint64_t now_qpc, uint64_t epoch_qpc, int64_t epoch_hns,
                      uint64_t qpc_frequency);
  // Releases requests that can no longer be satisfied, without ending the stream.
  void ReleasePendingRequests(const wchar_t* reason);
  uint32_t pending_requests();
  HRESULT GetAttributes(IMFAttributes** out);

 private:
  MediaStream();
  ~MediaStream();

  HRESULT Initialize(MediaSource* source, IMFStreamDescriptor* descriptor);
  // Must be called with lock_ held. Reinitializes the pool if the selected
  // media type changes between starts.
  HRESULT EnsureAllocator();
  HRESULT CheckShutdown(const wchar_t* method) const;
  int64_t NextSampleTime(uint64_t capture_qpc, uint64_t epoch_qpc, int64_t epoch_hns,
                         uint64_t qpc_frequency);

  mutable SRWLOCK lock_;
  LONG ref_count_ = 1;
  bool shutdown_ = false;
  MF_STREAM_STATE stream_state_ = MF_STREAM_STATE_STOPPED;

  Microsoft::WRL::ComPtr<IMFMediaEventQueue> event_queue_;
  Microsoft::WRL::ComPtr<IMFStreamDescriptor> descriptor_;
  Microsoft::WRL::ComPtr<IMFAttributes> attributes_;  // live store, not a clone
  Microsoft::WRL::ComPtr<IMFMediaSource> source_;  // cross-reference, broken in Shutdown
  // FrameServer supplies this allocator after GetAllocatorUsage advertises the
  // provided-allocator contract. Direct in-process hosts use the local fallback.
  Microsoft::WRL::ComPtr<IMFVideoSampleAllocator> provided_allocator_;
  Microsoft::WRL::ComPtr<IMFVideoSampleAllocator> allocator_;
  Microsoft::WRL::ComPtr<IMFMediaType> allocator_media_type_;

  // A token may legitimately be null; the slot in use is what counts.
  struct PendingRequest {
    bool in_use = false;
    Microsoft::WRL::ComPtr<IUnknown> token;
  };
  PendingRequest requests_[kMaxPendingRequests]{};
  uint32_t request_head_ = 0;
  uint32_t request_count_ = 0;

  int64_t last_sample_time_hns_ = -1;
  int64_t duration_hns_ = 0;
};

}  // namespace henshin
