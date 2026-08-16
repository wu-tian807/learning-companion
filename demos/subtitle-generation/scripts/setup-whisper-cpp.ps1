param(
  [ValidateSet('cpu', 'cuda')]
  [string]$Backend = 'cpu',

  [ValidateSet('base', 'small-q5_1', 'large-v3-turbo-q5_0')]
  [string]$Model,

  [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$version = 'v1.9.2'
$demoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$downloadDirectory = Join-Path $demoRoot '.downloads'
$runtimeDirectory = Join-Path $demoRoot ".runtime\whisper.cpp\$version\$Backend"
$modelDirectory = Join-Path $demoRoot '.models'

$runtimePackages = @{
  cpu = @{
    Url = "https://github.com/ggml-org/whisper.cpp/releases/download/$version/whisper-bin-x64.zip"
    File = "whisper-$version-cpu-x64.zip"
    Sha256 = '49DCC16DE826F20BD53D44F947A1AE49DFA81F86CAD67A64D80820CB192D674A'
  }
  cuda = @{
    Url = "https://github.com/ggml-org/whisper.cpp/releases/download/$version/whisper-cublas-12.4.0-bin-x64.zip"
    File = "whisper-$version-cublas-12.4.0-x64.zip"
    Sha256 = '443110DDAAD70D4290AB2E77179E31CF712035BBC4FAD56BB4519A90C917B39C'
  }
}

$models = @{
  base = @{
    Url = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin'
    File = 'ggml-base.bin'
    Sha1 = '465707469FF3A37A2B9B8D8F89F2F99DE7299DAC'
  }
  'small-q5_1' = @{
    Url = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin'
    File = 'ggml-small-q5_1.bin'
    Sha1 = '6FE57DDCFDD1C6B07CDCC73AAF620810CE5FC771'
  }
  'large-v3-turbo-q5_0' = @{
    Url = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin'
    File = 'ggml-large-v3-turbo-q5_0.bin'
    Sha1 = 'E050F7970618A659205450AD97EB95A18D69C9EE'
  }
}

$vadModel = @{
  Url = 'https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin'
  File = 'ggml-silero-v6.2.0.bin'
  Sha256 = '2AA269B785EEB53A82983A20501DDF7C1D9C48E33AB63A41391AC6C9F7FB6987'
}

if ([string]::IsNullOrWhiteSpace($Model)) {
  $Model = if ($Backend -eq 'cuda') { 'large-v3-turbo-q5_0' } else { 'base' }
}

function Assert-WithinDemo([string]$Path) {
  $resolved = [System.IO.Path]::GetFullPath($Path)
  $prefix = $demoRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify a path outside the demo: $resolved"
  }
}

function Get-VerifiedFile(
  [string]$Url,
  [string]$Destination,
  [ValidateSet('SHA1', 'SHA256')][string]$Algorithm,
  [string]$ExpectedHash
) {
  Assert-WithinDemo $Destination
  if (Test-Path -LiteralPath $Destination) {
    $existingHash = (Get-FileHash -LiteralPath $Destination -Algorithm $Algorithm).Hash
    if ($existingHash -eq $ExpectedHash) {
      Write-Host "Verified cached download: $Destination"
      return
    }
    Remove-Item -LiteralPath $Destination -Force
  }

  Write-Host "Downloading: $Url"
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if ($null -ne $curl) {
    & $curl.Source -L --fail --retry 3 --retry-delay 2 --output $Destination $Url
    if ($LASTEXITCODE -ne 0) {
      throw "Download failed with exit code ${LASTEXITCODE}: $Url"
    }
  } else {
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Destination
  }

  $actualHash = (Get-FileHash -LiteralPath $Destination -Algorithm $Algorithm).Hash
  if ($actualHash -ne $ExpectedHash) {
    Remove-Item -LiteralPath $Destination -Force
    throw "$Algorithm mismatch for $Url. Expected $ExpectedHash, received $actualHash."
  }
}

New-Item -ItemType Directory -Force -Path $downloadDirectory, $modelDirectory | Out-Null

$runtimePackage = $runtimePackages[$Backend]
$runtimeArchive = Join-Path $downloadDirectory $runtimePackage.File
Get-VerifiedFile $runtimePackage.Url $runtimeArchive 'SHA256' $runtimePackage.Sha256

$existingExecutable = Get-ChildItem -LiteralPath $runtimeDirectory -Recurse -Filter 'whisper-cli.exe' -File -ErrorAction SilentlyContinue | Select-Object -First 1
if ($Force -or $null -eq $existingExecutable) {
  Assert-WithinDemo $runtimeDirectory
  if (Test-Path -LiteralPath $runtimeDirectory) {
    Remove-Item -LiteralPath $runtimeDirectory -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $runtimeDirectory | Out-Null
  Expand-Archive -LiteralPath $runtimeArchive -DestinationPath $runtimeDirectory -Force
}

$executable = Get-ChildItem -LiteralPath $runtimeDirectory -Recurse -Filter 'whisper-cli.exe' -File | Select-Object -First 1
if ($null -eq $executable) {
  throw "whisper-cli.exe was not found after extracting $runtimeArchive"
}

$modelDefinition = $models[$Model]
$modelPath = Join-Path $modelDirectory $modelDefinition.File
Get-VerifiedFile $modelDefinition.Url $modelPath 'SHA1' $modelDefinition.Sha1

$vadPath = Join-Path $modelDirectory $vadModel.File
Get-VerifiedFile $vadModel.Url $vadPath 'SHA256' $vadModel.Sha256

$manifest = @{
  engine = 'whisper.cpp'
  version = $version
  backend = $Backend
  executable = $executable.FullName
  model = $modelPath
  vadModel = $vadPath
  installedAt = [DateTimeOffset]::Now.ToString('o')
}
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeDirectory 'runtime.json') -Encoding UTF8

Write-Host "Ready: $($executable.FullName)"
Write-Host "Model: $modelPath"
Write-Host "VAD: $vadPath"
