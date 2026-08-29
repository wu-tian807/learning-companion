param(
  [switch]$Optimize,
  [switch]$SkipSetup,
  [switch]$SkipLong
)

$ErrorActionPreference = "Stop"
$demoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "runtime-env.ps1")
Set-VoiceBenchmarkRuntimeEnvironment -DemoRoot $demoRoot

try {
if (-not $SkipSetup) {
  & (Join-Path $PSScriptRoot "setup-models.ps1")
}

$python = Join-Path $demoRoot ".runtime\python\Scripts\python.exe"
$models = Join-Path $demoRoot ".models"
$reference = Join-Path $demoRoot ".runtime\prompt_speaker.wav"
$results = Join-Path $demoRoot "results\local"
$failedModels = @()

foreach ($modelId in @("voxcpm15", "voxcpm2", "f5tts")) {
  $arguments = @(
    (Join-Path $demoRoot "src\benchmark_voice_model.py"),
    "--model-id", $modelId,
    "--models", $models,
    "--reference", $reference,
    "--output", $results
  )
  if ($Optimize) { $arguments += "--optimize" }
  if ($SkipLong) { $arguments += "--skip-long" }

  Write-Host "Running $modelId benchmark..."
  & $python @arguments
  if ($LASTEXITCODE -ne 0) {
    $failedModels += $modelId
    Write-Error "$modelId benchmark failed with exit code $LASTEXITCODE" -ErrorAction Continue
  }
}

& $python (Join-Path $demoRoot "src\summarize_results.py") --results $results
if ($LASTEXITCODE -ne 0) {
  throw "Benchmark summary failed with exit code $LASTEXITCODE"
}
if ($failedModels.Count -gt 0) {
  throw "Models failed: $($failedModels -join ', ')"
}
$validationArguments = @(
  (Join-Path $demoRoot "src\validate_results.py"),
  "--results", $results
)
if ($SkipLong) { $validationArguments += "--skip-long" }
& $python @validationArguments
if ($LASTEXITCODE -ne 0) {
  throw "Benchmark artifact validation failed with exit code $LASTEXITCODE"
}
Write-Host "Multi-model benchmark finished. Open http://127.0.0.1:4178/web/results.html"
}
finally {
  Remove-VoiceBenchmarkBuildTemp -DemoRoot $demoRoot
}
