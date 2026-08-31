#include "activator.h"

#include <mfapi.h>
#include <mfvirtualcamera.h>

#include <new>

#include "vcam_ids.h"
#include "../media-source/media_source.h"
#include "../trace/etw.h"
#include "module.h"

using Microsoft::WRL::ComPtr;

// Undocumented FrameServer attribute (smourier/VCamSample Undocumented.h).
// {5F8D322E-0FE4-43E4-9E50-D83ECD9FC2B8}
static const GUID MF_FRAMESERVER_CLIENTCONTEXT_CLIENTPID = {
    0x5f8d322e, 0x0fe4, 0x43e4, {0x9e, 0x50, 0xd8, 0x3e, 0xcd, 0x9f, 0xc2, 0xb8}};

namespace henshin {

Activator::Activator() { Module::ObjectCreated(L"Activator"); }

Activator::~Activator() { Module::ObjectDestroyed(L"Activator"); }

HRESULT Activator::Create(REFIID riid, void** ppv) {
  if (ppv == nullptr) {
    return E_POINTER;
  }
  *ppv = nullptr;
  auto* activator = new (std::nothrow) Activator();
  if (activator == nullptr) {
    return E_OUTOFMEMORY;
  }
  HRESULT hr = activator->Initialize();
  if (SUCCEEDED(hr)) {
    hr = activator->QueryInterface(riid, ppv);
  }
  activator->Release();
  return hr;
}

HRESULT Activator::Initialize() {
  HRESULT hr = MFCreateAttributes(&attrs_, 4);
  if (FAILED(hr)) {
    return hr;
  }
  hr = attrs_->SetGUID(MFT_TRANSFORM_CLSID_Attribute, CLSID_HenshinVirtualCamera);
  if (FAILED(hr)) {
    return hr;
  }
  // Synthetic software camera: FrameServer may populate associated-source
  // collection; we do not wrap hardware, so the collection stays empty.
  return attrs_->SetUINT32(MF_VIRTUALCAMERA_PROVIDE_ASSOCIATED_CAMERA_SOURCES, 1);
}

HRESULT Activator::EnsureStore() {
  if (attrs_) {
    return S_OK;
  }
  return MFCreateAttributes(&attrs_, 4);
}

IFACEMETHODIMP Activator::QueryInterface(REFIID riid, void** ppv) {
  if (ppv == nullptr) {
    return E_POINTER;
  }
  *ppv = nullptr;
  if (riid == IID_IUnknown || riid == IID_IMFAttributes || riid == IID_IMFActivate) {
    *ppv = static_cast<IMFActivate*>(this);
    AddRef();
    return S_OK;
  }
  return E_NOINTERFACE;
}

IFACEMETHODIMP_(ULONG) Activator::AddRef() { return InterlockedIncrement(&ref_count_); }

IFACEMETHODIMP_(ULONG) Activator::Release() {
  const ULONG count = InterlockedDecrement(&ref_count_);
  if (count == 0) {
    delete this;
  }
  return count;
}

IFACEMETHODIMP Activator::ActivateObject(REFIID riid, void** ppv) {
  if (ppv == nullptr) {
    return E_POINTER;
  }
  *ppv = nullptr;

  UINT32 pid = 0;
  if (attrs_) {
    (void)attrs_->GetUINT32(MF_FRAMESERVER_CLIENTCONTEXT_CLIENTPID, &pid);
  }

  if (!source_) {
    ComPtr<IMFMediaSourceEx> source;
    const HRESULT hr = MediaSource::CreateInstance(IID_PPV_ARGS(&source), attrs_.Get());
    if (FAILED(hr)) {
      trace::ActivateObject(pid, hr);
      return hr;
    }
    source_ = source;
  }
  const HRESULT hr = source_->QueryInterface(riid, ppv);
  trace::ActivateObject(pid, hr);
  return hr;
}

IFACEMETHODIMP Activator::ShutdownObject() {
  // Learn doc says E_NOTIMPL; Windows-Camera and VCamSample return S_OK for
  // the MFCreateVirtualCamera path. Follow the samples.
  return S_OK;
}

IFACEMETHODIMP Activator::DetachObject() {
  source_.Reset();
  return S_OK;
}

#define GS_ENSURE()             \
  do {                          \
    const HRESULT ehr = EnsureStore(); \
    if (FAILED(ehr)) {          \
      return ehr;               \
    }                           \
  } while (0)

IFACEMETHODIMP Activator::GetItem(REFGUID guidKey, PROPVARIANT* pValue) {
  GS_ENSURE();
  return attrs_->GetItem(guidKey, pValue);
}
IFACEMETHODIMP Activator::GetItemType(REFGUID guidKey, MF_ATTRIBUTE_TYPE* pType) {
  GS_ENSURE();
  return attrs_->GetItemType(guidKey, pType);
}
IFACEMETHODIMP Activator::CompareItem(REFGUID guidKey, REFPROPVARIANT Value, BOOL* pbResult) {
  GS_ENSURE();
  return attrs_->CompareItem(guidKey, Value, pbResult);
}
IFACEMETHODIMP Activator::Compare(IMFAttributes* pTheirs, MF_ATTRIBUTES_MATCH_TYPE MatchType,
                                  BOOL* pbResult) {
  GS_ENSURE();
  return attrs_->Compare(pTheirs, MatchType, pbResult);
}
IFACEMETHODIMP Activator::GetUINT32(REFGUID guidKey, UINT32* punValue) {
  GS_ENSURE();
  return attrs_->GetUINT32(guidKey, punValue);
}
IFACEMETHODIMP Activator::GetUINT64(REFGUID guidKey, UINT64* punValue) {
  GS_ENSURE();
  return attrs_->GetUINT64(guidKey, punValue);
}
IFACEMETHODIMP Activator::GetDouble(REFGUID guidKey, double* pfValue) {
  GS_ENSURE();
  return attrs_->GetDouble(guidKey, pfValue);
}
IFACEMETHODIMP Activator::GetGUID(REFGUID guidKey, GUID* pguidValue) {
  GS_ENSURE();
  return attrs_->GetGUID(guidKey, pguidValue);
}
IFACEMETHODIMP Activator::GetStringLength(REFGUID guidKey, UINT32* pcchLength) {
  GS_ENSURE();
  return attrs_->GetStringLength(guidKey, pcchLength);
}
IFACEMETHODIMP Activator::GetString(REFGUID guidKey, LPWSTR pwszValue, UINT32 cchBufSize,
                                    UINT32* pcchLength) {
  GS_ENSURE();
  return attrs_->GetString(guidKey, pwszValue, cchBufSize, pcchLength);
}
IFACEMETHODIMP Activator::GetAllocatedString(REFGUID guidKey, LPWSTR* ppwszValue,
                                             UINT32* pcchLength) {
  GS_ENSURE();
  return attrs_->GetAllocatedString(guidKey, ppwszValue, pcchLength);
}
IFACEMETHODIMP Activator::GetBlobSize(REFGUID guidKey, UINT32* pcbBlobSize) {
  GS_ENSURE();
  return attrs_->GetBlobSize(guidKey, pcbBlobSize);
}
IFACEMETHODIMP Activator::GetBlob(REFGUID guidKey, UINT8* pBuf, UINT32 cbBufSize,
                                  UINT32* pcbBlobSize) {
  GS_ENSURE();
  return attrs_->GetBlob(guidKey, pBuf, cbBufSize, pcbBlobSize);
}
IFACEMETHODIMP Activator::GetAllocatedBlob(REFGUID guidKey, UINT8** ppBuf, UINT32* pcbSize) {
  GS_ENSURE();
  return attrs_->GetAllocatedBlob(guidKey, ppBuf, pcbSize);
}
IFACEMETHODIMP Activator::GetUnknown(REFGUID guidKey, REFIID riid, LPVOID* ppv) {
  GS_ENSURE();
  return attrs_->GetUnknown(guidKey, riid, ppv);
}
IFACEMETHODIMP Activator::SetItem(REFGUID guidKey, REFPROPVARIANT Value) {
  GS_ENSURE();
  return attrs_->SetItem(guidKey, Value);
}
IFACEMETHODIMP Activator::DeleteItem(REFGUID guidKey) {
  GS_ENSURE();
  return attrs_->DeleteItem(guidKey);
}
IFACEMETHODIMP Activator::DeleteAllItems() {
  GS_ENSURE();
  return attrs_->DeleteAllItems();
}
IFACEMETHODIMP Activator::SetUINT32(REFGUID guidKey, UINT32 unValue) {
  GS_ENSURE();
  return attrs_->SetUINT32(guidKey, unValue);
}
IFACEMETHODIMP Activator::SetUINT64(REFGUID guidKey, UINT64 unValue) {
  GS_ENSURE();
  return attrs_->SetUINT64(guidKey, unValue);
}
IFACEMETHODIMP Activator::SetDouble(REFGUID guidKey, double fValue) {
  GS_ENSURE();
  return attrs_->SetDouble(guidKey, fValue);
}
IFACEMETHODIMP Activator::SetGUID(REFGUID guidKey, REFGUID guidValue) {
  GS_ENSURE();
  return attrs_->SetGUID(guidKey, guidValue);
}
IFACEMETHODIMP Activator::SetString(REFGUID guidKey, LPCWSTR wszValue) {
  GS_ENSURE();
  return attrs_->SetString(guidKey, wszValue);
}
IFACEMETHODIMP Activator::SetBlob(REFGUID guidKey, const UINT8* pBuf, UINT32 cbBufSize) {
  GS_ENSURE();
  return attrs_->SetBlob(guidKey, pBuf, cbBufSize);
}
IFACEMETHODIMP Activator::SetUnknown(REFGUID guidKey, IUnknown* pUnknown) {
  GS_ENSURE();
  return attrs_->SetUnknown(guidKey, pUnknown);
}
IFACEMETHODIMP Activator::LockStore() {
  GS_ENSURE();
  return attrs_->LockStore();
}
IFACEMETHODIMP Activator::UnlockStore() {
  GS_ENSURE();
  return attrs_->UnlockStore();
}
IFACEMETHODIMP Activator::GetCount(UINT32* pcItems) {
  GS_ENSURE();
  return attrs_->GetCount(pcItems);
}
IFACEMETHODIMP Activator::GetItemByIndex(UINT32 unIndex, GUID* pguidKey, PROPVARIANT* pValue) {
  GS_ENSURE();
  return attrs_->GetItemByIndex(unIndex, pguidKey, pValue);
}
IFACEMETHODIMP Activator::CopyAllItems(IMFAttributes* pDest) {
  GS_ENSURE();
  return attrs_->CopyAllItems(pDest);
}

#undef GS_ENSURE

}  // namespace henshin
