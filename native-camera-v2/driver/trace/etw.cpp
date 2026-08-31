#include "etw.h"

#include <TraceLoggingProvider.h>
#include <evntrace.h>

// {A7E2C6D4-3F51-4C2B-9E77-0B6A5C1D8E44}
TRACELOGGING_DEFINE_PROVIDER(g_vcam_provider, "Henshin.VirtualCamera",
                             (0xa7e2c6d4, 0x3f51, 0x4c2b, 0x9e, 0x77, 0x0b, 0x6a, 0x5c, 0x1d,
                              0x8e, 0x44));

namespace henshin {
namespace trace {

void Register() { TraceLoggingRegister(g_vcam_provider); }

void Unregister() { TraceLoggingUnregister(g_vcam_provider); }

void DllLoaded(const wchar_t* module_path) {
  TraceLoggingWrite(g_vcam_provider, "DllLoaded", TraceLoggingLevel(TRACE_LEVEL_INFORMATION),
                    TraceLoggingWideString(module_path, "modulePath"));
}

void DllUnloaded() {
  TraceLoggingWrite(g_vcam_provider, "DllUnloaded", TraceLoggingLevel(TRACE_LEVEL_INFORMATION));
}

void ObjectCreated(const wchar_t* kind, uint32_t active_objects) {
  TraceLoggingWrite(g_vcam_provider, "ObjectCreated", TraceLoggingLevel(TRACE_LEVEL_INFORMATION),
                    TraceLoggingWideString(kind, "kind"),
                    TraceLoggingUInt32(active_objects, "activeObjects"));
}

void ObjectDestroyed(const wchar_t* kind, uint32_t active_objects) {
  TraceLoggingWrite(g_vcam_provider, "ObjectDestroyed", TraceLoggingLevel(TRACE_LEVEL_INFORMATION),
                    TraceLoggingWideString(kind, "kind"),
                    TraceLoggingUInt32(active_objects, "activeObjects"));
}

void ServerLockChanged(bool locked, uint32_t lock_count) {
  TraceLoggingWrite(g_vcam_provider, "ServerLockChanged",
                    TraceLoggingLevel(TRACE_LEVEL_VERBOSE), TraceLoggingBool(locked, "locked"),
                    TraceLoggingUInt32(lock_count, "lockCount"));
}

void CanUnloadNow(bool can_unload, uint32_t active_objects, uint32_t lock_count) {
  TraceLoggingWrite(g_vcam_provider, "CanUnloadNow", TraceLoggingLevel(TRACE_LEVEL_INFORMATION),
                    TraceLoggingBool(can_unload, "canUnload"),
                    TraceLoggingUInt32(active_objects, "activeObjects"),
                    TraceLoggingUInt32(lock_count, "lockCount"));
}

void ClassObjectRequested(const wchar_t* clsid, HRESULT hr) {
  TraceLoggingWrite(g_vcam_provider, "ClassObjectRequested",
                    TraceLoggingLevel(TRACE_LEVEL_INFORMATION),
                    TraceLoggingWideString(clsid, "clsid"), TraceLoggingHResult(hr, "hr"));
}

void ActivateObject(uint32_t client_pid, HRESULT hr) {
  TraceLoggingWrite(g_vcam_provider, "ActivateObject",
                    TraceLoggingLevel(TRACE_LEVEL_INFORMATION),
                    TraceLoggingUInt32(client_pid, "clientPid"), TraceLoggingHResult(hr, "hr"));
}

void SourceStart(int64_t start_time_hns, HRESULT hr) {
  TraceLoggingWrite(g_vcam_provider, "SourceStart", TraceLoggingLevel(TRACE_LEVEL_INFORMATION),
                    TraceLoggingInt64(start_time_hns, "startTimeHns"),
                    TraceLoggingHResult(hr, "hr"));
}

void SourceStop(HRESULT hr) {
  TraceLoggingWrite(g_vcam_provider, "SourceStop", TraceLoggingLevel(TRACE_LEVEL_INFORMATION),
                    TraceLoggingHResult(hr, "hr"));
}

void SourceShutdown(uint32_t requests_released) {
  TraceLoggingWrite(g_vcam_provider, "SourceShutdown", TraceLoggingLevel(TRACE_LEVEL_INFORMATION),
                    TraceLoggingUInt32(requests_released, "requestsReleased"));
}

void MethodAfterShutdown(const wchar_t* method) {
  TraceLoggingWrite(g_vcam_provider, "MethodAfterShutdown",
                    TraceLoggingLevel(TRACE_LEVEL_WARNING),
                    TraceLoggingWideString(method, "method"));
}

void RequestSample(uint32_t pending_requests, uint32_t state) {
  TraceLoggingWrite(g_vcam_provider, "RequestSample", TraceLoggingLevel(TRACE_LEVEL_VERBOSE),
                    TraceLoggingUInt32(pending_requests, "pendingRequests"),
                    TraceLoggingUInt32(state, "state"));
}

void RequestDropped(const wchar_t* reason, uint32_t pending_requests) {
  TraceLoggingWrite(g_vcam_provider, "RequestDropped", TraceLoggingLevel(TRACE_LEVEL_WARNING),
                    TraceLoggingWideString(reason, "reason"),
                    TraceLoggingUInt32(pending_requests, "pendingRequests"));
}

void SampleDelivered(uint64_t frame_id, int64_t sample_time_hns, int64_t duration_hns,
                     uint64_t frame_age_us, uint32_t copy_us) {
  TraceLoggingWrite(g_vcam_provider, "SampleDelivered", TraceLoggingLevel(TRACE_LEVEL_VERBOSE),
                    TraceLoggingUInt64(frame_id, "frameId"),
                    TraceLoggingInt64(sample_time_hns, "sampleTimeHns"),
                    TraceLoggingInt64(duration_hns, "durationHns"),
                    TraceLoggingUInt64(frame_age_us, "frameAgeUs"),
                    TraceLoggingUInt32(copy_us, "copyUs"));
}

void StreamTick(int64_t tick_time_hns, uint32_t pending_requests) {
  TraceLoggingWrite(g_vcam_provider, "StreamTick", TraceLoggingLevel(TRACE_LEVEL_INFORMATION),
                    TraceLoggingInt64(tick_time_hns, "tickTimeHns"),
                    TraceLoggingUInt32(pending_requests, "pendingRequests"));
}

void BridgeOpened(uint32_t width, uint32_t height, uint32_t fps_num, uint32_t fps_den) {
  TraceLoggingWrite(g_vcam_provider, "BridgeOpened", TraceLoggingLevel(TRACE_LEVEL_INFORMATION),
                    TraceLoggingUInt32(width, "width"), TraceLoggingUInt32(height, "height"),
                    TraceLoggingUInt32(fps_num, "fpsNum"), TraceLoggingUInt32(fps_den, "fpsDen"));
}

void BridgeInvalid(const wchar_t* status) {
  TraceLoggingWrite(g_vcam_provider, "BridgeInvalid", TraceLoggingLevel(TRACE_LEVEL_WARNING),
                    TraceLoggingWideString(status, "status"));
}

void ProtocolMismatch(uint32_t found_major, uint32_t expected_major) {
  TraceLoggingWrite(g_vcam_provider, "ProtocolMismatch", TraceLoggingLevel(TRACE_LEVEL_ERROR),
                    TraceLoggingUInt32(found_major, "foundMajor"),
                    TraceLoggingUInt32(expected_major, "expectedMajor"));
}

void ProducerTransition(const wchar_t* from_state, const wchar_t* to_state, uint64_t generation) {
  TraceLoggingWrite(g_vcam_provider, "ProducerTransition",
                    TraceLoggingLevel(TRACE_LEVEL_INFORMATION),
                    TraceLoggingWideString(from_state, "from"),
                    TraceLoggingWideString(to_state, "to"),
                    TraceLoggingUInt64(generation, "generation"));
}

void SeqlockRetries(uint32_t attempts, uint64_t frame_id) {
  TraceLoggingWrite(g_vcam_provider, "SeqlockRetries", TraceLoggingLevel(TRACE_LEVEL_WARNING),
                    TraceLoggingUInt32(attempts, "attempts"),
                    TraceLoggingUInt64(frame_id, "frameId"));
}

void CopyDuration(uint32_t copy_us, uint32_t dst_pitch_y, uint32_t src_pitch_y) {
  TraceLoggingWrite(g_vcam_provider, "CopyDuration", TraceLoggingLevel(TRACE_LEVEL_VERBOSE),
                    TraceLoggingUInt32(copy_us, "copyUs"),
                    TraceLoggingUInt32(dst_pitch_y, "dstPitchY"),
                    TraceLoggingUInt32(src_pitch_y, "srcPitchY"));
}

void FrameAge(uint64_t frame_age_us, uint64_t frame_id) {
  TraceLoggingWrite(g_vcam_provider, "FrameAge", TraceLoggingLevel(TRACE_LEVEL_VERBOSE),
                    TraceLoggingUInt64(frame_age_us, "frameAgeUs"),
                    TraceLoggingUInt64(frame_id, "frameId"));
}

void MonotonicityForced(int64_t previous_hns, int64_t candidate_hns, int64_t corrected_hns) {
  TraceLoggingWrite(g_vcam_provider, "MonotonicityForced", TraceLoggingLevel(TRACE_LEVEL_WARNING),
                    TraceLoggingInt64(previous_hns, "previousHns"),
                    TraceLoggingInt64(candidate_hns, "candidateHns"),
                    TraceLoggingInt64(corrected_hns, "correctedHns"));
}

void MfError(const wchar_t* where, HRESULT hr) {
  TraceLoggingWrite(g_vcam_provider, "MfError", TraceLoggingLevel(TRACE_LEVEL_ERROR),
                    TraceLoggingWideString(where, "where"), TraceLoggingHResult(hr, "hr"));
}

}  // namespace trace
}  // namespace henshin
