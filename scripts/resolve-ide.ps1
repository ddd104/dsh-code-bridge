[CmdletBinding()]
param([Parameter(Mandatory)][ValidateSet('rider','android-studio')][string]$Ide, [string]$IdeHome, [switch]$AsJson)
$ErrorActionPreference = 'Stop'
$minimum = if ($Ide -eq 'rider') { 261 } else { 253 }
$expected = if ($Ide -eq 'rider') { 'RD' } else { 'AI' }
$candidates = @()
if ($IdeHome) { $candidates += $IdeHome }
elseif ($Ide -eq 'rider') {
  $candidates += $env:RIDER_HOME
  foreach ($root in @((Join-Path $env:ProgramFiles 'JetBrains'), (Join-Path $env:LOCALAPPDATA 'Programs'))) {
    $candidates += @(Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue | Where-Object Name -match 'Rider' | ForEach-Object FullName)
  }
} else {
  $candidates += $env:ANDROID_STUDIO_HOME
  foreach ($key in @('HKLM:\SOFTWARE\Android Studio','HKCU:\SOFTWARE\Android Studio')) { $candidates += (Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue).Path }
  $candidates += Join-Path $env:ProgramFiles 'Android\Android Studio'
}
if (-not $IdeHome) {
  $processName = if ($Ide -eq 'rider') { 'rider64.exe' } else { 'studio64.exe' }
  foreach ($process in @(Get-CimInstance Win32_Process -Filter "Name = '$processName'" -ErrorAction SilentlyContinue)) {
    if ($process.ExecutablePath) { $candidates += Split-Path -Parent (Split-Path -Parent $process.ExecutablePath) }
  }
}
$result = $null
foreach ($candidate in ($candidates | Where-Object { $_ } | Select-Object -Unique)) {
  $info = Join-Path $candidate 'product-info.json'
  if (-not (Test-Path -LiteralPath $info)) { continue }
  $product = Get-Content -LiteralPath $info -Raw | ConvertFrom-Json
  if ($product.productCode -ne $expected -or $product.buildNumber -notmatch '^(?:[A-Z]+-)?(\d+)\.') { continue }
  $compatible = [int]$Matches[1] -ge $minimum
  $found = [pscustomobject]@{ home=(Resolve-Path -LiteralPath $candidate).Path; compatible=$compatible; build=$product.buildNumber; minimum=$minimum; reason="Requires $Ide platform $minimum or newer; found $($product.buildNumber)." }
  if ($compatible) { $found.reason = ''; $result = $found; break }
  if (-not $result) { $result = $found }
}
if (-not $result) { $result = [pscustomobject]@{ home=$null; compatible=$false; build=$null; minimum=$minimum; reason="No compatible $Ide SDK found. Set RIDER_HOME / ANDROID_STUDIO_HOME." } }
if ($AsJson) { $result | ConvertTo-Json -Compress } else { $result }
