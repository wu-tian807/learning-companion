param(
  [string]$PythonExecutable = ""
)

$ErrorActionPreference = "Stop"
$demoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "runtime-env.ps1")
Set-VoiceBenchmarkRuntimeEnvironment -DemoRoot $demoRoot
$runtimeRoot = Join-Path $demoRoot ".runtime"
$venvRoot = Join-Path $runtimeRoot "python"
$venvPython = Join-Path $venvRoot "Scripts\python.exe"
$modelRoot = Join-Path $demoRoot ".models\VoxCPM1.5"
$referencePath = Join-Path $runtimeRoot "prompt_speaker.wav"
$referenceUrl = "https://raw.githubusercontent.com/OpenBMB/VoxCPM/ee8161e9e1b7b082cb5721a3a9980da4204401e6/examples/example.wav"
$referenceSha256 = "009638E7474AC4EB2CA5B23D28D9114C33377EB5C91E8D6F7000A0C36D6EAA8E"

function Resolve-Python {
  param([string]$ExplicitPath)

  if ($ExplicitPath) {
    $resolved = Resolve-Path -LiteralPath $ExplicitPath -ErrorAction Stop
    return $resolved.Path
  }

  $command = Get-Command python.exe -ErrorAction SilentlyContinue
  if ($command -and $command.Source -notlike "*\WindowsApps\*") {
    return $command.Source
  }

  $codexPython = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
  if (Test-Path -LiteralPath $codexPython) {
    return $codexPython
  }

  throw "Python 3.10-3.12 was not found. Pass -PythonExecutable with an absolute path."
}

function Get-Sha256 {
  param([Parameter(Mandatory = $true)][string]$Path)

  $stream = [System.IO.File]::OpenRead($Path)
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    return [System.BitConverter]::ToString($sha256.ComputeHash($stream)).Replace("-", "")
  }
  finally {
    $sha256.Dispose()
    $stream.Dispose()
  }
}

New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null

if (-not (Test-Path -LiteralPath $venvPython)) {
  $basePython = Resolve-Python -ExplicitPath $PythonExecutable
  Write-Host "Creating isolated Python environment..."
  & $basePython -m venv $venvRoot
}

Write-Host "Installing CUDA runtime dependencies..."
Invoke-Checked -FilePath $venvPython -Step "pip upgrade" -ArgumentList @(
  "-m", "pip", "install", "--upgrade", "pip"
)
Invoke-Checked -FilePath $venvPython -Step "PyTorch installation" -ArgumentList @(
  "-m", "pip", "install",
  "torch==2.8.0+cu128",
  "torchaudio==2.8.0+cu128",
  "--index-url", "https://download.pytorch.org/whl/cu128"
)
Invoke-Checked -FilePath $venvPython -Step "VoxCPM runtime installation" -ArgumentList @(
  "-m", "pip", "install",
  "voxcpm==2.0.3",
  "torchcodec==0.7.0",
  "transformers==4.57.6",
  "huggingface-hub==0.36.0",
  "pydantic==2.13.4",
  "datasets<4"
)

Write-Host "Downloading VoxCPM1.5 model files (about 1.95 GB)..."
Invoke-Checked -FilePath $venvPython -Step "VoxCPM1.5 model download" -ArgumentList @(
  (Join-Path $demoRoot "src\download_model.py"),
  "--repo", "openbmb/VoxCPM1.5",
  "--revision", "8cdc403854cda0e3af12252d27da038fda5982ac",
  "--output", $modelRoot
)

if (-not (Test-Path -LiteralPath $referencePath)) {
  Write-Host "Downloading the pinned official prompt voice with a known transcript..."
  Invoke-WebRequest -Uri $referenceUrl -OutFile $referencePath
}

$actualReferenceHash = Get-Sha256 -Path $referencePath
if ($actualReferenceHash -ne $referenceSha256) {
  throw "Reference audio SHA-256 mismatch. Expected $referenceSha256, received $actualReferenceHash."
}

Invoke-Checked -FilePath $venvPython -Step "CUDA runtime verification" -ArgumentList @(
  "-c", "import torch; from voxcpm import VoxCPM; print('torch:', torch.__version__); print('cuda:', torch.cuda.is_available()); print('gpu:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'none')"
)
Invoke-Checked -FilePath $venvPython -Step "VoxCPM dependency verification" -ArgumentList @(
  "-m", "pip", "check"
)
Write-Host "VoxCPM1.5 demo setup is ready."
