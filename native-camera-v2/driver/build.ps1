<#
.SYNOPSIS
  Builds the Henshin virtual camera DLL and its host-side tests.

.DESCRIPTION
  Drives MSVC directly through vcvars64.bat. No CMake dependency: the only
  requirements are Visual Studio with the C++ workload and a Windows SDK that
  ships mfvirtualcamera.h (10.0.22000 or later).

  Outputs land in native-camera-v2/driver/build/<config>/.

.PARAMETER Config
  Debug or Release. Default Release.

.PARAMETER Tests
  Also build (and by default run) the bridge-reader unit tests.

.PARAMETER NoRun
  Build the tests without running them.
#>
[CmdletBinding()]
param(
  [ValidateSet('Debug', 'Release')]
  [string]$Config = 'Release',
  [switch]$Tests,
  [switch]$TestsOnly,
  [switch]$NoRun
)

if ($TestsOnly) { $Tests = $true }

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Resolve-Path (Join-Path $root '..\..')
$outDir = Join-Path $root "build\$Config"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function Find-VcVars {
  $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
  if (-not (Test-Path $vswhere)) {
    throw 'vswhere.exe not found. Install Visual Studio with the "Desktop development with C++" workload.'
  }
  $install = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  if (-not $install) {
    $install = & $vswhere -latest -products * -property installationPath
  }
  if (-not $install) { throw 'No Visual Studio installation found.' }
  $vcvars = Join-Path $install 'VC\Auxiliary\Build\vcvars64.bat'
  if (-not (Test-Path $vcvars)) { throw "vcvars64.bat not found under $install" }
  return $vcvars
}

# vcvars64.bat only exports into a cmd session, so capture its environment once
# and replay it into this process.
function Import-VcEnvironment {
  param([string]$VcVars)
  $output = & cmd.exe /c "`"$VcVars`" >nul 2>&1 && set"
  foreach ($line in $output) {
    if ($line -match '^([^=]+)=(.*)$') {
      Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2] -ErrorAction SilentlyContinue
    }
  }
}

Import-VcEnvironment -VcVars (Find-VcVars)

$sdkInclude = $env:WindowsSdkVerBinPath
Write-Host "Toolchain : $env:VCToolsVersion" -ForegroundColor Cyan
Write-Host "Windows SDK: $env:WindowsSDKVersion" -ForegroundColor Cyan

$common = @(
  '/nologo', '/std:c++20', '/EHsc', '/W4', '/WX', '/permissive-',
  '/DUNICODE', '/D_UNICODE', '/DNOMINMAX',
  "/I$root\include"
)
# Static CRT on purpose: the DLL is loaded by the FrameServer service, which
# must not depend on the VC redistributable being installed machine-wide.
if ($Config -eq 'Release') {
  $common += @('/O2', '/DNDEBUG', '/MT', '/Gy', '/GS', '/GL')
} else {
  $common += @('/Od', '/Zi', '/MTd', '/RTC1', '/D_DEBUG')
}

$dllSources = @(
  "$root\com\dll_main.cpp",
  "$root\com\module.cpp",
  "$root\com\class_factory.cpp",
  "$root\com\activator.cpp",
  "$root\media-source\media_source.cpp",
  "$root\media-stream\media_stream.cpp",
  "$root\bridge-reader\bridge_reader.cpp",
  "$root\trace\etw.cpp"
)

$dllLibs = @(
  'mfplat.lib', 'mf.lib', 'mfuuid.lib', 'mfreadwrite.lib', 'mfsensorgroup.lib',
  'ole32.lib', 'oleaut32.lib', 'shell32.lib', 'advapi32.lib', 'ksuser.lib',
  'propsys.lib', 'shlwapi.lib'
)

if (-not $TestsOnly) {
  $missing = $dllSources | Where-Object { -not (Test-Path $_) }
  if ($missing) {
    throw "Missing sources:`n  $($missing -join "`n  ")"
  }
}

Push-Location $outDir
try {
  if (-not $TestsOnly) {
    Write-Host "Compiling henshin-vcam.dll ($Config)..." -ForegroundColor Cyan
    $linkArgs = @("/DLL", "/OUT:$outDir\henshin-vcam.dll", "/DEF:$root\com\henshin-vcam.def")
    if ($Config -eq 'Release') { $linkArgs += '/LTCG' } else { $linkArgs += '/DEBUG' }
    & cl.exe @common @dllSources /link @linkArgs @dllLibs
    if ($LASTEXITCODE -ne 0) { throw "DLL build failed ($LASTEXITCODE)" }
    Write-Host "  -> $outDir\henshin-vcam.dll" -ForegroundColor Green
  }

  if ($Tests) {
    Write-Host "Compiling bridge-reader tests..." -ForegroundColor Cyan
    $testSources = @("$root\tests\bridge_reader_test.cpp", "$root\bridge-reader\bridge_reader.cpp")
    & cl.exe @common @testSources /link "/OUT:$outDir\bridge-reader-test.exe" ole32.lib shell32.lib
    if ($LASTEXITCODE -ne 0) { throw "test build failed ($LASTEXITCODE)" }
    Write-Host "  -> $outDir\bridge-reader-test.exe" -ForegroundColor Green
    if (-not $NoRun) {
      & "$outDir\bridge-reader-test.exe"
      if ($LASTEXITCODE -ne 0) { throw "bridge-reader tests failed ($LASTEXITCODE)" }
    }

    Write-Host "Compiling COM lifetime tests..." -ForegroundColor Cyan
    $comSources = @(
      "$root\tests\com_lifetime_test.cpp",
      "$root\com\dll_main.cpp",
      "$root\com\module.cpp",
      "$root\com\class_factory.cpp",
      "$root\com\activator.cpp",
      "$root\media-source\media_source.cpp",
      "$root\media-stream\media_stream.cpp",
      "$root\bridge-reader\bridge_reader.cpp",
      "$root\trace\etw.cpp"
    )
    & cl.exe @common @comSources /link "/OUT:$outDir\com-lifetime-test.exe" @dllLibs
    if ($LASTEXITCODE -ne 0) { throw "com-lifetime test build failed ($LASTEXITCODE)" }
    Write-Host "  -> $outDir\com-lifetime-test.exe" -ForegroundColor Green
    if (-not $NoRun) {
      & "$outDir\com-lifetime-test.exe"
      if ($LASTEXITCODE -ne 0) { throw "com-lifetime tests failed ($LASTEXITCODE)" }
    }

    Write-Host "Compiling in-process streaming test..." -ForegroundColor Cyan
    $streamSources = @(
      "$root\tests\streaming_test.cpp",
      "$root\com\dll_main.cpp",
      "$root\com\module.cpp",
      "$root\com\class_factory.cpp",
      "$root\com\activator.cpp",
      "$root\media-source\media_source.cpp",
      "$root\media-stream\media_stream.cpp",
      "$root\bridge-reader\bridge_reader.cpp",
      "$root\trace\etw.cpp"
    )
    & cl.exe @common @streamSources /link "/OUT:$outDir\streaming-test.exe" @dllLibs
    if ($LASTEXITCODE -ne 0) { throw "streaming test build failed ($LASTEXITCODE)" }
    Write-Host "  -> $outDir\streaming-test.exe" -ForegroundColor Green
    # Not auto-run: it needs camera-producer --file publishing on the bridge.
  }
} finally {
  Pop-Location
}

Write-Host "Build complete: $outDir" -ForegroundColor Green
