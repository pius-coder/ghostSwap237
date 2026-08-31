#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>
#include <aclapi.h>
#include <sddl.h>
#include <shlobj.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfvirtualcamera.h>
#include <stdio.h>
#include <stdint.h>
#include <string.h>

#include "../driver/include/henshin_bridge.h"
#include "../driver/include/vcam_ids.h"

#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "oleaut32.lib")
#pragma comment(lib, "mfplat.lib")
#pragma comment(lib, "mf.lib")
#pragma comment(lib, "mfuuid.lib")
#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "shell32.lib")

static const wchar_t kCameraSddl[] =
    L"D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1200A9;;;LS)(A;OICI;0x12019F;;;AU)";

static const wchar_t kClsidKey[] =
    L"SOFTWARE\\Classes\\CLSID\\" HENSHIN_VCAM_CLSID_STRING;
static const wchar_t kInprocKey[] =
    L"SOFTWARE\\Classes\\CLSID\\" HENSHIN_VCAM_CLSID_STRING L"\\InprocServer32";

struct Layout {
  uint64_t total_size;
};

static Layout ComputeLayout() {
  Layout L{};
  const uint32_t stride_y = HENSHIN_VCAM_WIDTH;
  const uint32_t stride_uv = HENSHIN_VCAM_WIDTH;
  const uint64_t y_bytes = uint64_t(stride_y) * HENSHIN_VCAM_HEIGHT;
  const uint64_t uv_bytes = uint64_t(stride_uv) * (HENSHIN_VCAM_HEIGHT / 2);
  const uint32_t offset_y = SLOT_HEADER_SIZE;
  const uint32_t offset_uv = uint32_t(offset_y + y_bytes);
  const uint64_t used = uint64_t(offset_uv) + uv_bytes;
  const uint64_t slot_stride = (used + 63) & ~uint64_t(63);
  L.total_size = uint64_t(HEADER_SIZE) + SLOT_COUNT * slot_stride;
  return L;
}

static int Fail(const wchar_t* msg, HRESULT hr = S_OK) {
  if (FAILED(hr)) {
    fwprintf(stderr, L"%s (HRESULT 0x%08X)\n", msg, static_cast<unsigned>(hr));
  } else {
    fwprintf(stderr, L"%s\n", msg);
  }
  return 1;
}

static bool IsElevated() {
  HANDLE token = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) return false;
  TOKEN_ELEVATION elev{};
  DWORD returned = 0;
  const BOOL ok =
      GetTokenInformation(token, TokenElevation, &elev, sizeof(elev), &returned);
  CloseHandle(token);
  return ok && elev.TokenIsElevated != 0;
}

static bool WebcamPrivacyDenied() {
  HKEY key = nullptr;
  if (RegOpenKeyExW(HKEY_CURRENT_USER,
                    L"Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\"
                    L"ConsentStore\\webcam",
                    0, KEY_READ, &key) != ERROR_SUCCESS) {
    return false;
  }
  wchar_t value[32]{};
  DWORD type = 0;
  DWORD bytes = sizeof(value);
  const LSTATUS st = RegQueryValueExW(key, L"Value", nullptr, &type, reinterpret_cast<LPBYTE>(value),
                                      &bytes);
  RegCloseKey(key);
  return st == ERROR_SUCCESS && type == REG_SZ && _wcsicmp(value, L"Deny") == 0;
}

static uint32_t WindowsBuild() {
  HKEY key = nullptr;
  if (RegOpenKeyExW(HKEY_LOCAL_MACHINE, L"SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion", 0,
                    KEY_READ | KEY_WOW64_64KEY, &key) != ERROR_SUCCESS) {
    return 0;
  }
  wchar_t value[32]{};
  DWORD type = 0;
  DWORD bytes = sizeof(value);
  const LSTATUS st =
      RegQueryValueExW(key, L"CurrentBuildNumber", nullptr, &type, reinterpret_cast<LPBYTE>(value),
                       &bytes);
  RegCloseKey(key);
  if (st != ERROR_SUCCESS || type != REG_SZ) return 0;
  return static_cast<uint32_t>(_wtoi(value));
}

