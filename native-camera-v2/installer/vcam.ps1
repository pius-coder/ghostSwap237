#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Install, update, remove, or probe the Henshin virtual camera.

.DESCRIPTION
  Sequence is ARCHITECTURE §18:
    1. Copy henshin-vcam.dll under Program Files (not a user profile)
    2. Deterministic ACLs on C:\ProgramData\Henshin\Camera
    3. Size camera-buffer.bin
    4. HKLM COM (InprocServer32, ThreadingModel=Both)
    5. MFCreateVirtualCamera Lifetime_System + Access_CurrentUser, then Start
    6. Detect VB-CABLE (never uninstall it)

  The Electron line does not use Cargo. vcam-register is built with MSVC
  (native-camera-v2/registrar). Pixel smoke is OBS/Meet after electron:dev; optional
  -Smoke only checks that Media Foundation can enumerate Henshin Camera.

  Uninstall order is camera → COM → ProgramData\Camera → binaries.
  VB-CABLE is never removed.

.PARAMETER Action
  install | update | remove | probe

.PARAMETER Dll
  Path to henshin-vcam.dll. Default: native-camera-v2/driver/build/Release then Debug.

.PARAMETER Smoke
  After install/update, enumerate MF video devices and require Henshin Camera.

.PARAMETER WaitUnloadSecs
  How long to wait for FrameServer to release the DLL on update (default 30).
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('install', 'update', 'remove', 'probe')]
  [string]$Action = 'install',
  [string]$Dll,
  [switch]$Smoke,
  [int]$WaitUnloadSecs = 30
)

$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..')

# Native commands write progress to stderr; under Windows PowerShell 5.1 with
# ErrorActionPreference=Stop every stderr line would become a terminating
# error. Run them with 'Continue' and judge by $LASTEXITCODE only.
function Invoke-NativeCmd {
  param([string]$Exe, [string[]]$NativeArgs = @())
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    if ($NativeArgs.Count -gt 0) { & $Exe @NativeArgs 2>&1 | ForEach-Object { Write-Host "$_" } }
    else { & $Exe 2>&1 | ForEach-Object { Write-Host "$_" } }
  } finally {
    $ErrorActionPreference = $prev
  }
  return $LASTEXITCODE
}

function Invoke-BuildScript {
  param([string]$RelPath)
  $script = Join-Path $repo $RelPath
  if (-not (Test-Path $script)) { throw "missing $RelPath" }
  Write-Host "Building $RelPath..." -ForegroundColor Cyan
  $code = Invoke-NativeCmd powershell @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $script)
  if ($code -ne 0) { throw "$RelPath failed ($code)" }
}

function Find-Dll {
  param([string]$Explicit)
  if ($Explicit) {
    if (-not (Test-Path $Explicit)) { throw "DLL not found: $Explicit" }
    return (Resolve-Path $Explicit).Path
  }
  $candidates = @(
    (Join-Path $repo 'native-camera-v2\driver\build\Release\henshin-vcam.dll'),
    (Join-Path $repo 'native-camera-v2\driver\build\Debug\henshin-vcam.dll')
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { return (Resolve-Path $c).Path }
  }
  Invoke-BuildScript 'native-camera-v2\driver\build.ps1'
  foreach ($c in $candidates) {
    if (Test-Path $c) { return (Resolve-Path $c).Path }
  }
  throw "henshin-vcam.dll not built. Run native-camera-v2\driver\build.ps1 first."
}

function Find-Register {
  $candidates = @(
    (Join-Path $repo 'native-camera-v2\registrar\build\Release\vcam-register.exe'),
    (Join-Path $repo 'native-camera-v2\registrar\build\Debug\vcam-register.exe')
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { return (Resolve-Path $c).Path }
  }
  return $null
}

function Ensure-Register {
  Write-Host 'Building vcam-register (MSVC, no Cargo)...' -ForegroundColor Cyan
  Invoke-BuildScript 'native-camera-v2\registrar\build.ps1'
  $reg = Find-Register
  if (-not $reg) { throw 'vcam-register.exe not found after MSVC build' }
  return $reg
}

function Test-VbCable {
  $paths = @(
    'C:\Windows\System32\drivers\vbaudio_cable64_win7.sys',
    'C:\Windows\System32\drivers\vbaudio_cable_win7.sys',
    'C:\Program Files\VB\CABLE',
    'C:\Program Files (x86)\VB\CABLE'
  )
  foreach ($p in $paths) {
    if (Test-Path $p) { return $true }
  }
  try {
    $dev = Get-PnpDevice -ErrorAction SilentlyContinue |
      Where-Object { $_.FriendlyName -match 'CABLE (Input|Output)|VB-Audio Virtual Cable' }
    if ($dev) { return $true }
  } catch {}
  return $false
}

function Write-VbCableNote {
  if (Test-VbCable) {
    Write-Host 'VB-CABLE detected. Not modified.' -ForegroundColor Green
  } else {
    Write-Host 'VB-CABLE not detected. Voice needs it; video does not. Origin: www.vb-cable.com' -ForegroundColor Yellow
  }
}

$register = Ensure-Register

switch ($Action) {
  'probe' {
    $code = Invoke-NativeCmd $register @('probe')
    if ($code -ne 0) { throw "vcam-register probe failed ($code)" }
    Write-VbCableNote
  }
  'install' {
    $dllPath = Find-Dll $Dll
    Write-Host "installing $dllPath" -ForegroundColor Cyan
    $code = Invoke-NativeCmd $register @('install', '--dll', $dllPath, '--wait-unload', "$WaitUnloadSecs")
    if ($code -ne 0) { throw "vcam-register install failed ($code)" }
    Write-VbCableNote
    if ($Smoke) {
      $code = Invoke-NativeCmd $register @('smoke')
      if ($code -ne 0) { throw "vcam-register smoke failed ($code)" }
    } else {
      Write-Host 'Pixel smoke is OBS/Meet after bun run electron:dev (Henshin Camera). Use -Smoke to enumerate the device now.' -ForegroundColor DarkGray
    }
    Write-Host 'install complete' -ForegroundColor Green
  }
  'update' {
    $dllPath = Find-Dll $Dll
    Write-Host "updating from $dllPath" -ForegroundColor Cyan
    $code = Invoke-NativeCmd $register @('update', '--dll', $dllPath, '--wait-unload', "$WaitUnloadSecs")
    if ($code -ne 0) { throw "vcam-register update failed ($code)" }
    if ($Smoke) {
      $code = Invoke-NativeCmd $register @('smoke')
      if ($code -ne 0) { throw "vcam-register smoke failed ($code)" }
    }
    Write-Host 'update complete' -ForegroundColor Green
  }
  'remove' {
    $code = Invoke-NativeCmd $register @('remove')
    if ($code -ne 0) { throw "vcam-register remove failed ($code)" }
    Write-Host 'removed. VB-CABLE was not touched.' -ForegroundColor Green
  }
}
