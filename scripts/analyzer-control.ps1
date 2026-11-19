param(
  [ValidateSet("status", "start", "open", "verify")]
  [string]$Action = "status"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = Resolve-Path (Join-Path $ScriptDir "..")
$Port = 5177
$BaseUrl = "http://127.0.0.1:$Port"
$HealthUrl = "$BaseUrl/api/health"
$OutLog = Join-Path $AppDir "server.out.log"
$ErrLog = Join-Path $AppDir "server.err.log"

function Get-HttpStatus {
  param([string]$Url, [int]$TimeoutSec = 8)
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec
    return [int]$response.StatusCode
  } catch {
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      return [int]$_.Exception.Response.StatusCode
    }
    return 0
  }
}

function Test-Healthy {
  return (Get-HttpStatus -Url $HealthUrl -TimeoutSec 3) -eq 200
}

function Get-PortOwner {
  Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
}

function Start-Analyzer {
  if (Test-Healthy) { return }

  $owner = Get-PortOwner
  if ($owner) {
    throw "Port $Port is occupied by process $($owner.OwningProcess), but $HealthUrl is not healthy."
  }

  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { throw "Node.js was not found in PATH." }

  if (-not (Test-Path (Join-Path $AppDir "node_modules"))) {
    Push-Location $AppDir
    try { npm install } finally { Pop-Location }
  }

  Start-Process `
    -FilePath $node.Source `
    -ArgumentList "server.js" `
    -WorkingDirectory $AppDir `
    -RedirectStandardOutput $OutLog `
    -RedirectStandardError $ErrLog `
    -WindowStyle Hidden | Out-Null

  $deadline = (Get-Date).AddSeconds(35)
  while ((Get-Date) -lt $deadline) {
    if (Test-Healthy) { return }
    Start-Sleep -Milliseconds 600
  }

  $tail = ""
  if (Test-Path $ErrLog) {
    $tail = (Get-Content $ErrLog -Tail 60 -ErrorAction SilentlyContinue) -join "`n"
  }
  throw "Analyzer startup timed out. Error log:`n$tail"
}

function Write-Status {
  $owner = Get-PortOwner
  $health = Get-HttpStatus $HealthUrl 3
  $homeStatus = Get-HttpStatus "$BaseUrl/" 3
  $appJs = Get-HttpStatus "$BaseUrl/app.js" 3
  [pscustomobject]@{
    AppDir = $AppDir.Path
    Port = $Port
    PortOwner = if ($owner) { $owner.OwningProcess } else { "" }
    Health = $health
    Home = $homeStatus
    AppJs = $appJs
    Url = "$BaseUrl/"
  } | Format-List
}

function Verify-Analyzer {
  Start-Analyzer
  $checks = [ordered]@{
    Home = "$BaseUrl/"
    AppJs = "$BaseUrl/app.js"
    Styles = "$BaseUrl/styles.css"
    Health = "$BaseUrl/api/health"
    Matches = "$BaseUrl/api/matches"
    History = "$BaseUrl/api/history-fast"
  }
  $failed = @()
  foreach ($name in $checks.Keys) {
    $code = Get-HttpStatus $checks[$name] 15
    [pscustomobject]@{ Check = $name; Status = $code; Url = $checks[$name] }
    if ($code -ne 200) { $failed += "$name=$code" }
  }
  if ($failed.Count) {
    throw "Verification failed: $($failed -join ', ')"
  }
}

switch ($Action) {
  "status" { Write-Status }
  "start" { Start-Analyzer; Write-Status }
  "open" { Start-Analyzer; Start-Process "$BaseUrl/"; Write-Status }
  "verify" { Verify-Analyzer }
}
