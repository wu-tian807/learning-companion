param(
  [string]$PythonExecutable = ""
)

$ErrorActionPreference = "Stop"
$demoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "runtime-env.ps1")
Set-VoiceBenchmarkRuntimeEnvironment -DemoRoot $demoRoot

try {
  if (-not $PythonExecutable) {
    $PythonExecutable = Join-Path $demoRoot ".runtime\python\Scripts\python.exe"
  }
  if (-not (Test-Path -LiteralPath $PythonExecutable)) {
    throw "Install the main Demo runtime before source separation."
  }

  $runtimeRoot = Join-Path $demoRoot ".runtime\separation-python"
  $python = Join-Path $runtimeRoot "Scripts\python.exe"
  if (-not (Test-Path -LiteralPath $python)) {
    Invoke-Checked -FilePath $PythonExecutable -Step "source separation virtual environment" -ArgumentList @(
      "-m", "venv", $runtimeRoot
    )
  }

  Invoke-Checked -FilePath $python -Step "source separation base runtime" -ArgumentList @(
    "-m", "pip", "install",
    "sherpa-onnx==1.13.6",
    "soundfile==0.13.1"
  )
  Invoke-Checked -FilePath $python -Step "source separation CUDA runtime" -ArgumentList @(
    "-m", "pip", "install", "--force-reinstall", "--no-deps",
    "sherpa-onnx==1.13.6+cuda12.cudnn9",
    "-f", "https://k2-fsa.github.io/sherpa/onnx/cuda.html"
  )

  $modelRoot = Join-Path $demoRoot ".models\source-separation"
  $model = Join-Path $modelRoot "UVR-MDX-NET-Inst_HQ_4.onnx"
  $expectedHash = "AF6DE857B80F3EA7C4FD7B0380E7138F5ECF91DA3E5F140C463B5AA6D927636F"
  New-Item -ItemType Directory -Force -Path $modelRoot | Out-Null
  $validModel = (Test-Path -LiteralPath $model) -and (
    (Get-FileHash -LiteralPath $model -Algorithm SHA256).Hash -eq $expectedHash
  )
  if (-not $validModel) {
    $temporary = "$model.download"
    Invoke-WebRequest -Uri "https://github.com/k2-fsa/sherpa-onnx/releases/download/source-separation-models/UVR-MDX-NET-Inst_HQ_4.onnx" -OutFile $temporary
    $actualHash = (Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash
    if ($actualHash -ne $expectedHash) {
      Remove-Item -LiteralPath $temporary -Force
      throw "Source separation model SHA-256 mismatch."
    }
    Move-Item -LiteralPath $temporary -Destination $model -Force
  }

  Invoke-Checked -FilePath $python -Step "source separation dependency verification" -ArgumentList @(
    "-m", "pip", "check"
  )
  Write-Host "UVR source separation is ready."
}
finally {
  Remove-VoiceBenchmarkBuildTemp -DemoRoot $demoRoot
}
