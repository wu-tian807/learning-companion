param(
  [string]$PythonExecutable = ""
)

$ErrorActionPreference = "Stop"
$demoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "runtime-env.ps1")
Set-VoiceBenchmarkRuntimeEnvironment -DemoRoot $demoRoot

try {
  & (Join-Path $PSScriptRoot "setup-voxcpm.ps1") -PythonExecutable $PythonExecutable

  $python = Join-Path $demoRoot ".runtime\python\Scripts\python.exe"
  $voxcpm2Root = Join-Path $demoRoot ".models\VoxCPM2"
  $f5Root = Join-Path $demoRoot ".models\F5-TTS"
  $vocosRoot = Join-Path $demoRoot ".models\vocos-mel-24khz"

  Write-Host "Installing the independent F5-TTS comparison runtime..."
  Invoke-Checked -FilePath $python -Step "F5-TTS runtime installation" -ArgumentList @(
    "-m", "pip", "install",
    "f5-tts==1.1.22",
    "torchcodec==0.7.0",
    "transformers==4.57.6",
    "huggingface-hub==0.36.0",
    "pydantic==2.13.4",
    "datasets<4"
  )

  Write-Host "Downloading VoxCPM2 (about 4.96 GB)..."
  Invoke-Checked -FilePath $python -Step "VoxCPM2 model download" -ArgumentList @(
    (Join-Path $demoRoot "src\download_model.py"),
    "--repo", "openbmb/VoxCPM2",
    "--revision", "32279effe8c19989596f05d353d1447f51d9e915",
    "--output", $voxcpm2Root
  )

  Write-Host "Downloading F5-TTS v1 and its Vocos decoder (about 1.5 GB)..."
  Invoke-Checked -FilePath $python -Step "F5-TTS model download" -ArgumentList @(
    (Join-Path $demoRoot "src\download_f5_assets.py"),
    "--model-output", $f5Root,
    "--vocoder-output", $vocosRoot
  )

  Invoke-Checked -FilePath $python -Step "model runtime verification" -ArgumentList @(
    "-c", "import torch, torchaudio; from f5_tts.api import F5TTS; from voxcpm import VoxCPM; torchaudio.load(r'$($demoRoot)\.runtime\prompt_speaker.wav'); print('models runtime ready'); print('cuda:', torch.cuda.is_available())"
  )
  Invoke-Checked -FilePath $python -Step "Python dependency verification" -ArgumentList @(
    "-m", "pip", "check"
  )
  & (Join-Path $PSScriptRoot "setup-source-separation.ps1") -PythonExecutable $python
  Write-Host "All comparison models are ready."
}
finally {
  Remove-VoiceBenchmarkBuildTemp -DemoRoot $demoRoot
}