static bool MfCreateExportPresent() {
  HMODULE lib = LoadLibraryExW(L"mfsensorgroup.dll", nullptr, LOAD_LIBRARY_SEARCH_SYSTEM32);
  if (!lib) return false;
  const bool ok = GetProcAddress(lib, "MFCreateVirtualCamera") != nullptr;
  FreeLibrary(lib);
  return ok;
}

static void ProgramFilesDir(wchar_t* out, size_t cap) {
  PWSTR pf = nullptr;
  if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_ProgramFiles, 0, nullptr, &pf))) {
    swprintf_s(out, cap, L"%s\\Henshin", pf);
    CoTaskMemFree(pf);
    return;
  }
  swprintf_s(out, cap, L"C:\\Program Files\\Henshin");
}

static void InstalledDllPath(wchar_t* out, size_t cap) {
  wchar_t dir[MAX_PATH]{};
  ProgramFilesDir(dir, MAX_PATH);
  swprintf_s(out, cap, L"%s\\%s", dir, HENSHIN_VCAM_MODULE_NAME);
}

static void CameraDir(wchar_t* out, size_t cap) {
  PWSTR pd = nullptr;
  if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_ProgramData, 0, nullptr, &pd))) {
    swprintf_s(out, cap, L"%s\\Henshin\\Camera", pd);
    CoTaskMemFree(pd);
    return;
  }
  swprintf_s(out, cap, L"C:\\ProgramData\\Henshin\\Camera");
}

static void ProgramDataRoot(wchar_t* out, size_t cap) {
  PWSTR pd = nullptr;
  if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_ProgramData, 0, nullptr, &pd))) {
    swprintf_s(out, cap, L"%s\\Henshin", pd);
    CoTaskMemFree(pd);
    return;
  }
  swprintf_s(out, cap, L"C:\\ProgramData\\Henshin");
}

static void BufferPath(wchar_t* out, size_t cap) {
  wchar_t dir[MAX_PATH]{};
  CameraDir(dir, MAX_PATH);
  swprintf_s(out, cap, L"%s\\camera-buffer.bin", dir);
}

static bool PathLooksLikeUserProfile(const wchar_t* path) {
  return wcsstr(path, L"\\Users\\") != nullptr || wcsstr(path, L"AppData") != nullptr;
}

static HRESULT ApplySddl(const wchar_t* path) {
  PSECURITY_DESCRIPTOR sd = nullptr;
  if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(kCameraSddl, SDDL_REVISION_1, &sd,
                                                            nullptr)) {
    return HRESULT_FROM_WIN32(GetLastError());
  }
  BOOL present = FALSE;
  BOOL defaulted = FALSE;
  PACL dacl = nullptr;
  HRESULT hr = S_OK;
  if (!GetSecurityDescriptorDacl(sd, &present, &dacl, &defaulted) || !present || !dacl) {
    hr = HRESULT_FROM_WIN32(GetLastError());
  } else {
    const DWORD st =
        SetNamedSecurityInfoW(const_cast<LPWSTR>(path), SE_FILE_OBJECT,
                              DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                              nullptr, nullptr, dacl, nullptr);
    if (st != ERROR_SUCCESS) hr = HRESULT_FROM_WIN32(st);
  }
  LocalFree(sd);
  return hr;
}

static HRESULT EnsureCameraDirectory() {
  wchar_t root[MAX_PATH]{};
  wchar_t camera[MAX_PATH]{};
  ProgramDataRoot(root, MAX_PATH);
  CameraDir(camera, MAX_PATH);
  if (!CreateDirectoryW(root, nullptr) && GetLastError() != ERROR_ALREADY_EXISTS) {
    return HRESULT_FROM_WIN32(GetLastError());
  }
  if (!CreateDirectoryW(camera, nullptr) && GetLastError() != ERROR_ALREADY_EXISTS) {
    return HRESULT_FROM_WIN32(GetLastError());
  }
  HRESULT hr = ApplySddl(root);
  if (FAILED(hr)) return hr;
  return ApplySddl(camera);
}

