// Host-side COM lifetime checks. No FrameServer, no registration: this
// exercises DllGetClassObject / LockServer / DllCanUnloadNow counters.

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

#include "vcam_ids.h"
#include "../trace/etw.h"

extern "C" HRESULT __stdcall DllGetClassObject(REFCLSID clsid, REFIID riid, void** ppv);
extern "C" HRESULT __stdcall DllCanUnloadNow();

int g_failures = 0;
int g_checks = 0;

void Check(bool ok, const char* what) {
  ++g_checks;
  if (!ok) {
    ++g_failures;
    std::printf("  FAIL %s\n", what);
  }
}

int main() {
  std::printf("com lifetime tests\n");
  if (FAILED(MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET))) {
    std::printf("  FAIL MFStartup\n");
    return 1;
  }
  henshin::trace::Register();

  Check(DllCanUnloadNow() == S_OK, "unloadable with no objects");

  HRESULT hr = S_OK;
  {
    GUID bogus{};
    IClassFactory* missing = nullptr;
    hr = DllGetClassObject(bogus, IID_IClassFactory, reinterpret_cast<void**>(&missing));
    Check(hr == CLASS_E_CLASSNOTAVAILABLE && missing == nullptr, "unknown CLSID");
  }

  IClassFactory* factory = nullptr;
  hr = DllGetClassObject(CLSID_HenshinVirtualCamera, IID_IClassFactory,
                         reinterpret_cast<void**>(&factory));
  Check(SUCCEEDED(hr) && factory != nullptr, "DllGetClassObject");
  if (FAILED(hr) || factory == nullptr) {
    std::printf("\n%d of %d checks FAILED\n", g_failures, g_checks);
    return 1;
  }
  Check(DllCanUnloadNow() == S_FALSE, "factory keeps the DLL loaded");

  {
    IMFActivate* aggregated = nullptr;
    hr = factory->CreateInstance(factory, IID_IMFActivate, reinterpret_cast<void**>(&aggregated));
    Check(hr == CLASS_E_NOAGGREGATION && aggregated == nullptr, "no aggregation");
  }
  {
    IMFMediaSource* direct = nullptr;
    hr = factory->CreateInstance(nullptr, IID_IMFMediaSource, reinterpret_cast<void**>(&direct));
    Check(hr == E_NOINTERFACE && direct == nullptr, "factory yields IMFActivate, not the source");
  }

  IMFActivate* activate = nullptr;
  hr = factory->CreateInstance(nullptr, IID_IMFActivate, reinterpret_cast<void**>(&activate));
  Check(SUCCEEDED(hr) && activate != nullptr, "CreateInstance IMFActivate (FrameServer path)");
  if (FAILED(hr) || activate == nullptr) {
    std::printf("\n%d of %d checks FAILED\n", g_failures, g_checks);
    factory->Release();
    return 1;
  }

  IMFAttributes* act_attrs = nullptr;
  hr = activate->QueryInterface(IID_IMFAttributes, reinterpret_cast<void**>(&act_attrs));
  Check(SUCCEEDED(hr), "IMFActivate is IMFAttributes");
  if (act_attrs) {
    act_attrs->Release();
  }

  IUnknown* source = nullptr;
  hr = activate->ActivateObject(IID_IUnknown, reinterpret_cast<void**>(&source));
  Check(SUCCEEDED(hr) && source != nullptr, "ActivateObject without a producer");

  IMFMediaSource* ms = nullptr;
  if (source) {
    hr = source->QueryInterface(IID_IMFMediaSource, reinterpret_cast<void**>(&ms));
    Check(SUCCEEDED(hr), "IMFMediaSource");
  }
  IMFMediaSourceEx* ex = nullptr;
  if (source) {
    hr = source->QueryInterface(IID_IMFMediaSourceEx, reinterpret_cast<void**>(&ex));
    Check(SUCCEEDED(hr), "IMFMediaSourceEx (FrameServer requires this)");
  }
  IKsControl* ks = nullptr;
  if (source) {
    hr = source->QueryInterface(__uuidof(IKsControl), reinterpret_cast<void**>(&ks));
    Check(SUCCEEDED(hr), "IKsControl");
  }
  IMFGetService* svc = nullptr;
  if (source) {
    hr = source->QueryInterface(IID_IMFGetService, reinterpret_cast<void**>(&svc));
    Check(SUCCEEDED(hr), "IMFGetService");
  }
  IMFSampleAllocatorControl* alloc = nullptr;
  if (source) {
    hr = source->QueryInterface(IID_IMFSampleAllocatorControl, reinterpret_cast<void**>(&alloc));
    Check(SUCCEEDED(hr), "IMFSampleAllocatorControl");
    if (alloc) {
      DWORD in_id = 99;
      MFSampleAllocatorUsage usage = MFSampleAllocatorUsage_UsesCustomAllocator;
      hr = alloc->GetAllocatorUsage(0, &in_id, &usage);
      Check(SUCCEEDED(hr) && usage == MFSampleAllocatorUsage_UsesProvidedAllocator,
            "UsesProvidedAllocator");

      IMFVideoSampleAllocator* provided = nullptr;
      hr = MFCreateVideoSampleAllocatorEx(IID_PPV_ARGS(&provided));
      Check(SUCCEEDED(hr) && provided != nullptr, "create provided allocator");
      if (provided) {
        hr = alloc->SetDefaultAllocator(0, provided);
        Check(SUCCEEDED(hr), "accept provided allocator");
        provided->Release();
      }
    }
  }

  IMFAttributes* src_attrs = nullptr;
  IMFAttributes* src_attrs2 = nullptr;
  if (ex) {
    hr = ex->GetSourceAttributes(&src_attrs);
    Check(SUCCEEDED(hr) && src_attrs != nullptr, "GetSourceAttributes");
    hr = ex->GetSourceAttributes(&src_attrs2);
    Check(src_attrs == src_attrs2, "GetSourceAttributes returns the live store");
    if (src_attrs) {
      IUnknown* profiles = nullptr;
      hr = src_attrs->GetUnknown(MF_DEVICEMFT_SENSORPROFILE_COLLECTION, IID_IUnknown,
                                 reinterpret_cast<void**>(&profiles));
      Check(SUCCEEDED(hr) && profiles != nullptr, "legacy sensor profile collection");
      if (profiles) {
        profiles->Release();
      }
    }
    IMFAttributes* stream_attrs = nullptr;
    hr = ex->GetStreamAttributes(0, &stream_attrs);
    Check(SUCCEEDED(hr) && stream_attrs != nullptr, "GetStreamAttributes");
    if (stream_attrs) {
      UINT32 stream_id = 99;
      stream_attrs->GetUINT32(MF_DEVICESTREAM_STREAM_ID, &stream_id);
      Check(stream_id == 0, "stream attr MF_DEVICESTREAM_STREAM_ID");
      stream_attrs->Release();
    }
  }

  if (ms) {
    IMFPresentationDescriptor* pd = nullptr;
    hr = ms->CreatePresentationDescriptor(&pd);
    Check(SUCCEEDED(hr) && pd != nullptr, "CreatePresentationDescriptor with app off");
    if (pd) {
      DWORD count = 0;
      pd->GetStreamDescriptorCount(&count);
      Check(count == 1, "one stream");
      BOOL selected = FALSE;
      IMFStreamDescriptor* sd = nullptr;
      hr = pd->GetStreamDescriptorByIndex(0, &selected, &sd);
      Check(SUCCEEDED(hr) && sd != nullptr, "stream 0");
      if (sd) {
        UINT32 stream_id = 99;
        sd->GetUINT32(MF_DEVICESTREAM_STREAM_ID, &stream_id);
        Check(stream_id == 0, "MF_DEVICESTREAM_STREAM_ID");
        UINT32 shared = 0;
        sd->GetUINT32(MF_DEVICESTREAM_FRAMESERVER_SHARED, &shared);
        Check(shared == 1, "MF_DEVICESTREAM_FRAMESERVER_SHARED");
        UINT32 kinds = 0;
        sd->GetUINT32(MF_DEVICESTREAM_ATTRIBUTE_FRAMESOURCE_TYPES, &kinds);
        Check(kinds == MFFrameSourceTypes_Color, "FRAMESOURCE_TYPES Color");
        GUID cat{};
        sd->GetGUID(MF_DEVICESTREAM_STREAM_CATEGORY, &cat);
        Check(cat == PINNAME_VIDEO_CAPTURE, "PINNAME_VIDEO_CAPTURE");
        IMFMediaTypeHandler* handler = nullptr;
        sd->GetMediaTypeHandler(&handler);
        if (handler) {
          DWORD ntypes = 0;
          handler->GetMediaTypeCount(&ntypes);
          Check(ntypes == 1, "single media type");
          IMFMediaType* type = nullptr;
          handler->GetCurrentMediaType(&type);
          if (type) {
            GUID subtype{};
            type->GetGUID(MF_MT_SUBTYPE, &subtype);
            Check(subtype == MFVideoFormat_NV12, "NV12");
            UINT64 size = 0;
            type->GetUINT64(MF_MT_FRAME_SIZE, &size);
            Check(((size >> 32) == 1280) && ((size & 0xffffffff) == 720), "1280x720");
            UINT32 matrix = 0;
            type->GetUINT32(MF_MT_YUV_MATRIX, &matrix);
            Check(matrix == MFVideoTransferMatrix_BT709, "BT.709");
            UINT32 range = 0;
            type->GetUINT32(MF_MT_VIDEO_NOMINAL_RANGE, &range);
            Check(range == MFNominalRange_16_235, "limited range");
            type->Release();
          }
          handler->Release();
        }
        sd->Release();
      }
      pd->Release();
    }
    hr = ms->Shutdown();
    Check(SUCCEEDED(hr), "Shutdown");
    hr = ms->Shutdown();
    Check(hr == S_OK, "second Shutdown is idempotent S_OK");
    hr = ms->Start(nullptr, nullptr, nullptr);
    Check(hr == MF_E_SHUTDOWN, "Start after Shutdown is MF_E_SHUTDOWN");
    DWORD chars = 0;
    hr = ms->GetCharacteristics(&chars);
    Check(hr == MF_E_SHUTDOWN, "GetCharacteristics after Shutdown is MF_E_SHUTDOWN");
    ms->Release();
  }
  if (ex) {
    ex->Release();
  }
  if (ks) {
    ks->Release();
  }
  if (src_attrs) {
    src_attrs->Release();
  }
  if (src_attrs2) {
    src_attrs2->Release();
  }
  if (alloc) {
    alloc->Release();
  }
  if (svc) {
    svc->Release();
  }
  if (source) {
    source->Release();
  }
  if (activate) {
    activate->DetachObject();
    activate->Release();
  }

  Check(factory->LockServer(TRUE) == S_OK, "LockServer true");
  Check(DllCanUnloadNow() == S_FALSE, "lock keeps the DLL loaded");
  Check(factory->LockServer(FALSE) == S_OK, "LockServer false");
  factory->Release();
  Check(DllCanUnloadNow() == S_OK, "unloadable after last release");
  MFShutdown();
  henshin::trace::Unregister();

  if (g_failures == 0) {
    std::printf("\n%d checks passed\n", g_checks);
    return 0;
  }
  std::printf("\n%d of %d checks FAILED\n", g_failures, g_checks);
  return 1;
}
