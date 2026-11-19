param(
  [string]$DestinationRoot = "E:\喷火龙五大联赛分析工具"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$BuildDir = Join-Path $ProjectRoot "dist-desktop"
$SourceDocs = Join-Path $ProjectRoot "docs\desktop"
$InstallDir = Join-Path $DestinationRoot "安装包"
$DocsDir = Join-Path $DestinationRoot "文档"

if (-not (Test-Path $BuildDir)) {
  throw "未找到桌面构建目录：$BuildDir"
}

New-Item -ItemType Directory -Force -Path $InstallDir, $DocsDir | Out-Null

$package = Get-Content -LiteralPath (Join-Path $ProjectRoot "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$expectedNames = @(
  "喷火龙五大联赛分析平台-安装版-$($package.version)-x64.exe",
  "喷火龙五大联赛分析平台-便携版-$($package.version)-x64.exe"
)
$artifacts = foreach ($name in $expectedNames) {
  $artifactPath = Join-Path $BuildDir $name
  if (-not (Test-Path -LiteralPath $artifactPath)) {
    throw "缺少当前版本构建产物：$artifactPath"
  }
  Get-Item -LiteralPath $artifactPath
}

$rootFull = [IO.Path]::GetFullPath($DestinationRoot).TrimEnd("\")
$installFull = [IO.Path]::GetFullPath($InstallDir)
if (-not $installFull.StartsWith($rootFull + "\", [StringComparison]::OrdinalIgnoreCase)) {
  throw "安装包目录不在发布根目录内，已停止清理旧文件。"
}
Get-ChildItem -LiteralPath $InstallDir -File -Filter "*.exe" | Remove-Item -Force

foreach ($artifact in $artifacts) {
  Copy-Item -LiteralPath $artifact.FullName -Destination (Join-Path $InstallDir $artifact.Name) -Force
}

$portableTarget = Join-Path $InstallDir $expectedNames[1]
$shell = New-Object -ComObject WScript.Shell
$shortcutPaths = @(
  (Join-Path ([Environment]::GetFolderPath("Desktop")) "喷火龙五大联赛分析平台.lnk"),
  (Join-Path $DestinationRoot "启动喷火龙五大联赛分析平台.lnk")
)
foreach ($shortcutPath in $shortcutPaths) {
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $portableTarget
  $shortcut.WorkingDirectory = $InstallDir
  $shortcut.IconLocation = "$portableTarget,0"
  $shortcut.Description = "启动喷火龙五大联赛分析平台"
  $shortcut.Save()
}

Copy-Item -Path (Join-Path $SourceDocs "*") -Destination $DocsDir -Recurse -Force
Copy-Item -LiteralPath (Join-Path $ProjectRoot "docs\superpowers\specs\2026-07-21-local-desktop-app-design.md") -Destination $DocsDir -Force
Copy-Item -LiteralPath (Join-Path $ProjectRoot "docs\superpowers\plans\2026-07-21-local-desktop-app.md") -Destination $DocsDir -Force

$hashLines = Get-ChildItem -LiteralPath $InstallDir -File -Filter "*.exe" |
  Sort-Object Name |
  ForEach-Object {
    $hash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
    "$($hash.Hash)  $($_.Name)"
  }
$hashLines | Set-Content -LiteralPath (Join-Path $DestinationRoot "SHA256校验.txt") -Encoding UTF8

Write-Host "桌面软件已发布到：$DestinationRoot"
