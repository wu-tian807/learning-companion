$ErrorActionPreference = "Stop"

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$ArgumentList,
    [Parameter(Mandatory = $true)][string]$Step
  )

  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "$Step failed with exit code $LASTEXITCODE."
  }
}

function Set-VoiceBenchmarkRuntimeEnvironment {
  param([Parameter(Mandatory = $true)][string]$DemoRoot)

  $runtimeRoot = Join-Path $DemoRoot ".runtime"
  $cacheRoot = Join-Path $runtimeRoot "cache"
  # Some source-only Python packages still build wheels below TEMP. Keeping that
  # directory short avoids Win32 MAX_PATH failures while all persistent runtime
  # and cache data remains inside the demo.
  $driveRoot = [System.IO.Path]::GetPathRoot([System.IO.Path]::GetFullPath($DemoRoot))
  $tempRoot = Join-Path $driveRoot "lc-voice-rendezvous-temp"

  foreach ($path in @($runtimeRoot, $cacheRoot, $tempRoot)) {
    New-Item -ItemType Directory -Force -Path $path | Out-Null
  }

  $env:PIP_CACHE_DIR = Join-Path $cacheRoot "pip"
  $env:PIP_DISABLE_PIP_VERSION_CHECK = "1"
  $env:HF_HOME = Join-Path $cacheRoot "huggingface"
  $env:HF_HUB_CACHE = Join-Path $env:HF_HOME "hub"
  $env:HF_ASSETS_CACHE = Join-Path $env:HF_HOME "assets"
  $env:TORCH_HOME = Join-Path $cacheRoot "torch"
  $env:TORCH_EXTENSIONS_DIR = Join-Path $cacheRoot "torch-extensions"
  $env:TORCHINDUCTOR_CACHE_DIR = Join-Path $cacheRoot "torch-inductor"
  $env:TRITON_CACHE_DIR = Join-Path $cacheRoot "triton"
  $env:CUDA_CACHE_PATH = Join-Path $cacheRoot "cuda"
  $env:XDG_CACHE_HOME = Join-Path $cacheRoot "xdg"
  $env:XDG_CONFIG_HOME = Join-Path $cacheRoot "xdg-config"
  $env:NUMBA_CACHE_DIR = Join-Path $cacheRoot "numba"
  $env:MODELSCOPE_CACHE = Join-Path $cacheRoot "modelscope"
  $env:CACHED_PATH_CACHE_ROOT = Join-Path $cacheRoot "cached-path"
  $env:CACHED_PATH_CACHE_DIR = $env:CACHED_PATH_CACHE_ROOT
  $env:MPLCONFIGDIR = Join-Path $cacheRoot "matplotlib"
  $env:GRADIO_TEMP_DIR = Join-Path $tempRoot "gradio"
  $env:WANDB_DIR = Join-Path $cacheRoot "wandb"
  $env:WANDB_CACHE_DIR = Join-Path $env:WANDB_DIR "cache"
  $env:WANDB_CONFIG_DIR = Join-Path $env:WANDB_DIR "config"
  $env:WANDB_MODE = "disabled"
  $env:TEMP = $tempRoot
  $env:TMP = $tempRoot
  $env:TMPDIR = $tempRoot
  $env:UV_CACHE_DIR = Join-Path $cacheRoot "uv"
  $env:PYTHONPYCACHEPREFIX = Join-Path $cacheRoot "pycache"
  $env:HF_HUB_DISABLE_TELEMETRY = "1"
  $env:DO_NOT_TRACK = "1"

  foreach ($path in @(
    $env:PIP_CACHE_DIR,
    $env:HF_HOME,
    $env:HF_HUB_CACHE,
    $env:HF_ASSETS_CACHE,
    $env:TORCH_HOME,
    $env:TORCH_EXTENSIONS_DIR,
    $env:TORCHINDUCTOR_CACHE_DIR,
    $env:TRITON_CACHE_DIR,
    $env:CUDA_CACHE_PATH,
    $env:XDG_CACHE_HOME,
    $env:XDG_CONFIG_HOME,
    $env:NUMBA_CACHE_DIR,
    $env:MODELSCOPE_CACHE,
    $env:CACHED_PATH_CACHE_ROOT,
    $env:MPLCONFIGDIR,
    $env:GRADIO_TEMP_DIR,
    $env:WANDB_DIR,
    $env:WANDB_CACHE_DIR,
    $env:WANDB_CONFIG_DIR,
    $env:UV_CACHE_DIR,
    $env:PYTHONPYCACHEPREFIX
  )) {
    New-Item -ItemType Directory -Force -Path $path | Out-Null
  }
}

function Remove-VoiceBenchmarkBuildTemp {
  param([Parameter(Mandatory = $true)][string]$DemoRoot)

  $driveRoot = [System.IO.Path]::GetPathRoot([System.IO.Path]::GetFullPath($DemoRoot))
  $tempRoot = [System.IO.Path]::GetFullPath((Join-Path $driveRoot "lc-voice-rendezvous-temp"))
  $expectedRoot = [System.IO.Path]::GetFullPath($driveRoot)
  if (-not $tempRoot.StartsWith($expectedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove a build temp directory outside the demo drive: $tempRoot"
  }
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
