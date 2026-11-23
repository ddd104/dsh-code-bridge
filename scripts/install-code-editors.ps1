[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$PackageDirectory = '',
  [ValidatePattern('^[A-Za-z0-9_-]+$')][string]$Profile = 'desktop',
  [string]$DshCli = $env:DSH_CLI,
  [string]$VSCodeCli = '',
  [string]$RiderConfig = '',
  [string]$AndroidStudioConfig = '',
  [switch]$SkipDsh, [switch]$SkipVSCode, [switch]$SkipRider, [switch]$SkipAndroidStudio
)
$ErrorActionPreference = 'Stop'
if (-not $PackageDirectory) { $PackageDirectory = $PSScriptRoot }
$PackageDirectory = (Resolve-Path -LiteralPath $PackageDirectory).Path
$release = Get-Content -LiteralPath (Join-Path $PackageDirectory 'release.json') -Raw | ConvertFrom-Json
if ($release.version -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$') { throw 'Invalid release version.' }
$stamp = (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8)
$plan = @()
function Get-Archive([string]$Component, [string]$Expected) {
  $name = $release.packages.$Component
  if (-not $name) { return $null }
  if ($name -ne $Expected) { throw "Unexpected $Component package name: $name" }
  $path = Join-Path $PackageDirectory $name
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Package missing: $path" }
  return (Resolve-Path -LiteralPath $path).Path
}
function Assert-Unlinked([string]$Path) {
  $current = [IO.Path]::GetFullPath($Path)
  while ($current) {
    if ((Test-Path -LiteralPath $current) -and ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Refusing a linked installation path: $current" }
    $current = [IO.Path]::GetDirectoryName($current)
  }
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
function Assert-PluginArchive([string]$Path) {
  $zip = [IO.Compression.ZipFile]::OpenRead($Path)
  try {
    $jar = $false
    foreach ($entry in $zip.Entries) {
      $name = $entry.FullName.Replace('\','/')
      if (-not $name.StartsWith('ask-for-dsh/') -or $name -match '(^|/)\.\.?(/|$)|:|^/' -or (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { throw "Unexpected ZIP entry: $name" }
      if ($name -eq 'ask-for-dsh/lib/ask-for-dsh.jar') { $jar = $true }
    }
    if (-not $jar) { throw "Plugin JAR missing in $Path" }
  } finally { $zip.Dispose() }
}
# Resolve all selected destinations before changing any installation.
if (-not $SkipDsh) {
  $archive = Get-Archive 'dsh' "dsh-code-bridge-$($release.version).tgz"
  if (-not $archive) { throw 'DSH package missing from release.json.' }
  $DshCli = & (Join-Path $PSScriptRoot 'resolve-dsh-cli.ps1') -DshCli $DshCli -NoPrompt
  $dshRoot = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
  $profileRoot = [IO.Path]::GetFullPath((Join-Path $dshRoot ('profiles\' + $Profile)))
  if (-not (Test-Path -LiteralPath (Join-Path $profileRoot 'package.json'))) { throw "DSH profile '$Profile' is not initialized. Open DSH once, or select an existing -Profile." }
  Assert-Unlinked $profileRoot
  $plan += [pscustomobject]@{component='DSH';archive=$archive;destination=$profileRoot;cli=$DshCli}
}
if (-not $SkipVSCode) {
  $archive = Get-Archive 'vscode' "ask-for-dsh-vscode-$($release.version).vsix"
  if ($VSCodeCli) { $VSCodeCli = (Resolve-Path -LiteralPath $VSCodeCli).Path }
  else { $VSCodeCli = (Get-Command code.cmd -ErrorAction SilentlyContinue).Source }
  if ($archive -and $VSCodeCli) { $plan += [pscustomobject]@{component='VSCode';archive=$archive;destination=$VSCodeCli;cli=$VSCodeCli} }
  else { Write-Output 'SKIPPED VS Code: package or code.cmd is unavailable; use Install from VSIX when ready.' }
}
foreach ($ide in @('rider','android-studio')) {
  if (($ide -eq 'rider' -and $SkipRider) -or ($ide -eq 'android-studio' -and $SkipAndroidStudio)) { continue }
  $config = if ($ide -eq 'rider') { $RiderConfig } else { $AndroidStudioConfig }
  $explicitConfig = -not [string]::IsNullOrWhiteSpace($config)
  $archive = Get-Archive $ide "ask-for-dsh-$ide-$($release.version).zip"
  if (-not $archive) {
    if ($explicitConfig) { throw "No $ide package in this release. Build it with a compatible SDK first." }
    Write-Output "SKIPPED ${ide}: package unavailable; see release.json for the build requirement."; continue
  }
  if (-not $config) {
    $vendor = if ($ide -eq 'rider') { 'JetBrains' } else { 'Google' }
    $prefix = if ($ide -eq 'rider') { 'Rider' } else { 'AndroidStudio' }
    $minimum = if ($ide -eq 'rider') { [version]'2026.1' } else { [version]'2025.3' }
    $config = Get-ChildItem -LiteralPath (Join-Path $env:APPDATA $vendor) -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match ('^' + $prefix + '(\d+\.\d+(\.\d+)?)$') -and [version]$Matches[1] -ge $minimum } |
      Sort-Object { [version]($_.Name.Substring($prefix.Length)) } -Descending | Select-Object -First 1 -ExpandProperty FullName
  }
  if (-not $config) { Write-Output "SKIPPED ${ide}: no supported user configuration found. Open the IDE once or pass its config path."; continue }
  $config = (Resolve-Path -LiteralPath $config).Path
  if (-not (Test-Path -LiteralPath $config -PathType Container)) { throw "Not a configuration directory: $config" }
  Assert-Unlinked $config
  Assert-Unlinked (Join-Path $config 'plugins\ask-for-dsh')
  Assert-PluginArchive $archive
  $plan += [pscustomobject]@{component=$ide;archive=$archive;destination=$config;cli=$null}
}
foreach ($item in $plan) {
  if (-not $PSCmdlet.ShouldProcess($item.destination, "Install $($item.component) $($release.version)")) { continue }
  if ($item.component -eq 'DSH') {
    $backup = Join-Path $item.destination ('.plugin-manager\dsh-code-bridge-backups\' + $stamp)
    $store = Join-Path $item.destination '.plugin-manager\dsh-code-bridge-archives'
    Assert-Unlinked $backup; Assert-Unlinked $store
    New-Item -ItemType Directory -Force -Path $backup,$store | Out-Null
    foreach ($name in @('package.json','pnpm-lock.yaml','cordis.patch.yml','pnpm-workspace.yaml')) {
      $file = Join-Path $item.destination $name
      if (Test-Path -LiteralPath $file) { Copy-Item -LiteralPath $file -Destination $backup }
    }
    $stream = [IO.File]::OpenRead($item.archive)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $hash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
    finally { $stream.Dispose(); $sha.Dispose() }
    $stored = Join-Path $store "dsh-code-bridge-$hash.tgz"
    Copy-Item -LiteralPath $item.archive -Destination $stored -Force
    & $item.cli plugin --profile $Profile add ("file:" + $stored) --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw "DSH installation failed. Configuration backup: $backup" }
    Write-Output "INSTALLED DSH. Configuration backup: $backup"
  } elseif ($item.component -eq 'VSCode') {
    & $item.cli --install-extension $item.archive --force
    if ($LASTEXITCODE -ne 0) { throw 'VS Code installation failed.' }
    Write-Output 'INSTALLED VS Code.'
  } else {
    $plugins = [IO.Path]::GetFullPath((Join-Path $item.destination 'plugins'))
    $destination = [IO.Path]::GetFullPath((Join-Path $plugins 'ask-for-dsh'))
    $stage = [IO.Path]::GetFullPath((Join-Path $plugins ('.dsh-stage-' + $stamp)))
    $backupRoot = [IO.Path]::GetFullPath((Join-Path $item.destination ('dsh-code-bridge-backups\' + $stamp)))
    $backup = Join-Path $backupRoot 'ask-for-dsh'
    if ([IO.Path]::GetDirectoryName($destination) -ne $plugins -or [IO.Path]::GetDirectoryName($stage) -ne $plugins -or -not $backupRoot.StartsWith($item.destination + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected plugin installation path.' }
    Assert-Unlinked $plugins; Assert-Unlinked $destination; Assert-Unlinked $backupRoot
    New-Item -ItemType Directory -Force -Path $stage | Out-Null
    $movedOld = $false
    try {
      Expand-Archive -LiteralPath $item.archive -DestinationPath $stage
      if (Test-Path -LiteralPath $destination) {
        New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
        Move-Item -LiteralPath $destination -Destination $backup
        $movedOld = $true
      }
      Move-Item -LiteralPath (Join-Path $stage 'ask-for-dsh') -Destination $destination
    } catch {
      if ($movedOld -and -not (Test-Path -LiteralPath $destination)) { Move-Item -LiteralPath $backup -Destination $destination }
      throw
    } finally {
      if ((Test-Path -LiteralPath $stage) -and [IO.Path]::GetDirectoryName($stage) -eq $plugins) { Assert-Unlinked $stage; Remove-Item -LiteralPath $stage -Recurse -Force }
    }
    Write-Output "INSTALLED $($item.component): $destination"
    if ($movedOld) { Write-Output "Previous plugin: $backup" }
  }
}
if ($plan.Count -eq 0) { Write-Output 'No components selected or available.' }
elseif (-not $WhatIfPreference) { Write-Output 'Restart DSH and updated JetBrains IDEs after saving your work; reload VS Code if needed. No applications were closed.' }
