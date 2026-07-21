param(
  [string]$Version = ""
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$ManifestSource = Join-Path $Root "manifest.firefox.json"
$SourceManifest = Get-Content -Raw -LiteralPath $ManifestSource | ConvertFrom-Json
$ManifestVersion = [string]$SourceManifest.version
if ([string]$SourceManifest.name -ne "Adaptive Translation") {
  throw "Unexpected Firefox manifest name: $($SourceManifest.name)"
}
if ([string]::IsNullOrWhiteSpace($Version)) {
  $Version = $ManifestVersion
} elseif ($Version -ne $ManifestVersion) {
  throw "Requested Firefox version $Version does not match manifest version $ManifestVersion."
}
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$DistDir = Join-Path $Root "dist"
$StageDir = Join-Path $DistDir "firefox-$Version-$Stamp"
$ZipPath = Join-Path $DistDir "adaptive-translation-firefox-$Version-$Stamp.zip"
$XpiPath = Join-Path $DistDir "adaptive-translation-firefox-$Version-$Stamp.xpi"

if (Test-Path -LiteralPath $StageDir) {
  throw "Build stage already exists: $StageDir"
}

foreach ($path in @($ZipPath, $XpiPath)) {
  if (Test-Path -LiteralPath $path) {
    throw "Build artifact already exists: $path"
  }
}

New-Item -ItemType Directory -Path $DistDir -Force | Out-Null
New-Item -ItemType Directory -Path $StageDir | Out-Null

$files = @(
  "background.js",
  "LICENSE",
  "README.md"
)

$dirs = @(
  "content",
  "core",
  "icons",
  "ocr",
  "options",
  "pages",
  "pdf",
  "prompts",
  "providers",
  "vendor",
  "_locales"
)

$excludePackageFiles = @(
  "options/tailwindcss-browser.js"
)

function Copy-DirectoryFiltered($SourceDir, $TargetDir, $RootDir, $ExcludedRelativePaths) {
  New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
  Get-ChildItem -LiteralPath $SourceDir -Recurse -Directory | ForEach-Object {
    $relativeDir = $_.FullName.Substring($RootDir.Length).TrimStart('\').Replace('\', '/')
    New-Item -ItemType Directory -Path (Join-Path $TargetDir $relativeDir) -Force | Out-Null
  }
  Get-ChildItem -LiteralPath $SourceDir -Recurse -File | ForEach-Object {
    $relativeFile = $_.FullName.Substring($RootDir.Length).TrimStart('\').Replace('\', '/')
    if ($ExcludedRelativePaths -contains $relativeFile) {
      return
    }
    $destination = Join-Path $TargetDir $relativeFile
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $_.FullName -Destination $destination
  }
}

Copy-Item -LiteralPath (Join-Path $Root "manifest.firefox.json") -Destination (Join-Path $StageDir "manifest.json")

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
  Copy-DirectoryFiltered $source $StageDir ($Root.TrimEnd('\') + '\') $excludePackageFiles
}

$manifestPath = Join-Path $StageDir "manifest.json"
$manifest = Get-Content -Raw $manifestPath | ConvertFrom-Json
if ($manifest.manifest_version -ne 3) {
  throw "Firefox package manifest must be Manifest V3."
}
if ($manifest.background.service_worker) {
  throw "Firefox package should use background.scripts instead of background.service_worker."
}

$manifestText = Get-Content -Raw $manifestPath
foreach ($blocked in @('"offscreen"', "service_worker")) {
  if ($manifestText.Contains($blocked)) {
    throw "Firefox package manifest contains blocked or unsupported field: $blocked"
  }
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
Copy-Item -LiteralPath $ZipPath -Destination $XpiPath

Write-Host "Firefox AMO package created:"
Write-Host $XpiPath
Write-Host "Zip copy:"
Write-Host $ZipPath
Write-Host "Staging folder:"
Write-Host $StageDir
