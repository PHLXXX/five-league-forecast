$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Push-Location $ProjectRoot
try {
  npm.cmd install
  npm.cmd run icon:build
  npm.cmd test
  npm.cmd run check
  npm.cmd run desktop:dist
  powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "publish-desktop.ps1")
} finally {
  Pop-Location
}
