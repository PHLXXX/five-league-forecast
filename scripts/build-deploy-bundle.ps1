param(
  [string]$OutputPath = (Join-Path (Split-Path -Parent $PSScriptRoot) "five-league-analyzer-render.zip")
)

$ErrorActionPreference = "Stop"

$AppDir = Split-Path -Parent $PSScriptRoot
$StageDir = Join-Path $env:TEMP ("five-league-analyzer-deploy-" + [guid]::NewGuid().ToString("N"))
$BundleApp = Join-Path $StageDir "app"

try {
  New-Item -ItemType Directory -Path $BundleApp -Force | Out-Null

  $Files = @(
    ".env.example",
    "Dockerfile",
    "package.json",
    "package-lock.json",
    "Procfile",
    "README.md",
    "render.yaml",
    "server.js"
  )
  foreach ($File in $Files) {
    $Source = Join-Path $AppDir $File
    if (-not (Test-Path -LiteralPath $Source)) {
      throw "Required deployment file is missing: $File"
    }
    Copy-Item -LiteralPath $Source -Destination (Join-Path $BundleApp $File) -Force
  }

  foreach ($Directory in @("public", "src")) {
    $Source = Join-Path $AppDir $Directory
    if (-not (Test-Path -LiteralPath $Source)) {
      throw "Required deployment directory is missing: $Directory"
    }
    Copy-Item -LiteralPath $Source -Destination (Join-Path $BundleApp $Directory) -Recurse -Force
  }

  $BundleData = Join-Path $BundleApp "data"
  New-Item -ItemType Directory -Path $BundleData -Force | Out-Null
  [System.IO.File]::WriteAllText(
    (Join-Path $BundleData "prediction-history.json"),
    '{"version":1,"updatedAt":"","predictions":{}}',
    [System.Text.UTF8Encoding]::new($false)
  )

  Remove-Item -LiteralPath $OutputPath -Force -ErrorAction SilentlyContinue
  Compress-Archive -Path (Join-Path $StageDir "app") -DestinationPath $OutputPath -CompressionLevel Optimal
  $RequiredBundleFiles = @(
    "app/package.json",
    "app/server.js",
    "app/public/index.html",
    "app/public/app.js",
    "app/public/styles.css",
    "app/src/competitions.js",
    "app/src/league-data-service.js",
    "app/src/league-backtest.js",
    "app/src/history-scope.js",
    "app/src/numbers.js",
    "app/data/prediction-history.json"
  )
  $Archive = [System.IO.Compression.ZipFile]::OpenRead($OutputPath)
  try {
    $ArchiveNames = @($Archive.Entries | ForEach-Object { $_.FullName.Replace("\", "/") })
    foreach ($Required in $RequiredBundleFiles) {
      if ($ArchiveNames -notcontains $Required) {
        throw "Deployment bundle validation failed, missing: $Required"
      }
    }
  } finally {
    $Archive.Dispose()
  }
  Write-Output "Created deployment bundle: $OutputPath"
} finally {
  Remove-Item -LiteralPath $StageDir -Recurse -Force -ErrorAction SilentlyContinue
}
