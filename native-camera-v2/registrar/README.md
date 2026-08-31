# vcam-register

Elevated installer helper for **Henshin Camera**. Replaces the archived
Rust `tools/vcam-register` crate on the Electron line (no Cargo workspace).

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File native-camera-v2\registrar\build.ps1
```

Output: `native-camera-v2/registrar/build/Release/vcam-register.exe`

Prefer `installer\vcam.ps1` (elevated) rather than invoking this exe by hand.