static HRESULT EnsureBufferFile() {
  wchar_t path[MAX_PATH]{};
  BufferPath(path, MAX_PATH);
  HANDLE file = CreateFileW(path, GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
                            nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) return HRESULT_FROM_WIN32(GetLastError());
  LARGE_INTEGER size{};
  size.QuadPart = static_cast<LONGLONG>(ComputeLayout().total_size);
  const BOOL ok = SetFilePointerEx(file, size, nullptr, FILE_BEGIN) && SetEndOfFile(file);
  const DWORD err = ok ? ERROR_SUCCESS : GetLastError();
  CloseHandle(file);
  return ok ? S_OK : HRESULT_FROM_WIN32(err);
}

static HRESULT SetRegSz(HKEY key, const wchar_t* name, const wchar_t* value) {
  const DWORD bytes = static_cast<DWORD>((wcslen(value) + 1) * sizeof(wchar_t));
  const LSTATUS st = RegSetValueExW(key, name, 0, REG_SZ, reinterpret_cast<const BYTE*>(value),
                                    bytes);
  return HRESULT_FROM_WIN32(st);
}

static HRESULT RegisterInproc(const wchar_t* dll) {
  HKEY clsid = nullptr;
  LSTATUS st = RegCreateKeyExW(HKEY_LOCAL_MACHINE, kClsidKey, 0, nullptr, REG_OPTION_NON_VOLATILE,
                               KEY_WRITE | KEY_WOW64_64KEY, nullptr, &clsid, nullptr);
  if (st != ERROR_SUCCESS) return HRESULT_FROM_WIN32(st);
  HRESULT hr = SetRegSz(clsid, nullptr, HENSHIN_VCAM_FRIENDLY_NAME);
  RegCloseKey(clsid);
  if (FAILED(hr)) return hr;

  HKEY inproc = nullptr;
  st = RegCreateKeyExW(HKEY_LOCAL_MACHINE, kInprocKey, 0, nullptr, REG_OPTION_NON_VOLATILE,
                       KEY_WRITE | KEY_WOW64_64KEY, nullptr, &inproc, nullptr);
  if (st != ERROR_SUCCESS) return HRESULT_FROM_WIN32(st);
  hr = SetRegSz(inproc, nullptr, dll);
  if (SUCCEEDED(hr)) hr = SetRegSz(inproc, L"ThreadingModel", L"Both");
  RegCloseKey(inproc);
  return hr;
}

static HRESULT UnregisterCom() {
  const LSTATUS st = RegDeleteTreeW(HKEY_LOCAL_MACHINE, kClsidKey);
  if (st == ERROR_FILE_NOT_FOUND) return S_OK;
  return HRESULT_FROM_WIN32(st);
}

static bool ComRegistered(wchar_t* dllOut, size_t cap) {
  HKEY key = nullptr;
  if (RegOpenKeyExW(HKEY_LOCAL_MACHINE, kInprocKey, 0, KEY_READ | KEY_WOW64_64KEY, &key) !=
      ERROR_SUCCESS) {
    return false;
  }
  DWORD type = 0;
  DWORD bytes = static_cast<DWORD>(cap * sizeof(wchar_t));
  const LSTATUS st =
      RegQueryValueExW(key, nullptr, nullptr, &type, reinterpret_cast<LPBYTE>(dllOut), &bytes);
  RegCloseKey(key);
  if (st != ERROR_SUCCESS || type != REG_SZ) {
    dllOut[0] = 0;
    return true;
  }
  return true;
}

