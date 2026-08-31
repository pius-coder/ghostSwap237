<#
.SYNOPSIS
  Builds henshin-vcam-publisher.exe (stdin RGBA → NV12 seqlock bridge).
#>
[CmdletBinding()]
param(
  [ValidateSet('Debug', 'Release')]
  [string]$Config = 'Release'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$outDir = Join-Path $root "build\$Config"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function Find-VcVars {
  $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
  if (-not (Test-Path $vswhere)) {
    throw 'vswhere.exe not found.'
  }
  $install = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  if (-not $install) { throw 'No Visual Studio C++ workload found.' }
  $vcvars = Join-Path $install 'VC\Auxiliary\Build\vcvars64.bat'
  if (-not (Test-Path $vcvars)) { throw "vcvars64.bat not found under $install" }
  return $vcvars
}

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

$flags = @('/nologo', '/std:c++20', '/EHsc', '/W4', '/WX', '/permissive-', '/DUNICODE', '/D_UNICODE', '/DNOMINMAX', '/O2', '/DNDEBUG', '/MT')
$src = Join-Path $root 'main.cpp'
$exe = Join-Path $outDir 'henshin-vcam-publisher.exe'
$obj = Join-Path $outDir 'main.obj'
& cl.exe @flags "/Fo$obj" $src "/Fe$exe" ole32.lib shell32.lib advapi32.lib
if ($LASTEXITCODE -ne 0) { throw "publisher build failed ($LASTEXITCODE)" }
Write-Host "  -> $exe" -ForegroundColor Green

$testSrc = Join-Path $root 'mapping_restart_test.cpp'
$testExe = Join-Path $outDir 'mapping_restart_test.exe'
$testObj = Join-Path $outDir 'mapping_restart_test.obj'
& cl.exe @flags "/Fo$testObj" $testSrc "/Fe$testExe" ole32.lib shell32.lib
if ($LASTEXITCODE -ne 0) { throw "mapping_restart_test build failed ($LASTEXITCODE)" }
Write-Host "  -> $testExe" -ForegroundColor Green
