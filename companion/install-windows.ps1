[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Chrome", "Edge", "Firefox")]
  [string]$Browser,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$ExtensionId,

  [switch]$Login
)

$ErrorActionPreference = "Stop"
$HostName = "com.adaptive_translation.codex"
$SourceRoot = $PSScriptRoot
$Package = Get-Content -Raw -LiteralPath (Join-Path $SourceRoot "package.json") | ConvertFrom-Json
$InstallRoot = Join-Path $env:LOCALAPPDATA "AdaptiveTranslation\CodexCompanion\$($Package.version)"

if ($Browser -in @("Chrome", "Edge")) {
  if ($ExtensionId -notmatch '^[a-p]{32}$') {
    throw "Chrome and Edge extension IDs must contain exactly 32 letters from a through p."
  }
} elseif ($ExtensionId -notmatch '^[A-Za-z0-9@._-]{1,128}$') {
  throw "The Firefox extension ID is invalid."
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (!$nodeCommand) {
  throw "Node.js 18 or later is required."
}
$nodeVersion = & $nodeCommand.Source -p "process.versions.node"
if ($LASTEXITCODE -ne 0 -or [int]($nodeVersion -split '\.')[0] -lt 18) {
  throw "Node.js 18 or later is required."
}

$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
$npmPath = $null
if (!$npmCommand) {
  $npmCandidate = Join-Path (Split-Path -Parent $nodeCommand.Source) "npm.cmd"
  if (Test-Path -LiteralPath $npmCandidate -PathType Leaf) {
    $npmPath = $npmCandidate
  }
} else {
  $npmPath = $npmCommand.Source
}
if (!$npmPath) {
  throw "npm is required to install the local Codex SDK dependency."
}
$framework64Compiler = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$frameworkCompiler = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe"
if (Test-Path -LiteralPath $framework64Compiler -PathType Leaf) {
  $csharpCompiler = $framework64Compiler
} elseif (Test-Path -LiteralPath $frameworkCompiler -PathType Leaf) {
  $csharpCompiler = $frameworkCompiler
} else {
  throw "The Windows .NET Framework C# compiler is required to build the native launcher."
}

New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $InstallRoot "src") -Force | Out-Null
if ([System.IO.Path]::GetFullPath($SourceRoot) -ne [System.IO.Path]::GetFullPath($InstallRoot)) {
  $installFiles = @(
    "host.mjs",
    "install-windows.ps1",
    "login-windows.ps1",
    "logout-windows.ps1",
    "NativeHostLauncher.cs",
    "package.json",
    "package-lock.json",
    "README.md",
    "uninstall-windows.ps1"
  )
  foreach ($file in $installFiles) {
    Copy-Item -LiteralPath (Join-Path $SourceRoot $file) -Destination (Join-Path $InstallRoot $file) -Force
  }
  Get-ChildItem -LiteralPath (Join-Path $SourceRoot "src") -File | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $InstallRoot "src\$($_.Name)") -Force
  }
}
$Root = $InstallRoot

Push-Location $Root
try {
  & $npmPath ci --omit=dev --ignore-scripts --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) {
    throw "The Codex SDK dependency installation failed."
  }
} finally {
  Pop-Location
}

$binDirectory = Join-Path $Root "bin"
New-Item -ItemType Directory -Path $binDirectory -Force | Out-Null
$launcherPath = Join-Path $binDirectory "adaptive_translation_codex_host.exe"
$launcherSourcePath = Join-Path $Root "NativeHostLauncher.cs"
$launcherNeedsBuild = !(Test-Path -LiteralPath $launcherPath -PathType Leaf)
if (!$launcherNeedsBuild) {
  $launcherNeedsBuild =
    (Get-Item -LiteralPath $launcherSourcePath).LastWriteTimeUtc -gt
    (Get-Item -LiteralPath $launcherPath).LastWriteTimeUtc
}
if ($launcherNeedsBuild) {
  & $csharpCompiler /nologo /target:exe "/out:$launcherPath" $launcherSourcePath
  if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $launcherPath -PathType Leaf)) {
    throw "The native launcher build failed."
  }
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText(
  (Join-Path $Root "node-path.txt"),
  $nodeCommand.Source,
  $utf8NoBom
)

$browserKey = $Browser.ToLowerInvariant()
$manifestPath = Join-Path $Root "native-host-manifest.$browserKey.json"
if ($Browser -eq "Firefox") {
  $manifest = [ordered]@{
    name = $HostName
    description = "Adaptive Translation Codex companion"
    path = $launcherPath
    type = "stdio"
    allowed_extensions = @($ExtensionId)
  }
  $registryPath = "HKCU:\Software\Mozilla\NativeMessagingHosts\$HostName"
} else {
  $manifest = [ordered]@{
    name = $HostName
    description = "Adaptive Translation Codex companion"
    path = $launcherPath
    type = "stdio"
    allowed_origins = @("chrome-extension://$ExtensionId/")
  }
  if ($Browser -eq "Edge") {
    $registryPath = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName"
  } else {
    $registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"
  }
}

$manifestJson = $manifest | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($manifestPath, $manifestJson, $utf8NoBom)
New-Item -Path $registryPath -Force | Out-Null
Set-Item -Path $registryPath -Value $manifestPath

Write-Host "Registered $HostName for $Browser."
Write-Host "Installed companion files: $InstallRoot"
if ($Login) {
  & (Join-Path $Root "login-windows.ps1")
  if ($LASTEXITCODE -ne 0) {
    throw "Codex ChatGPT sign-in did not complete."
  }
}
Write-Host "Reload Adaptive Translation before testing the Codex provider."
