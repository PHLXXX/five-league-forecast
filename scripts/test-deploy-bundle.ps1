param(
  [string]$BundlePath = (Join-Path (Split-Path -Parent $PSScriptRoot) "five-league-analyzer-render.zip")
)

$ErrorActionPreference = "Stop"

$AppDir = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath $BundlePath)) {
  throw "Deployment bundle was not found: $BundlePath"
}

  $ExtractDir = Join-Path $env:TEMP ("five-league-analyzer-bundle-test-" + [guid]::NewGuid().ToString("N"))
try {
  Expand-Archive -LiteralPath $BundlePath -DestinationPath $ExtractDir -Force
  $BundleApp = Join-Path $ExtractDir "app"
  $Required = @(
    "server.js",
    "package.json",
    "public\\index.html",
    "public\\app.js",
    "public\\styles.css",
    "src\\competitions.js",
    "src\\analysis-context.js",
    "src\\league-backtest.js",
    "src\\league-data-service.js",
    "src\\recommendation-consistency.js",
    "src\\history-scope.js",
    "src\\numbers.js",
    "src\\team-names.js"
  )

  foreach ($RelativePath in $Required) {
    $BundledFile = Join-Path $BundleApp $RelativePath
    if (-not (Test-Path -LiteralPath $BundledFile)) {
      throw "Bundle is missing app/$RelativePath"
    }
  }

  foreach ($RelativePath in $Required) {
    $SourceHash = (Get-FileHash -LiteralPath (Join-Path $AppDir $RelativePath) -Algorithm SHA256).Hash
    $BundleHash = (Get-FileHash -LiteralPath (Join-Path $BundleApp $RelativePath) -Algorithm SHA256).Hash
    if ($SourceHash -ne $BundleHash) {
      throw "Bundle is stale: app/$RelativePath does not match the current project source."
    }
  }

  $BundledHistory = Get-Content -LiteralPath (Join-Path $BundleApp "data\\prediction-history.json") -Raw | ConvertFrom-Json
  if (@($BundledHistory.predictions.PSObject.Properties).Count -ne 0) {
    throw "Deployment bundle must not include local or World Cup prediction history."
  }

  Write-Output "Deployment bundle is complete and matches the current project source."
} finally {
  Remove-Item -LiteralPath $ExtractDir -Recurse -Force -ErrorAction SilentlyContinue
}
