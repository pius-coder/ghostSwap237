// ETW / TraceLogging for the virtual camera (ARCHITECTURE 19).
//
// The DLL runs inside the FrameServer service where a per-frame log file is
// both unwritable and unaffordable. Everything observable goes through ETW.
//
// Capture with:
//   wpr -start GeneralProfile -start C:\...\henshin-vcam.wprp
// or simply:
//   tracelog -start gsvcam -guid #A7E2C6D4-...-... -f gsvcam.etl -level 5
// Provider name: Henshin.VirtualCamera

#pragma once

#include <windows.h>

#include <cstdint>

namespace henshin {
namespace trace {

void Register();
void Unregister();

// COM lifetime
void DllLoaded(const wchar_t* module_path);
void DllUnloaded();
void ObjectCreated(const wchar_t* kind, uint32_t active_objects);
void ObjectDestroyed(const wchar_t* kind, uint32_t active_objects);
void ServerLockChanged(bool locked, uint32_t lock_count);
void CanUnloadNow(bool can_unload, uint32_t active_objects, uint32_t lock_count);
void ClassObjectRequested(const wchar_t* clsid, HRESULT hr);
void ActivateObject(uint32_t client_pid, HRESULT hr);

// Media Source lifecycle
void SourceStart(int64_t start_time_hns, HRESULT hr);
void SourceStop(HRESULT hr);
void SourceShutdown(uint32_t requests_released);
void MethodAfterShutdown(const wchar_t* method);

// Streaming
void RequestSample(uint32_t pending_requests, uint32_t state);
void RequestDropped(const wchar_t* reason, uint32_t pending_requests);
void SampleDelivered(uint64_t frame_id, int64_t sample_time_hns, int64_t duration_hns,
                     uint64_t frame_age_us, uint32_t copy_us);
void StreamTick(int64_t tick_time_hns, uint32_t pending_requests);

// Bridge
void BridgeOpened(uint32_t width, uint32_t height, uint32_t fps_num, uint32_t fps_den);
void BridgeInvalid(const wchar_t* status);
void ProtocolMismatch(uint32_t found_major, uint32_t expected_major);
void ProducerTransition(const wchar_t* from_state, const wchar_t* to_state, uint64_t generation);
void SeqlockRetries(uint32_t attempts, uint64_t frame_id);
void CopyDuration(uint32_t copy_us, uint32_t dst_pitch_y, uint32_t src_pitch_y);
void FrameAge(uint64_t frame_age_us, uint64_t frame_id);

// Timestamps
void MonotonicityForced(int64_t previous_hns, int64_t candidate_hns, int64_t corrected_hns);

// Errors
void MfError(const wchar_t* where, HRESULT hr);

}  // namespace trace
}  // namespace henshin
