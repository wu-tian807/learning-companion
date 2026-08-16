param(
  [string]$PythonPath = $env:LC_PYTHON
)

$ErrorActionPreference = 'Stop'

$lcDemoRoot = Split-Path -Parent $PSScriptRoot
$lcModelsRoot = Join-Path $lcDemoRoot '.models\argos'
$lcExtractedRoot = Join-Path $lcModelsRoot 'extracted'
$lcRuntimeRoot = Join-Path $lcDemoRoot '.runtime\ct2-python-packages'

if ([string]::IsNullOrWhiteSpace($PythonPath)) {
  $lcPythonCommand = Get-Command python -ErrorAction SilentlyContinue
  if ($null -eq $lcPythonCommand) {
    throw 'Python 3.12 was not found. Set LC_PYTHON to the Python executable used for this isolated benchmark.'
  }
  $PythonPath = $lcPythonCommand.Source
}
if (-not (Test-Path -LiteralPath $PythonPath -PathType Leaf)) {
  throw "Python executable does not exist: $PythonPath"
}

$lcPackages = @(
  @{
    Pair = 'en_zh'
    Version = '1_9'
    Url = 'https://argos-net.com/v1/translate-en_zh-1_9.argosmodel'
    Sha256 = '433E7C4F034D87FBE2353161E05F18646D7999452F801A4E1F0378522B9850AB'
  },
  @{
    Pair = 'zh_en'
    Version = '1_9'
    Url = 'https://argos-net.com/v1/translate-zh_en-1_9.argosmodel'
    Sha256 = '62E7AF5A3A48B530E47B7B3E5C78C2DE79073ECD815750D2BF3AB35B4A67DA2D'
  }
)

New-Item -ItemType Directory -Force -Path $lcModelsRoot, $lcExtractedRoot, $lcRuntimeRoot | Out-Null

foreach ($lcPackage in $lcPackages) {
  $lcArchiveName = "translate-$($lcPackage.Pair)-$($lcPackage.Version).argosmodel"
  $lcArchivePath = Join-Path $lcModelsRoot $lcArchiveName
  $lcInstallDirectory = Join-Path $lcExtractedRoot "translate-$($lcPackage.Pair)-$($lcPackage.Version)"
  if (-not (Test-Path -LiteralPath $lcArchivePath -PathType Leaf)) {
    & curl.exe -L --fail --silent --show-error -o $lcArchivePath $lcPackage.Url
    if ($LASTEXITCODE -ne 0) { throw "Could not download $($lcPackage.Url)" }
  }
  $lcActualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $lcArchivePath).Hash
  if ($lcActualHash -ne $lcPackage.Sha256) {
    throw "SHA-256 mismatch for $lcArchivePath"
  }
  if (-not (Test-Path -LiteralPath (Join-Path $lcInstallDirectory 'model\model.bin') -PathType Leaf)) {
    & tar.exe -xf $lcArchivePath -C $lcExtractedRoot
    if ($LASTEXITCODE -ne 0) { throw "Could not extract $lcArchivePath" }
  }
}

& $PythonPath -m pip install --disable-pip-version-check --target $lcRuntimeRoot `
  'ctranslate2==4.8.1' 'sentencepiece==0.2.2' 'psutil==7.2.2'
if ($LASTEXITCODE -ne 0) { throw 'Could not install the CTranslate2 benchmark runtime.' }

Write-Host "CTranslate2 benchmark runtime is ready at $lcRuntimeRoot"
