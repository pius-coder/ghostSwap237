# Virtual camera installer (ARCHITECTURE §18)

This directory holds the virtual-camera sequence (ARCHITECTURE §18) used by
the NSIS product installer (`bun run pack:win`). VB-CABLE is never uninstalled.

The Electron line does **not** use Cargo. `vcam-register` is a small MSVC
tool under `native-camera-v2/registrar` that copies `henshin-vcam.dll`, writes
HKLM COM, and calls `MFCreateVirtualCamera`.

```powershell
# From an elevated prompt, repo root. Bypass is required on machines whose
# execution policy is Restricted (Windows default) — it does not change the
# persisted policy.
powershell -NoProfile -ExecutionPolicy Bypass -File installer\vcam.ps1 install
powershell -NoProfile -ExecutionPolicy Bypass -File installer\vcam.ps1 probe
powershell -NoProfile -ExecutionPolicy Bypass -File installer\vcam.ps1 update
powershell -NoProfile -ExecutionPolicy Bypass -File installer\vcam.ps1 remove

# Optional: confirm Media Foundation can enumerate Henshin Camera
powershell -NoProfile -ExecutionPolicy Bypass -File installer\vcam.ps1 install -Smoke

# Same thing via the cmd wrapper:
installer\vcam.cmd install
```

If the DLL is not built yet, `install` runs `native-camera-v2\driver\build.ps1`.

On French (and other localized) Windows SKUs, Settings may show
`Henshin Camera (Caméra virtuelle Windows)`.

Pixel-level smoke (edited Live frames) is: start Henshin (`bun run electron:dev`),
then pick **Henshin Camera** in OBS or Meet. Seeing the name in Settings is
not enough.

VB-CABLE is detected and reported. It is **never** uninstalled here: other
applications may depend on it. Origin: [www.vb-cable.com](https://www.vb-cable.com)
(donationware).

Uninstall order is normative: virtual camera → HKLM COM →
`C:\ProgramData\Henshin\Camera` → `henshin-vcam.dll` under Program Files.
