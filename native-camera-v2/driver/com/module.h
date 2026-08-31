// DLL lifetime bookkeeping (ARCHITECTURE 7, "Durée de vie COM").
//
// DllCanUnloadNow must return S_OK only when the DLL is genuinely unloadable,
// otherwise an update will try to overwrite a DLL that FrameServer still has
// mapped. Both counters are real: objects alive, and explicit server locks.

#pragma once

#include <windows.h>

#include <cstdint>

namespace henshin {

class Module {
 public:
  static void ObjectCreated(const wchar_t* kind);
  static void ObjectDestroyed(const wchar_t* kind);
  static void Lock();
  static void Unlock();

  static bool CanUnload();
  static uint32_t ActiveObjects();
  static uint32_t ServerLocks();

  static void SetInstance(HMODULE instance);
  static HMODULE Instance();
};

}  // namespace henshin
