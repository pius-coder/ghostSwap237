// In-process streaming check (ARCH 7, 20): activation -> Start ->
// RequestSample -> MEMediaSample, bypassing FrameServer entirely. This
// isolates the DLL from the hosting path: if this delivers a frame, the DLL
// is innocent and the problem is in the FrameServer session; if this hangs
// too, the bug is inside the DLL and reproducible under a debugger.
//
// Requires a producer on the real bridge:
//   cargo run -p camera-bridge --bin camera-producer -- --file --duration-secs 60
//   native-camera-v2\driver\build\Debug\streaming-test.exe

#include <initguid.h>
#include <windows.h>

#include <ks.h>
#include <ksmedia.h>
#include <ksproxy.h>
#include <mfapi.h>
#include <mferror.h>
#include <mfidl.h>
#include <mfobjects.h>

#include <cstdio>
#include <propvarutil.h>

#include "vcam_ids.h"
#include "../trace/etw.h"

extern "C" HRESULT __stdcall DllGetClassObject(REFCLSID clsid, REFIID riid, void** ppv);

namespace {

int g_checks = 0;
int g_failures = 0;

void Check(bool ok, const char* what) {
  ++g_checks;
  if (ok) {
    std::printf("  ok %s\n", what);
  } else {
    ++g_failures;
    std::printf("  FAIL %s\n", what);
  }
}

}  // namespace

