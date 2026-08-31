#include <windows.h>

#include <mfapi.h>

#include "vcam_ids.h"
#include "../trace/etw.h"
#include "class_factory.h"
#include "module.h"

namespace {

wchar_t g_module_path[MAX_PATH] = {};

}  // namespace

BOOL APIENTRY DllMain(HMODULE instance, DWORD reason, LPVOID) {
  switch (reason) {
    case DLL_PROCESS_ATTACH:
      DisableThreadLibraryCalls(instance);
      henshin::Module::SetInstance(instance);
      GetModuleFileNameW(instance, g_module_path, ARRAYSIZE(g_module_path));
      henshin::trace::Register();
      henshin::trace::DllLoaded(g_module_path);
      break;
    case DLL_PROCESS_DETACH:
      henshin::trace::DllUnloaded();
      henshin::trace::Unregister();
      break;
    default:
      break;
  }
  return TRUE;
}

STDAPI DllGetClassObject(REFCLSID clsid, REFIID riid, void** ppv) {
  if (ppv == nullptr) {
    return E_POINTER;
  }
  *ppv = nullptr;
  if (clsid != CLSID_HenshinVirtualCamera) {
    henshin::trace::ClassObjectRequested(HENSHIN_VCAM_CLSID_STRING, CLASS_E_CLASSNOTAVAILABLE);
    return CLASS_E_CLASSNOTAVAILABLE;
  }
  const HRESULT hr = henshin::ClassFactory::Create(riid, ppv);
  henshin::trace::ClassObjectRequested(HENSHIN_VCAM_CLSID_STRING, hr);
  return hr;
}

STDAPI DllCanUnloadNow() {
  const bool can = henshin::Module::CanUnload();
  henshin::trace::CanUnloadNow(can, henshin::Module::ActiveObjects(),
                                 henshin::Module::ServerLocks());
  return can ? S_OK : S_FALSE;
}
