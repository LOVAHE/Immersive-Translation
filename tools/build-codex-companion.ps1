param(
  [string]$Version = "",
  [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$CompanionRoot = Join-Path $Root "companion"
$Package = Get-Content -Raw -LiteralPath (Join-Path $CompanionRoot "package.json") | ConvertFrom-Json
$PackageVersion = [string]$Package.version
if ([string]::IsNullOrWhiteSpace($Version)) {
  $Version = $PackageVersion
} elseif ($Version -ne $PackageVersion) {
  throw "Requested companion version $Version does not match package version $PackageVersion."
}

Add-Type -AssemblyName System.Web.Extensions
$Serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$Serializer.MaxJsonLength = [int]::MaxValue
$Lock = $Serializer.DeserializeObject(
  [System.IO.File]::ReadAllText((Join-Path $CompanionRoot "package-lock.json"))
)
$LockRoot = $Lock["packages"][""]
if ([string]$Lock["version"] -ne $Version) {
  throw "Companion package-lock version does not match package.json."
}
if ([string]$LockRoot["dependencies"]["@openai/codex-sdk"] -ne [string]$Package.dependencies."@openai/codex-sdk") {
  throw "Companion package-lock does not pin the configured Codex SDK version."
}
if ($ValidateOnly) {
  Write-Host "Codex companion metadata is valid."
  return
}

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$DistDir = Join-Path $Root "dist"
$StageDir = Join-Path $DistDir "codex-companion-$Version-$Stamp"
$ZipPath = Join-Path $DistDir "adaptive-translation-codex-companion-$Version-$Stamp.zip"
$ChecksumPath = "$ZipPath.sha256"
foreach ($path in @($StageDir, $ZipPath, $ChecksumPath)) {
  if (Test-Path -LiteralPath $path) {
    throw "Build output already exists: $path"
  }
}

New-Item -ItemType Directory -Path $DistDir -Force | Out-Null
New-Item -ItemType Directory -Path $StageDir | Out-Null

$files = @(
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
foreach ($file in $files) {
  Copy-Item -LiteralPath (Join-Path $CompanionRoot $file) -Destination (Join-Path $StageDir $file)
}
Copy-Item -LiteralPath (Join-Path $Root "LICENSE") -Destination (Join-Path $StageDir "LICENSE")
Copy-Item -LiteralPath (Join-Path $CompanionRoot "src") -Destination (Join-Path $StageDir "src") -Recurse

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$basePath = (Resolve-Path -LiteralPath $StageDir).Path.TrimEnd('\') + '\'
$archive = [System.IO.Compression.ZipFile]::Open($ZipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem -LiteralPath $StageDir -Recurse -File | ForEach-Object {
    $entryName = $_.FullName.Substring($basePath.Length).Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $archive,
      $_.FullName,
      $entryName,
      [System.IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null
  }
} finally {
  $archive.Dispose()
}

$hash = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText(
  $ChecksumPath,
  "$hash  $([System.IO.Path]::GetFileName($ZipPath))`n",
  $utf8NoBom
)

Write-Host "Codex companion package created:"
Write-Host $ZipPath
Write-Host "SHA-256:"
Write-Host $ChecksumPath
