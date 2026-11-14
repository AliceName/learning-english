$taskTrainingRoot = $PSScriptRoot
$taskVenvPython = Join-Path $taskTrainingRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $taskVenvPython)) {
    throw 'Chua co .venv. Chay scripts\setup_environment.ps1 truoc.'
}
$env:PYTHONUTF8 = '1'
$env:PIP_CACHE_DIR = Join-Path $taskTrainingRoot '.cache\pip'
$env:HF_HOME = Join-Path $taskTrainingRoot '.cache\huggingface'
$env:HF_HUB_DISABLE_SYMLINKS_WARNING = '1'
$env:HF_HUB_DOWNLOAD_TIMEOUT = '120'
$env:TOKENIZERS_PARALLELISM = 'false'
$taskEspeakLibrary = Join-Path $taskTrainingRoot '.tools\espeak-ng\eSpeak NG\libespeak-ng.dll'
if (Test-Path -LiteralPath $taskEspeakLibrary) {
    $env:PHONEMIZER_ESPEAK_LIBRARY = $taskEspeakLibrary
    $env:ESPEAK_DATA_PATH = Split-Path $taskEspeakLibrary
}
. (Join-Path $taskTrainingRoot '.venv\Scripts\Activate.ps1')
Write-Host "Training Python: $taskVenvPython"
Write-Host "Model cache: $env:HF_HOME"

