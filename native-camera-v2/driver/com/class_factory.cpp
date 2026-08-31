#include "class_factory.h"

#include <new>

#include "vcam_ids.h"
#include "activator.h"
#include "module.h"

namespace henshin {

ClassFactory::ClassFactory() { Module::ObjectCreated(L"ClassFactory"); }

ClassFactory::~ClassFactory() { Module::ObjectDestroyed(L"ClassFactory"); }

HRESULT ClassFactory::Create(REFIID riid, void** ppv) {
  if (ppv == nullptr) {
    return E_POINTER;
  }
  *ppv = nullptr;
  auto* factory = new (std::nothrow) ClassFactory();
  if (factory == nullptr) {
    return E_OUTOFMEMORY;
  }
  const HRESULT hr = factory->QueryInterface(riid, ppv);
  factory->Release();
  return hr;
}

IFACEMETHODIMP ClassFactory::QueryInterface(REFIID riid, void** ppv) {
  if (ppv == nullptr) {
    return E_POINTER;
  }
  *ppv = nullptr;
  if (riid == IID_IUnknown || riid == IID_IClassFactory) {
    *ppv = static_cast<IClassFactory*>(this);
    AddRef();
    return S_OK;
  }
  return E_NOINTERFACE;
}

IFACEMETHODIMP_(ULONG) ClassFactory::AddRef() { return InterlockedIncrement(&ref_count_); }

IFACEMETHODIMP_(ULONG) ClassFactory::Release() {
  const ULONG count = InterlockedDecrement(&ref_count_);
  if (count == 0) {
    delete this;
  }
  return count;
}

IFACEMETHODIMP ClassFactory::CreateInstance(IUnknown* outer, REFIID riid, void** ppv) {
  if (ppv == nullptr) {
    return E_POINTER;
  }
  *ppv = nullptr;
  if (outer != nullptr) {
    return CLASS_E_NOAGGREGATION;
  }
  return Activator::Create(riid, ppv);
}

IFACEMETHODIMP ClassFactory::LockServer(BOOL lock) {
  if (lock) {
    Module::Lock();
  } else {
    Module::Unlock();
  }
  return S_OK;
}

}  // namespace henshin
