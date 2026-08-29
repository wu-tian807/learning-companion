param(
  [switch]$ResetExperiments
)

$ErrorActionPreference = "Stop"
$demoRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$demoPrefix = $demoRoot + [System.IO.Path]::DirectorySeparatorChar
$targets = @(
  ".runtime\cache",
  ".runtime\temp",
  ".runtime\download-probe",
  ".runtime\wheels",
  "src\__pycache__"
)

if ($ResetExperiments) {
  $targets += @(
    ".runtime\sessions",
    ".runtime\translation-smoke",
    ".runtime\codex-probe",
    ".runtime\tests",
    "results\local"
  )
}

foreach ($relativePath in $targets) {
  $target = [System.IO.Path]::GetFullPath((Join-Path $demoRoot $relativePath))
  if (-not $target.StartsWith($demoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove a cache outside the demo: $target"
  }
  if (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Recurse -Force
    Write-Host "Removed $relativePath"
  }
}
