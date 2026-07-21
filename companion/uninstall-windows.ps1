[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Chrome", "Edge", "Firefox")]
  [string]$Browser,

  [switch]$Logout
)

$ErrorActionPreference = "Stop"

switch ($Browser) {
  "Chrome" {
    if (Test-Path -LiteralPath "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.adaptive_translation.codex") {
      Remove-Item -LiteralPath "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.adaptive_translation.codex"
    }
  }
  "Edge" {
    if (Test-Path -LiteralPath "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.adaptive_translation.codex") {
      Remove-Item -LiteralPath "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.adaptive_translation.codex"
    }
  }
  "Firefox" {
    if (Test-Path -LiteralPath "HKCU:\Software\Mozilla\NativeMessagingHosts\com.adaptive_translation.codex") {
      Remove-Item -LiteralPath "HKCU:\Software\Mozilla\NativeMessagingHosts\com.adaptive_translation.codex"
    }
  }
}

if ($Logout) {
  & (Join-Path $PSScriptRoot "logout-windows.ps1")
}

Write-Host "Unregistered com.adaptive_translation.codex for $Browser."
Write-Host "Installed files and the isolated Codex profile were left unchanged."
