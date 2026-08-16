param(
  [switch]$ForceClips
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$demoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$manifestPath = Join-Path $demoRoot 'fixtures\youtube-benchmark.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$toolDirectory = Join-Path $demoRoot ".runtime\yt-dlp\$($manifest.ytDlp.version)"
$ytDlpPath = Join-Path $toolDirectory 'yt-dlp.exe'
$rawDirectory = Join-Path $demoRoot '.datasets\youtube\raw'
$clipDirectory = Join-Path $demoRoot '.datasets\youtube\clips'

function Assert-WithinDemo([string]$Path) {
  $resolved = [System.IO.Path]::GetFullPath($Path)
  $prefix = $demoRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify a path outside the demo: $resolved"
  }
}

New-Item -ItemType Directory -Force -Path $toolDirectory, $rawDirectory, $clipDirectory | Out-Null
Assert-WithinDemo $ytDlpPath

$requiresDownload = $true
if (Test-Path -LiteralPath $ytDlpPath) {
  $requiresDownload = (Get-FileHash -LiteralPath $ytDlpPath -Algorithm SHA256).Hash -ne $manifest.ytDlp.sha256
}
if ($requiresDownload) {
  if (Test-Path -LiteralPath $ytDlpPath) {
    Remove-Item -LiteralPath $ytDlpPath -Force
  }
  & curl.exe -L --fail --retry 3 --output $ytDlpPath $manifest.ytDlp.url
  if ($LASTEXITCODE -ne 0) { throw "yt-dlp download failed with exit code ${LASTEXITCODE}." }
}
$actualHash = (Get-FileHash -LiteralPath $ytDlpPath -Algorithm SHA256).Hash
if ($actualHash -ne $manifest.ytDlp.sha256) {
  throw "yt-dlp SHA-256 mismatch. Expected $($manifest.ytDlp.sha256), received $actualHash."
}

$nodePath = (Get-Command node -ErrorAction Stop).Source
$ffmpegPath = (Get-Command ffmpeg.exe -ErrorAction Stop).Source

foreach ($video in $manifest.videos) {
  $videoDirectory = Join-Path $rawDirectory $video.id
  New-Item -ItemType Directory -Force -Path $videoDirectory | Out-Null
  $outputTemplate = Join-Path $videoDirectory "$($video.id).%(ext)s"
  $audioPath = Join-Path $videoDirectory "$($video.id).m4a"
  $subtitlePath = Join-Path $videoDirectory "$($video.id).$($video.subtitleLanguage).vtt"

  if (-not (Test-Path -LiteralPath $subtitlePath)) {
    & $ytDlpPath --js-runtimes "node:$nodePath" --no-playlist --skip-download --write-subs --sub-langs $video.subtitleLanguage --sub-format vtt --write-info-json -o $outputTemplate $video.url
    if ($LASTEXITCODE -ne 0) { throw "Subtitle download failed for $($video.id)." }
  }
  if (-not (Test-Path -LiteralPath $audioPath)) {
    & $ytDlpPath --js-runtimes "node:$nodePath" --no-playlist -f $video.audioFormat --write-info-json -o $outputTemplate $video.url
    if ($LASTEXITCODE -ne 0) { throw "Audio download failed for $($video.id)." }
  }
  if (-not (Test-Path -LiteralPath $subtitlePath)) { throw "Reference subtitle is missing: $subtitlePath" }
  if (-not (Test-Path -LiteralPath $audioPath)) { throw "Audio is missing: $audioPath" }

  $videoClipDirectory = Join-Path $clipDirectory $video.id
  New-Item -ItemType Directory -Force -Path $videoClipDirectory | Out-Null
  foreach ($duration in $manifest.durationsSeconds) {
    $clipPath = Join-Path $videoClipDirectory "$($duration)s.m4a"
    if ((Test-Path -LiteralPath $clipPath) -and -not $ForceClips) {
      Write-Host "Clip already exists: $clipPath"
      continue
    }
    & $ffmpegPath -hide_banner -loglevel error -y -i $audioPath -map 0:a:0 -t $duration -c copy -movflags +faststart $clipPath
    if ($LASTEXITCODE -ne 0) { throw "Failed to create $duration second clip for $($video.id)." }
    Write-Host "Created clip: $clipPath"
  }
}

Write-Host "YouTube benchmark dataset is ready: $clipDirectory"
