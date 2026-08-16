param(
  [ValidateSet('sensevoice', 'paraformer')]
  [string]$Model = 'sensevoice',

  [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$version = 'v0.1.9'
$demoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$downloadDirectory = Join-Path $demoRoot ".downloads\funasr-$version"
$runtimeDirectory = Join-Path $demoRoot ".runtime\funasr\$version\cpu-avx2"
$modelDirectory = Join-Path $demoRoot '.models\funasr'
$runtime = @{
  Url = "https://github.com/QwenAudio/SenseVoice/releases/download/runtime-llamacpp-$version/funasr-llamacpp-windows-x64-avx2.zip"
  File = "funasr-llamacpp-windows-x64-avx2-$version.zip"
  Sha256 = 'F2A1389658E6FB5F5F93C7BAD98B5CE100EB4811E0E3C39603E39466773B1B4C'
}
$models = @{
  sensevoice = @{
    Url = 'https://huggingface.co/FunAudioLLM/SenseVoiceSmall-GGUF/resolve/main/sensevoice-small-q8.gguf'
    File = 'sensevoice-small-q8.gguf'
    Executable = 'llama-funasr-sensevoice.exe'
    Sha256 = '4AE45C94422DE949B387E2E0FB10D7E14E4C42C69DB30C3444ECC7D4B844B7C5'
  }
  paraformer = @{
    Url = 'https://huggingface.co/FunAudioLLM/Paraformer-GGUF/resolve/main/paraformer-q8.gguf'
    File = 'paraformer-q8.gguf'
    Executable = 'llama-funasr-paraformer.exe'
    Sha256 = '42BF76EA1575A336AACA4C1B7C01A82B79113E6D04D0D6B799561BFCF07EE011'
  }
}
$vad = @{
  Url = 'https://huggingface.co/FunAudioLLM/fsmn-vad-GGUF/resolve/main/fsmn-vad.gguf'
  File = 'fsmn-vad.gguf'
  Sha256 = '1270F2559C495F4E7B6E739541151027D360761A3FDA43FC147034F5719F5479'
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
  [string]$ExpectedHash
) {
  Assert-WithinDemo $Destination
  if (Test-Path -LiteralPath $Destination) {
    $existingHash = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash
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

  $actualHash = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash
  if ($actualHash -ne $ExpectedHash) {
    Remove-Item -LiteralPath $Destination -Force
    throw "SHA256 mismatch for $Url. Expected $ExpectedHash, received $actualHash."
  }
}

New-Item -ItemType Directory -Force -Path $downloadDirectory, $modelDirectory | Out-Null

$runtimeArchive = Join-Path $downloadDirectory $runtime.File
Get-VerifiedFile $runtime.Url $runtimeArchive $runtime.Sha256
$modelDefinition = $models[$Model]
$modelExecutable = Join-Path $runtimeDirectory $modelDefinition.Executable
$vadExecutable = Join-Path $runtimeDirectory 'llama-funasr-vad.exe'
if ($Force -or -not (Test-Path -LiteralPath $modelExecutable) -or -not (Test-Path -LiteralPath $vadExecutable)) {
  Assert-WithinDemo $runtimeDirectory
  if (Test-Path -LiteralPath $runtimeDirectory) {
    Remove-Item -LiteralPath $runtimeDirectory -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $runtimeDirectory | Out-Null
  Expand-Archive -LiteralPath $runtimeArchive -DestinationPath $runtimeDirectory -Force
}

if (-not (Test-Path -LiteralPath $modelExecutable) -or -not (Test-Path -LiteralPath $vadExecutable)) {
  throw "FunASR/VAD executables were not found after extracting $runtimeArchive"
}

$modelPath = Join-Path $modelDirectory $modelDefinition.File
$vadPath = Join-Path $modelDirectory $vad.File
Get-VerifiedFile $modelDefinition.Url $modelPath $modelDefinition.Sha256
Get-VerifiedFile $vad.Url $vadPath $vad.Sha256

$manifest = [ordered]@{
  runtime = 'funasr-llama.cpp'
  version = $version
  backend = 'cpu-avx2'
  modelId = $Model
  executable = $modelExecutable
  vadExecutable = $vadExecutable
  model = $modelPath
  vadModel = $vadPath
  installedAt = [DateTimeOffset]::Now.ToString('o')
}
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeDirectory "$Model.runtime.json") -Encoding UTF8

Write-Host "Ready: $modelExecutable"
Write-Host "Model: $modelPath"
Write-Host "VAD: $vadPath"
