# Henshin virtual camera (Media Foundation)

Custom `IMFMediaSourceEx` COM server loaded by **Windows FrameServer**, not by the
Henshin app. Identity (CLSID, friendly name, module, 1280×720 30/1) is
single-sourced in `native-camera-v2/driver/include/vcam_ids.h`.

Do not copy DirectShow samples. Do not register this CLSID in HKCU. Do not install
the DLL under a user profile.

## Build

Requires Visual Studio with the C++ workload and a Windows SDK that ships
`mfvirtualcamera.h` (10.0.22000 or later).

```powershell
# Release DLL
powershell -NoProfile -ExecutionPolicy Bypass -File native-camera-v2\driver\build.ps1

# Debug DLL + host-side tests (bridge-reader, COM lifetime)
powershell -NoProfile -ExecutionPolicy Bypass -File native-camera-v2\driver\build.ps1 -Config Debug -Tests
```

Output: `native-camera-v2/driver/build/<Debug|Release>/henshin-vcam.dll`

Static CRT (`/MT` / `/MTd`) on purpose: FrameServer must not depend on the VC
redistributable.

## Install / smoke

```powershell
# Elevated. Copies the DLL to Program Files, HKLM COM, MFCreateVirtualCamera,
# ACLs on ProgramData\Henshin\Camera. VB-CABLE is never removed.
# No Cargo: installer\vcam.ps1 builds native-camera-v2\registrar with MSVC.
powershell -NoProfile -ExecutionPolicy Bypass -File installer\vcam.ps1 install
# or: installer\vcam.cmd install

# Optional MF device enumeration (not a pixel ReadSample):
powershell -NoProfile -ExecutionPolicy Bypass -File installer\vcam.ps1 install -Smoke
```

Pixel smoke is OBS/Meet after `bun run electron:dev`. Seeing the name in Settings is not enough.

## Debugging FrameServer

Microsoft Windows-Camera / SimpleMediaSource:

1. Before `IMFVirtualCamera::Start`, attach to **Frame Server Monitor**
   (`FrameServerMonitor.exe`). That is the process that loads the DLL to
   validate it.
2. After Start, attach to **Frame Server** (`FrameServer.exe`). That is the
   process that serves samples to apps.

ETW provider is TraceLogging in `trace/etw.cpp`. Do not write a per-frame log
file from the DLL.

## Contract reminders

- Activation must succeed with **no producer**. FrameServer CoCreates `IMFActivate`, then `ActivateObject`.
- `RequestSample` FIFO max 2; token via `MFSampleExtension_Token`.
- Producer loss: short gap → `MEStreamTick`; long → `ProducerStale`; never
  `MEEndOfStream`.
- Copy NV12 **line-by-line at the real MF pitch**.
- `GetSourceAttributes` returns the live store, not a clone. Activate attributes are copied in.
- Stream `MF_DEVICESTREAM_*` attrs are set on **both** the stream store and the descriptor.
- Start event order: `MENewStream`/`MEUpdatedStream` → stream `MEStreamStarted`
  → `MESourceStarted` (timestamp = `MFGetSystemTime()`).
- `SetStreamState(PAUSE)` does not stop the stream, but `RequestSample` is
  rejected (`MF_E_INVALIDREQUEST`). `IMFMediaSource::Pause` stays invalid.
- `SetD3DManager` is a no-op so sample memory stays CPU-backed.
- `Shutdown()` is idempotent; other methods return `MF_E_SHUTDOWN`.
- Uninstall order is camera → COM → files.
