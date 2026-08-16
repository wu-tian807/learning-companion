param(
  [ValidateSet('cpu', 'vulkan')]
  [string]$Backend = 'vulkan',

  [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$llamaVersion = 'b10442'
$demoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$downloadDirectory = Join-Path $demoRoot ".downloads\hymt2-$llamaVersion"
$runtimeDirectory = Join-Path $demoRoot ".runtime\llama.cpp\$llamaVersion\$Backend"
$modelDirectory = Join-Path $demoRoot '.models\hymt2'
$model = @{
  Url = 'https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF/resolve/main/Hy-MT2-1.8B-Q4_K_M.gguf?download=true'
  File = 'Hy-MT2-1.8B-Q4_K_M.gguf'
  Sha256 = 'DC5F44FCF1FA496EE7AD725982C0C8C553A4DE00259B53AF84C4B89FB0C06699'
}
$runtimes = @{
  cpu = @{
    Url = "https://github.com/ggml-org/llama.cpp/releases/download/$llamaVersion/llama-$llamaVersion-bin-win-cpu-x64.zip"
    File = "llama-$llamaVersion-bin-win-cpu-x64.zip"
    Sha256 = '67A5DA01B254BE88294BDB477F481B71BB482B838E8D7DA013EEF8B20A0CFA24'
  }
  vulkan = @{
    Url = "https://github.com/ggml-org/llama.cpp/releases/download/$llamaVersion/llama-$llamaVersion-bin-win-vulkan-x64.zip"
    File = "llama-$llamaVersion-bin-win-vulkan-x64.zip"
    Sha256 = '5CD520D44276A9233C2F87CD2AEABBC26745EF92F92BBF43123FEED694AAB4B6'
  }
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

$runtime = $runtimes[$Backend]
$runtimeArchive = Join-Path $downloadDirectory $runtime.File
Get-VerifiedFile $runtime.Url $runtimeArchive $runtime.Sha256

$serverExecutable = Join-Path $runtimeDirectory 'llama-server.exe'
if ($Force -or -not (Test-Path -LiteralPath $serverExecutable)) {
  Assert-WithinDemo $runtimeDirectory
  if (Test-Path -LiteralPath $runtimeDirectory) {
    Remove-Item -LiteralPath $runtimeDirectory -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $runtimeDirectory | Out-Null
  Expand-Archive -LiteralPath $runtimeArchive -DestinationPath $runtimeDirectory -Force
}

if (-not (Test-Path -LiteralPath $serverExecutable)) {
  throw "llama-server.exe was not found after extracting $runtimeArchive"
}

$modelPath = Join-Path $modelDirectory $model.File
Get-VerifiedFile $model.Url $modelPath $model.Sha256

$manifest = [ordered]@{
  runtime = 'llama.cpp'
  version = $llamaVersion
  backend = $Backend
  modelId = 'tencent/Hy-MT2-1.8B-GGUF:Q4_K_M'
  executable = $serverExecutable
  model = $modelPath
  installedAt = [DateTimeOffset]::Now.ToString('o')
}
$manifestPath = Join-Path $runtimeDirectory 'hymt2.runtime.json'
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json), $utf8WithoutBom)

Write-Host "Ready: $serverExecutable"
Write-Host "Model: $modelPath"
Write-Host "Manifest: $manifestPath"