static HRESULT CopyDllReplacing(const wchar_t* src, const wchar_t* dest, uint32_t waitSecs) {
  wchar_t destDir[MAX_PATH]{};
  wcsncpy_s(destDir, dest, _TRUNCATE);
  wchar_t* slash = wcsrchr(destDir, L'\\');
  if (slash) *slash = 0;
  if (!CreateDirectoryW(destDir, nullptr) && GetLastError() != ERROR_ALREADY_EXISTS) {
    return HRESULT_FROM_WIN32(GetLastError());
  }

  wchar_t srcFull[MAX_PATH]{};
  wchar_t destFull[MAX_PATH]{};
  if (!GetFullPathNameW(src, MAX_PATH, srcFull, nullptr) ||
      !GetFullPathNameW(dest, MAX_PATH, destFull, nullptr)) {
    return HRESULT_FROM_WIN32(GetLastError());
  }
  if (_wcsicmp(srcFull, destFull) == 0) return S_OK;

  const ULONGLONG deadline = GetTickCount64() + ULONGLONG(waitSecs) * 1000ull;
  for (;;) {
    if (CopyFileW(src, dest, FALSE)) return S_OK;
    const DWORD err = GetLastError();
    if (err == ERROR_SHARING_VIOLATION || err == ERROR_ACCESS_DENIED) {
      if (GetTickCount64() >= deadline) {
        fwprintf(stderr,
                 L"DLL still loaded after %u s (FrameServer). Close Windows Camera / browsers "
                 L"using the camera, then retry.\n",
                 waitSecs);
        return HRESULT_FROM_WIN32(err);
      }
      Sleep(250);
      continue;
    }
    return HRESULT_FROM_WIN32(err);
  }
}

using PFN_MFCreateVirtualCamera = HRESULT(STDAPICALLTYPE*)(
    MFVirtualCameraType type, MFVirtualCameraLifetime lifetime, MFVirtualCameraAccess access,
    LPCWSTR friendlyName, LPCWSTR sourceId, const GUID* categories, ULONG categoryCount,
    IMFVirtualCamera** virtualCamera);

struct ComMf {
  bool needUninit = false;
  bool mf = false;
  ComMf() {
    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (SUCCEEDED(hr)) {
      needUninit = true;
    } else if (hr != RPC_E_CHANGED_MODE) {
      return;
    }
    mf = SUCCEEDED(MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET));
  }
  ~ComMf() {
    if (mf) MFShutdown();
    if (needUninit) CoUninitialize();
  }
};

static HRESULT ClassifyDenied(HRESULT hr) {
  if (hr != E_ACCESSDENIED) return hr;
  if (WebcamPrivacyDenied()) {
    fwprintf(stderr,
             L"E_ACCESSDENIED: Windows Camera privacy is blocking the virtual camera (not an "
             L"install failure). Open Settings -> Privacy & security -> Camera and allow desktop "
             L"apps.\n");
  } else {
    fwprintf(stderr,
             L"E_ACCESSDENIED: not elevated, or FrameServer cannot read the DLL. The DLL must live "
             L"under Program Files, never under a user profile.\n");
  }
  return hr;
}

static HRESULT CreateCamera(IMFVirtualCamera** out) {
  HMODULE lib = LoadLibraryExW(L"mfsensorgroup.dll", nullptr, LOAD_LIBRARY_SEARCH_SYSTEM32);
  if (!lib) return HRESULT_FROM_WIN32(GetLastError());
  auto pfn = reinterpret_cast<PFN_MFCreateVirtualCamera>(GetProcAddress(lib, "MFCreateVirtualCamera"));
  if (!pfn) {
    FreeLibrary(lib);
    return HRESULT_FROM_WIN32(ERROR_PROC_NOT_FOUND);
  }
  const HRESULT hr =
      pfn(MFVirtualCameraType_SoftwareCameraSource, MFVirtualCameraLifetime_System,
          MFVirtualCameraAccess_CurrentUser, HENSHIN_VCAM_FRIENDLY_NAME,
          HENSHIN_VCAM_CLSID_STRING, nullptr, 0, out);
  // Keep the DLL loaded for the lifetime of the IMFVirtualCamera object.
  // Leaking one HMODULE in a short-lived installer is fine.
  (void)lib;
  return hr;
}

static HRESULT CreateAndStart() {
  ComMf session;
  if (!session.mf) return E_FAIL;
  IMFVirtualCamera* cam = nullptr;
  HRESULT hr = CreateCamera(&cam);
  if (FAILED(hr)) return ClassifyDenied(hr);
  hr = cam->Start(nullptr);
  if (FAILED(hr)) {
    cam->Shutdown();
    cam->Release();
    return ClassifyDenied(hr);
  }
  cam->Shutdown();
  cam->Release();
  return S_OK;
}

