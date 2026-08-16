param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$demoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$fixtureDefinitionPath = Join-Path $demoRoot 'fixtures\references.json'
$outputDirectory = Join-Path $demoRoot '.fixtures'

New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
Add-Type -AssemblyName System.Speech

$definitions = Get-Content -LiteralPath $fixtureDefinitionPath -Raw -Encoding UTF8 | ConvertFrom-Json
$probe = New-Object System.Speech.Synthesis.SpeechSynthesizer
$availableVoices = @($probe.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name })
$probe.Dispose()

foreach ($definition in $definitions) {
  if ($availableVoices -notcontains $definition.voice) {
    $listedVoices = $availableVoices -join ', '
    throw "Fixture voice '$($definition.voice)' is unavailable. Installed voices: $listedVoices"
  }

  $outputPath = Join-Path $outputDirectory $definition.file
  if ((Test-Path -LiteralPath $outputPath) -and -not $Force) {
    Write-Host "Fixture already exists: $outputPath"
    continue
  }

  $synthesizer = New-Object System.Speech.Synthesis.SpeechSynthesizer
  try {
    $synthesizer.SelectVoice($definition.voice)
    $synthesizer.Rate = 0
    $synthesizer.Volume = 100
    $synthesizer.SetOutputToWaveFile($outputPath)
    $synthesizer.Speak([string]$definition.text)
  } finally {
    $synthesizer.Dispose()
  }

  Write-Host "Created fixture: $outputPath"
}