int main() {
  std::printf("streaming test (in-process, no FrameServer)\n");
  if (FAILED(MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET))) {
    std::printf("  FAIL MFStartup\n");
    return 1;
  }
  henshin::trace::Register();

  IClassFactory* factory = nullptr;
  HRESULT hr = DllGetClassObject(CLSID_HenshinVirtualCamera, IID_IClassFactory,
                                 reinterpret_cast<void**>(&factory));
  Check(SUCCEEDED(hr) && factory != nullptr, "DllGetClassObject");
  if (FAILED(hr) || factory == nullptr) {
    return 1;
  }

  IMFActivate* activate = nullptr;
  hr = factory->CreateInstance(nullptr, IID_IMFActivate, reinterpret_cast<void**>(&activate));
  Check(SUCCEEDED(hr) && activate != nullptr, "CreateInstance IMFActivate");
  if (FAILED(hr) || activate == nullptr) {
    factory->Release();
    return 1;
  }

  IMFMediaSource* ms = nullptr;
  hr = activate->ActivateObject(IID_IMFMediaSource, reinterpret_cast<void**>(&ms));
  Check(SUCCEEDED(hr) && ms != nullptr, "ActivateObject IMFMediaSource");
  if (FAILED(hr) || ms == nullptr) {
    activate->Release();
    factory->Release();
    return 1;
  }

  IMFPresentationDescriptor* pd = nullptr;
  hr = ms->CreatePresentationDescriptor(&pd);
  Check(SUCCEEDED(hr) && pd != nullptr, "CreatePresentationDescriptor");
  if (FAILED(hr) || pd == nullptr) {
    ms->Shutdown();
    ms->Release();
    activate->Release();
    factory->Release();
    return 1;
  }

  // NULL start position is legal ("current position", Windows-Camera).
  const LONGLONG start_time_floor = MFGetSystemTime();
  hr = ms->Start(pd, nullptr, nullptr);
  Check(SUCCEEDED(hr), "Start(pd, null format, null position)");
  if (FAILED(hr)) {
    std::printf("  Start hr=0x%08lX\n", static_cast<unsigned long>(hr));
    pd->Release();
    ms->Shutdown();
    ms->Release();
    activate->Release();
    factory->Release();
    return 1;
  }
  // First event: MENewStream carrying the IMFMediaStream.
  IMFMediaStream* stream = nullptr;
  {
    IMFMediaEvent* ev = nullptr;
    hr = ms->GetEvent(0, &ev);
    if (SUCCEEDED(hr)) {
      MediaEventType met = MEUnknown;
      ev->GetType(&met);
      Check(met == MENewStream, "first event is MENewStream");
      if (met == MENewStream) {
        PROPVARIANT value{};
        if (SUCCEEDED(ev->GetValue(&value)) && value.vt == VT_UNKNOWN && value.punkVal != nullptr) {
          hr = value.punkVal->QueryInterface(IID_PPV_ARGS(&stream));
          Check(SUCCEEDED(hr) && stream != nullptr, "stream from MENewStream");
          PropVariantClear(&value);
        } else {
          Check(false, "MENewStream carries the stream IUnknown");
        }
      }
      ev->Release();
    } else {
      Check(false, "source GetEvent(MENewStream)");
      std::printf("  GetEvent hr=0x%08lX\n", static_cast<unsigned long>(hr));
    }
  }
  if (stream == nullptr) {
    pd->Release();
    ms->Shutdown();
    ms->Release();
    activate->Release();
    factory->Release();
    return 1;
  }

  hr = stream->RequestSample(nullptr);
  Check(SUCCEEDED(hr), "RequestSample accepted while RUNNING");

  // Drain events with a hard deadline. Ticks are expected while no frame is
  // available; one MEMediaSample is the success criterion.
  const DWORD deadline = GetTickCount() + 15000;
  bool got_sample = false;
  uint32_t ticks = 0;
  uint32_t others = 0;
  LONGLONG sample_time = -1;
  LONGLONG sample_duration = -1;
  DWORD buffer_length = 0;
  while (!got_sample && GetTickCount() < deadline) {
    IMFMediaEvent* ev = nullptr;
    hr = stream->GetEvent(MF_EVENT_FLAG_NO_WAIT, &ev);
    if (hr == MF_E_NO_EVENTS_AVAILABLE) {
      Sleep(5);
      continue;
    }
    if (FAILED(hr)) {
      std::printf("  stream GetEvent hr=0x%08lX\n", static_cast<unsigned long>(hr));
      Sleep(5);
      continue;
    }
    MediaEventType met = MEUnknown;
    ev->GetType(&met);
    if (met == MEMediaSample) {
      PROPVARIANT value{};
      if (SUCCEEDED(ev->GetValue(&value)) && value.vt == VT_UNKNOWN && value.punkVal != nullptr) {
        IMFSample* sample = nullptr;
        if (SUCCEEDED(value.punkVal->QueryInterface(IID_PPV_ARGS(&sample)))) {
          sample->GetSampleTime(&sample_time);
          sample->GetSampleDuration(&sample_duration);
          IMFMediaBuffer* buffer = nullptr;
          if (SUCCEEDED(sample->GetBufferByIndex(0, &buffer))) {
            buffer->GetCurrentLength(&buffer_length);
            buffer->Release();
          }
          sample->Release();
          got_sample = true;
        }
        PropVariantClear(&value);
      }
    } else if (met == MEStreamTick) {
      ++ticks;
    } else {
      ++others;
    }
    ev->Release();
  }
  std::printf("  ticks=%u other_events=%u\n", ticks, others);
  Check(got_sample, "MEMediaSample delivered (in-process)");
  if (got_sample) {
    const DWORD expected = HENSHIN_VCAM_WIDTH * HENSHIN_VCAM_HEIGHT * 3 / 2;
    std::printf("  time=%lld duration=%lld buffer=%lu\n", sample_time, sample_duration,
                buffer_length);
    Check(sample_time >= 0, "timestamp non-negative");
    Check(sample_time >= start_time_floor && sample_time <= MFGetSystemTime() + 10'000'000,
          "timestamp shares absolute MF timeline");
    Check(sample_duration >= 300000 && sample_duration <= 370000, "duration ~333333 hns");
    Check(buffer_length >= expected, "NV12 payload present");
  }

  stream->Release();
  pd->Release();
  ms->Shutdown();
  ms->Release();
  activate->DetachObject();
  activate->Release();
  factory->Release();
  MFShutdown();
  henshin::trace::Unregister();

  if (g_failures == 0 && got_sample) {
    std::printf("\nstreaming test PASS (%d checks)\n", g_checks);
    return 0;
  }
  std::printf("\nstreaming test FAILED (%d of %d checks)\n", g_failures, g_checks);
  return 1;
}