static HRESULT StopAndRemove() {
  ComMf session;
  if (!session.mf) return E_FAIL;
  IMFVirtualCamera* cam = nullptr;
  HRESULT hr = CreateCamera(&cam);
  if (FAILED(hr)) {
    if (hr == REGDB_E_CLASSNOTREG || hr == HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND)) return S_OK;
    return hr;
  }
  cam->Stop();
  cam->Remove();
  cam->Shutdown();
  cam->Release();
  return S_OK;
}

static HRESULT D2CreateOnly(HRESULT* outHr) {
  ComMf session;
  if (!session.mf) return E_FAIL;
  IMFVirtualCamera* cam = nullptr;
  const HRESULT hr = CreateCamera(&cam);
  *outHr = hr;
  if (SUCCEEDED(hr) && cam) {
    cam->Shutdown();
    cam->Release();
  }
  return S_OK;
}

static int RequireElevated() {
  if (IsElevated()) return 0;
  return Fail(L"vcam-register must run elevated (UAC). Right-click → Run as administrator.");
}

static int CmdInstall(const wchar_t* dll, uint32_t waitSecs, bool isUpdate) {
  if (RequireElevated() != 0) return 1;
  wchar_t dest[MAX_PATH]{};
  InstalledDllPath(dest, MAX_PATH);
  if (PathLooksLikeUserProfile(dest)) {
    return Fail(
        L"Refusing to install the COM server under a user profile. FrameServer cannot load it; "
        L"the DLL must live under Program Files.");
  }
  if (GetFileAttributesW(dll) == INVALID_FILE_ATTRIBUTES) {
    fwprintf(stderr, L"DLL not found: %s\n", dll);
    return 1;
  }
  if (isUpdate) {
    StopAndRemove();
  }
  HRESULT hr = CopyDllReplacing(dll, dest, waitSecs);
  if (FAILED(hr)) return Fail(L"copy DLL", hr);
  if (!isUpdate) {
    hr = EnsureCameraDirectory();
    if (FAILED(hr)) return Fail(L"camera ACLs", hr);
    hr = EnsureBufferFile();
    if (FAILED(hr)) return Fail(L"camera-buffer.bin", hr);
  }
  hr = RegisterInproc(dest);
  if (FAILED(hr)) return Fail(L"HKLM COM registration", hr);
  hr = CreateAndStart();
  if (FAILED(hr)) return Fail(L"MFCreateVirtualCamera / Start", hr);
  wprintf(L"%s %s\n", isUpdate ? L"updated" : L"installed", dest);
  return 0;
}

static int CmdRemove() {
  if (RequireElevated() != 0) return 1;
  StopAndRemove();
  UnregisterCom();
  wchar_t camera[MAX_PATH]{};
  CameraDir(camera, MAX_PATH);
  wchar_t dll[MAX_PATH]{};
  InstalledDllPath(dll, MAX_PATH);
  // SHFileOperation-style recursive delete of Camera only.
  wchar_t doubleNul[MAX_PATH + 2]{};
  wcsncpy_s(doubleNul, camera, _TRUNCATE);
  SHFILEOPSTRUCTW op{};
  op.wFunc = FO_DELETE;
  op.pFrom = doubleNul;
  op.fFlags = FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT;
  SHFileOperationW(&op);
  DeleteFileW(dll);
  wprintf(L"removed. VB-CABLE was not touched.\n");
  return 0;
}

static int CmdProbe() {
  const uint32_t build = WindowsBuild();
  const bool elevated = IsElevated();
  const bool privacy = WebcamPrivacyDenied();
  const bool exportPresent = MfCreateExportPresent();
  wchar_t dll[MAX_PATH]{};
  const bool com = ComRegistered(dll, MAX_PATH);

  wprintf(L"windows_build=%u\n", build);
  wprintf(L"elevated=%s\n", elevated ? L"yes" : L"no");
  wprintf(L"mfcreate_export=%s\n", exportPresent ? L"yes" : L"no");
  wprintf(L"camera_privacy_denied=%s\n", privacy ? L"yes" : L"no");
  wprintf(L"com_registered=%s\n", com ? L"yes" : L"no");
  if (com && dll[0]) wprintf(L"dll=%s\n", dll);
  wprintf(L"clsid=%s\n", HENSHIN_VCAM_CLSID_STRING);
  wprintf(L"name=%s\n", HENSHIN_VCAM_FRIENDLY_NAME);

  if (build < 22000) {
    wprintf(L"note: Windows build %u is below Microsoft's documented floor (22000).\n", build);
  }
  if (!exportPresent) {
    wprintf(L"note: mfsensorgroup.dll does not export MFCreateVirtualCamera.\n");
  } else {
    HRESULT createHr = E_FAIL;
    if (SUCCEEDED(D2CreateOnly(&createHr))) {
      wprintf(L"MFCreateVirtualCamera HRESULT 0x%08X (create only, Start not called)\n",
              static_cast<unsigned>(createHr));
    }
  }
  if (privacy) {
    wprintf(L"note: Camera privacy is Deny. Start() will return E_ACCESSDENIED.\n");
  }
  if (!elevated) {
    wprintf(L"note: Not elevated: HKLM registration and Start will fail.\n");
  }
  return 0;
}

