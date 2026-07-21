param(
  [string]$Version = ""
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$ManifestPaths = @(
  (Join-Path $Root "manifest.json"),
  (Join-Path $Root "manifest.chrome.json"),
  (Join-Path $Root "manifest.firefox.json")
)
$Manifests = foreach ($path in $ManifestPaths) {
  Get-Content -Raw -LiteralPath $path | ConvertFrom-Json
}
$ManifestVersion = [string]$Manifests[0].version
foreach ($manifest in $Manifests) {
  if ([string]$manifest.name -ne "Adaptive Translation") {
    throw "Unexpected source manifest name: $($manifest.name)"
  }
  if ([string]$manifest.version -ne $ManifestVersion) {
    throw "Source manifest versions do not match."
  }
}
if ([string]::IsNullOrWhiteSpace($Version)) {
  $Version = $ManifestVersion
} elseif ($Version -ne $ManifestVersion) {
  throw "Requested source version $Version does not match manifest version $ManifestVersion."
}
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$DistDir = Join-Path $Root "dist"
$StageDir = Join-Path $DistDir "source-$Version-$Stamp"
$ZipPath = Join-Path $DistDir "adaptive-translation-source-$Version-$Stamp.zip"

if (Test-Path -LiteralPath $StageDir) {
  throw "Source stage already exists: $StageDir"
}

if (Test-Path -LiteralPath $ZipPath) {
  throw "Source archive already exists: $ZipPath"
}

New-Item -ItemType Directory -Path $DistDir -Force | Out-Null
New-Item -ItemType Directory -Path $StageDir | Out-Null

$files = @(
  "background.js",
  "LICENSE",
  "README.md",
  "README-zhcn.md",
  "manifest.json",
  "manifest.chrome.json",
  "manifest.firefox.json",
  "SOURCE_BUILD_INSTRUCTIONS.md"
)

$dirs = @(
  "content",
  "core",
  "docs",
  "icons",
  "ocr",
  "offscreen",
  "options",
  "pages",
  "pdf",
  "prompts",
  "providers",
  "tools",
  "vendor",
  "_locales"
)

foreach ($file in $files) {
  $source = Join-Path $Root $file
  if (!(Test-Path -LiteralPath $source)) {
    throw "Required file missing: $source"
  }
  Copy-Item -LiteralPath $source -Destination $StageDir
}

foreach ($dir in $dirs) {
  $source = Join-Path $Root $dir
  if (!(Test-Path -LiteralPath $source)) {
    throw "Required directory missing: $source"
  }
  Copy-Item -LiteralPath $source -Destination $StageDir -Recurse
}

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

Write-Host "AMO source archive created:"
Write-Host $ZipPath
Write-Host "Source staging folder:"
Write-Host $StageDir
