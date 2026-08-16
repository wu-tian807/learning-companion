param(
  [ValidateSet('cpu', 'cuda')]
  [string]$Backend = 'cpu',

  [ValidateSet('base', 'small-q5_1', 'large-v3-turbo-q5_0')]
  [string]$Model
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$demoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ([string]::IsNullOrWhiteSpace($Model)) {
  $Model = if ($Backend -eq 'cuda') { 'large-v3-turbo-q5_0' } else { 'base' }
}

& (Join-Path $PSScriptRoot 'setup-whisper-cpp.ps1') -Backend $Backend -Model $Model
& (Join-Path $PSScriptRoot 'create-fixtures.ps1')

Push-Location $demoRoot
try {
  node --test
  if ($LASTEXITCODE -ne 0) { throw 'Unit tests failed.' }

  $definitions = Get-Content -LiteralPath (Join-Path $demoRoot 'fixtures\references.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($definition in $definitions) {
    $inputPath = Join-Path $demoRoot ".fixtures\$($definition.file)"
    $outputPath = Join-Path $demoRoot "results\local\$Backend-$Model\$($definition.id)"
    node ./src/cli.mjs transcribe --input $inputPath --backend $Backend --model $Model --language $definition.language --reference-id $definition.id --output $outputPath
    if ($LASTEXITCODE -ne 0) { throw "Transcription failed for $($definition.id)." }
  }
} finally {
  Pop-Location
}

Write-Host "Validation results: $(Join-Path $demoRoot "results\local\$Backend-$Model")"