static int CmdSmoke() {
  ComMf session;
  if (!session.mf) return Fail(L"COM/MF startup failed");
  IMFAttributes* attrs = nullptr;
  HRESULT hr = MFCreateAttributes(&attrs, 1);
  if (FAILED(hr)) return Fail(L"MFCreateAttributes", hr);
  hr = attrs->SetGUID(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE,
                      MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID);
  if (FAILED(hr)) {
    attrs->Release();
    return Fail(L"SetGUID", hr);
  }
  IMFActivate** devices = nullptr;
  UINT32 count = 0;
  hr = MFEnumDeviceSources(attrs, &devices, &count);
  attrs->Release();
  if (FAILED(hr)) return Fail(L"MFEnumDeviceSources", hr);

  bool found = false;
  for (UINT32 i = 0; i < count; ++i) {
    WCHAR* name = nullptr;
    UINT32 nameLen = 0;
    if (SUCCEEDED(devices[i]->GetAllocatedString(MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME, &name,
                                                 &nameLen))) {
      wprintf(L"  device: %s\n", name);
      if (wcsstr(name, HENSHIN_VCAM_FRIENDLY_NAME) != nullptr) found = true;
      CoTaskMemFree(name);
    }
    devices[i]->Release();
  }
  CoTaskMemFree(devices);
  if (!found) {
    return Fail(
        L"Henshin Camera is not in the Media Foundation device list. Install first, then "
        L"retry. Seeing nothing here means FrameServer did not accept the COM server.");
  }
  wprintf(L"vcam-smoke PASS: %s is enumerable\n", HENSHIN_VCAM_FRIENDLY_NAME);
  return 0;
}

static const wchar_t* ArgValue(int argc, wchar_t** argv, const wchar_t* flag) {
  for (int i = 0; i < argc - 1; ++i) {
    if (_wcsicmp(argv[i], flag) == 0) return argv[i + 1];
  }
  return nullptr;
}

int wmain(int argc, wchar_t** argv) {
  const wchar_t* cmd = (argc >= 2) ? argv[1] : L"help";
  const wchar_t* dll = ArgValue(argc, argv, L"--dll");
  const wchar_t* waitStr = ArgValue(argc, argv, L"--wait-unload");
  uint32_t waitSecs = 30;
  if (waitStr) waitSecs = static_cast<uint32_t>(_wtoi(waitStr));

  if (_wcsicmp(cmd, L"install") == 0) {
    if (!dll) return Fail(L"install requires --dll PATH");
    return CmdInstall(dll, waitSecs, false);
  }
  if (_wcsicmp(cmd, L"update") == 0) {
    if (!dll) return Fail(L"update requires --dll PATH");
    return CmdInstall(dll, waitSecs, true);
  }
  if (_wcsicmp(cmd, L"remove") == 0) return CmdRemove();
  if (_wcsicmp(cmd, L"probe") == 0) return CmdProbe();
  if (_wcsicmp(cmd, L"smoke") == 0) return CmdSmoke();

  wprintf(
      L"vcam-register — Henshin virtual camera\n"
      L"  install --dll PATH [--wait-unload SECS]\n"
      L"  update  --dll PATH [--wait-unload SECS]\n"
      L"  remove\n"
      L"  probe\n"
      L"  smoke\n");
  return 1;
}
