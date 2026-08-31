[CmdletBinding()]
param(
  [ValidateSet('Debug', 'Release')]
  [string]$Config = 'Release',
  [switch]$Tests
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $root 'driver\build.ps1') -Config $Config -Tests:$Tests
if ($LASTEXITCODE -ne 0) { throw 'Henshin virtual-camera driver build failed' }
& (Join-Path $root 'publisher\build.ps1') -Config $Config
if ($LASTEXITCODE -ne 0) { throw 'Henshin virtual-camera publisher build failed' }
& (Join-Path $root 'registrar\build.ps1') -Config $Config
if ($LASTEXITCODE -ne 0) { throw 'Henshin virtual-camera registrar build failed' }
Write-Host "Henshin Windows 11 camera build complete ($Config)." -ForegroundColor Green
