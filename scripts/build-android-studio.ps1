[CmdletBinding()]
param([string]$AndroidStudioHome = $env:ANDROID_STUDIO_HOME)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'build-jetbrains.ps1') -Ide android-studio -IdeHome $AndroidStudioHome
