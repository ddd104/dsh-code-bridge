[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet('rider','android-studio')][string]$Ide,
  [string]$IdeHome
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$sdk = & (Join-Path $PSScriptRoot 'resolve-ide.ps1') -Ide $Ide -IdeHome $IdeHome
if (-not $sdk.compatible) { throw $sdk.reason }
$IdeHome = $sdk.home
$product = Get-Content -LiteralPath (Join-Path $IdeHome 'product-info.json') -Raw | ConvertFrom-Json
$descriptor = Join-Path $repo ("editors\$Ide\src\main\resources\META-INF\plugin.xml")
[xml]$manifest = Get-Content -LiteralPath $descriptor -Raw -Encoding UTF8
$version = $manifest.'idea-plugin'.version
$minimum = [int]$manifest.'idea-plugin'.'idea-version'.'since-build'
if ([int](($product.buildNumber -replace '^[A-Z]+-','').Split('.')[0]) -lt $minimum) { throw "SDK is older than minimum build $minimum." }
$out = Join-Path $repo 'dist\code-editors'
$classes = [IO.Path]::GetFullPath((Join-Path $out "$Ide-classes"))
$package = Join-Path $out "$Ide-package\ask-for-dsh"
$javaCompiler = Join-Path $IdeHome 'jbr\bin\javac.exe'
$jarTool = Join-Path $IdeHome 'jbr\bin\jar.exe'
if (-not (Test-Path -LiteralPath $javaCompiler)) { $javaCompiler = (Get-Command javac.exe -ErrorAction Stop).Source }
if (-not (Test-Path -LiteralPath $jarTool)) { $jarTool = (Get-Command jar.exe -ErrorAction Stop).Source }
# Clear only this IDE's verified build output so removed classes cannot ship again.
if ([IO.Path]::GetDirectoryName($classes) -ne [IO.Path]::GetFullPath($out)) { throw 'Unexpected classes directory.' }
if (Test-Path -LiteralPath $classes) {
  if ((Get-Item -LiteralPath $classes).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing a linked classes directory.' }
  Remove-Item -LiteralPath $classes -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $classes, (Join-Path $package 'lib'), (Join-Path $classes 'META-INF') | Out-Null
$sources = @(Get-ChildItem -LiteralPath (Join-Path $repo 'editors\jetbrains\src\main\java\dev\dsh') -Filter '*.java' -File | ForEach-Object FullName)
& $javaCompiler -encoding UTF-8 --release 21 -cp (Join-Path $IdeHome 'lib\*') -d $classes @sources
if ($LASTEXITCODE -ne 0) { throw "$Ide compilation failed." }
Copy-Item -LiteralPath $descriptor -Destination (Join-Path $classes 'META-INF\plugin.xml') -Force
& $jarTool --create --file (Join-Path $package 'lib\ask-for-dsh.jar') -C $classes .
if ($LASTEXITCODE -ne 0) { throw "$Ide JAR packaging failed." }
Copy-Item -LiteralPath (Join-Path $repo 'LICENSE') -Destination $package -Force
Copy-Item -LiteralPath (Join-Path $repo 'docs\code-editors.md') -Destination (Join-Path $package 'README.md') -Force
$archive = Join-Path $out "ask-for-dsh-$Ide-$version.zip"
Compress-Archive -LiteralPath $package -DestinationPath $archive -Force
Write-Output "$Ide plugin: $archive (SDK $($product.buildNumber))"
