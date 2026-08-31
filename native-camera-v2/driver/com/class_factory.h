#pragma once

#include <unknwn.h>
#include <windows.h>

namespace henshin {

// Standard in-proc class factory for CLSID_HenshinVirtualCamera.
// LockServer is honoured: FrameServer may hold the server alive across
// activations without keeping an object reference.
class ClassFactory : public IClassFactory {
 public:
  static HRESULT Create(REFIID riid, void** ppv);

  // IUnknown
  IFACEMETHODIMP QueryInterface(REFIID riid, void** ppv) override;
  IFACEMETHODIMP_(ULONG) AddRef() override;
  IFACEMETHODIMP_(ULONG) Release() override;

  // IClassFactory
  IFACEMETHODIMP CreateInstance(IUnknown* outer, REFIID riid, void** ppv) override;
  IFACEMETHODIMP LockServer(BOOL lock) override;

 private:
  ClassFactory();
  ~ClassFactory();

  LONG ref_count_ = 1;
};

}  // namespace henshin
