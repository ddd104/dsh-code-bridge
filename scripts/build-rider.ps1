[CmdletBinding()]
param([string]$RiderHome = $env:RIDER_HOME)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'build-jetbrains.ps1') -Ide rider -IdeHome $RiderHome
