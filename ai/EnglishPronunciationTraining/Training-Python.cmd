@echo off
setlocal
set "PYTHONUTF8=1"
set "PIP_CACHE_DIR=%~dp0.cache\pip"
set "HF_HOME=%~dp0.cache\huggingface"
set "HF_HUB_DISABLE_SYMLINKS_WARNING=1"
set "TOKENIZERS_PARALLELISM=false"
set "PHONEMIZER_ESPEAK_LIBRARY=%~dp0.tools\espeak-ng\eSpeak NG\libespeak-ng.dll"
set "ESPEAK_DATA_PATH=%~dp0.tools\espeak-ng\eSpeak NG"
"%~dp0.venv\Scripts\python.exe" %*
exit /b %errorlevel%
