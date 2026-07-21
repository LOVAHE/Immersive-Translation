param(
  [string]$NodePath = ""
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$ExpectedName = "Adaptive Translation"
$ManifestPaths = @(
  (Join-Path $Root "manifest.json"),
  (Join-Path $Root "manifest.chrome.json"),
  (Join-Path $Root "manifest.firefox.json")
)

if ([string]::IsNullOrWhiteSpace($NodePath)) {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if (!$nodeCommand) {
    throw "Node.js was not found. Pass its executable path with -NodePath."
  }
  $NodePath = $nodeCommand.Source
}
if (!(Test-Path -LiteralPath $NodePath -PathType Leaf)) {
  throw "Node.js executable not found: $NodePath"
}

$manifests = foreach ($path in $ManifestPaths) {
  Get-Content -Raw -LiteralPath $path | ConvertFrom-Json
}
$expectedVersion = [string]$manifests[0].version
for ($i = 0; $i -lt $manifests.Count; $i++) {
  if ([string]$manifests[$i].name -ne $ExpectedName) {
    throw "Manifest name mismatch in $($ManifestPaths[$i]): $($manifests[$i].name)"
  }
  if ([string]$manifests[$i].version -ne $expectedVersion) {
    throw "Manifest version mismatch in $($ManifestPaths[$i]): $($manifests[$i].version) != $expectedVersion"
  }
}
Write-Host "Manifest identity: $ExpectedName $expectedVersion"

$jsonFiles = Get-ChildItem -LiteralPath $Root -Recurse -File -Filter "*.json" | Where-Object {
  $_.FullName -notlike "*\dist\*" -and $_.FullName -notlike "*\vendor\*"
}
Add-Type -AssemblyName System.Web.Extensions
$jsonSerializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$jsonSerializer.MaxJsonLength = [int]::MaxValue
foreach ($file in $jsonFiles) {
  try {
    $jsonSerializer.DeserializeObject([System.IO.File]::ReadAllText($file.FullName)) | Out-Null
  } catch {
    throw "JSON parse failed for $($file.FullName): $($_.Exception.Message)"
  }
}
Write-Host "JSON parsed: $($jsonFiles.Count)"

$powershellFiles = Get-ChildItem -LiteralPath $Root -Recurse -File -Filter "*.ps1" | Where-Object {
  $_.FullName -notlike "*\dist\*"
}
foreach ($file in $powershellFiles) {
  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile(
    $file.FullName,
    [ref]$tokens,
    [ref]$errors
  ) | Out-Null
  if ($errors.Count) {
    throw "PowerShell parse failed for $($file.FullName): $($errors[0].Message)"
  }
}
Write-Host "PowerShell parsed: $($powershellFiles.Count)"

$javascriptFiles = Get-ChildItem -LiteralPath $Root -Recurse -File | Where-Object {
  $_.Extension -in @(".js", ".mjs") -and
  $_.FullName -notlike "*\dist\*" -and
  $_.FullName -notlike "*\vendor\*" -and
  $_.Name -ne "tailwindcss-browser.js"
}
foreach ($file in $javascriptFiles) {
  & $NodePath --check $file.FullName
  if ($LASTEXITCODE -ne 0) {
    throw "JavaScript syntax check failed: $($file.FullName)"
  }
}
Write-Host "JavaScript checked: $($javascriptFiles.Count)"

$testFiles = Get-ChildItem -LiteralPath (Join-Path $Root "tools") -File -Filter "*.test.mjs"
foreach ($file in $testFiles) {
  & $NodePath --test $file.FullName
  if ($LASTEXITCODE -ne 0) {
    throw "Test failed: $($file.FullName)"
  }
}
Write-Host "Test files passed: $($testFiles.Count)"
Write-Host "Verification passed."
