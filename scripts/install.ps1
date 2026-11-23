[CmdletBinding(SupportsShouldProcess)]
param(
  [ValidatePattern('^[A-Za-z0-9_-]+$')][string]$Profile='desktop',
  [string]$DshCli=$env:DSH_CLI, [string]$VSCodeCli='', [string]$RiderConfig='', [string]$AndroidStudioConfig='',
  [switch]$SkipDsh, [switch]$SkipVSCode, [switch]$SkipRider, [switch]$SkipAndroidStudio, [switch]$NoBuild
)
$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if (-not $NoBuild -and -not $WhatIfPreference) {
  $node=(Get-Command node.exe -ErrorAction Stop).Source
  $nodeVersion=& $node --version
  if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 22) { throw 'Node.js 22 or newer is required to build from source.' }
  $npm=(Get-Command npm.cmd -ErrorAction Stop).Source
  Push-Location $root
  try {
    & $npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    & $npm run package:editors
    if ($LASTEXITCODE -ne 0) { throw 'Plugin packaging failed.' }
  } finally { Pop-Location }
}
$arguments=@{}
foreach ($key in $PSBoundParameters.Keys) { if ($key -ne 'NoBuild') { $arguments[$key]=$PSBoundParameters[$key] } }
$arguments.PackageDirectory=Join-Path $root 'dist\code-editors'
& (Join-Path $PSScriptRoot 'install-code-editors.ps1') @arguments
