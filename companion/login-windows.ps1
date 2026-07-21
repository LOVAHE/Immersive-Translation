[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$NodePathFile = Join-Path $Root "node-path.txt"
$CodexCli = Join-Path $Root "node_modules\@openai\codex\bin\codex.js"

if (!(Test-Path -LiteralPath $NodePathFile -PathType Leaf)) {
  throw "Install the Adaptive Translation Codex companion before signing in."
}
$NodePath = [System.IO.File]::ReadAllText($NodePathFile).Trim()
if (!(Test-Path -LiteralPath $NodePath -PathType Leaf) -or !(Test-Path -LiteralPath $CodexCli -PathType Leaf)) {
  throw "The installed Codex companion is incomplete. Run the installer again."
}

$CodexHome = Join-Path $env:LOCALAPPDATA "AdaptiveTranslation\Codex"
New-Item -ItemType Directory -Path $CodexHome -Force | Out-Null
$env:CODEX_HOME = $CodexHome

Write-Host "Opening the Codex ChatGPT sign-in for Adaptive Translation."
& $NodePath $CodexCli login
if ($LASTEXITCODE -ne 0) {
  throw "Codex ChatGPT sign-in did not complete."
}
