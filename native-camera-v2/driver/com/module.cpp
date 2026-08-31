#include "module.h"

#include "../trace/etw.h"

namespace henshin {
namespace {

volatile LONG g_objects = 0;
volatile LONG g_locks = 0;
HMODULE g_instance = nullptr;

}  // namespace

void Module::SetInstance(HMODULE instance) { g_instance = instance; }

HMODULE Module::Instance() { return g_instance; }

void Module::ObjectCreated(const wchar_t* kind) {
  const uint32_t n = static_cast<uint32_t>(InterlockedIncrement(&g_objects));
  trace::ObjectCreated(kind, n);
}

void Module::ObjectDestroyed(const wchar_t* kind) {
  const LONG n = InterlockedDecrement(&g_objects);
  trace::ObjectDestroyed(kind, n < 0 ? 0 : static_cast<uint32_t>(n));
}

void Module::Lock() {
  const uint32_t n = static_cast<uint32_t>(InterlockedIncrement(&g_locks));
  trace::ServerLockChanged(true, n);
}

void Module::Unlock() {
  const LONG n = InterlockedDecrement(&g_locks);
  const uint32_t count = n < 0 ? 0 : static_cast<uint32_t>(n);
  trace::ServerLockChanged(false, count);
}

uint32_t Module::ActiveObjects() {
  const LONG n = g_objects;
  return n < 0 ? 0 : static_cast<uint32_t>(n);
}

uint32_t Module::ServerLocks() {
  const LONG n = g_locks;
  return n < 0 ? 0 : static_cast<uint32_t>(n);
}

bool Module::CanUnload() { return ActiveObjects() == 0 && ServerLocks() == 0; }

}  // namespace henshin
