[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$NodePathFile = Join-Path $Root "node-path.txt"
$CodexCli = Join-Path $Root "node_modules\@openai\codex\bin\codex.js"

if (!(Test-Path -LiteralPath $NodePathFile -PathType Leaf)) {
  throw "Run this script from the installed Adaptive Translation Codex companion folder."
}
$NodePath = [System.IO.File]::ReadAllText($NodePathFile).Trim()
if (!(Test-Path -LiteralPath $NodePath -PathType Leaf) -or !(Test-Path -LiteralPath $CodexCli -PathType Leaf)) {
  throw "The installed Codex companion is incomplete."
}

$env:CODEX_HOME = Join-Path $env:LOCALAPPDATA "AdaptiveTranslation\Codex"
& $NodePath $CodexCli logout
if ($LASTEXITCODE -ne 0) {
  throw "Codex ChatGPT sign-out did not complete."
}
