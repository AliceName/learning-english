@echo off
setlocal
if not defined SPEAKING_TRAINING_ROOT for %%I in ("%~dp0..\..\..\EnglishPronunciationTraining\EnglishPronunciationTraining") do set "SPEAKING_TRAINING_ROOT=%%~fI"
if not exist "%SPEAKING_TRAINING_ROOT%\.venv\Scripts\python.exe" (
  echo Set SPEAKING_TRAINING_ROOT to the prepared training project.
  exit /b 1
)
cd /d "%~dp0"
"%SPEAKING_TRAINING_ROOT%\.venv\Scripts\python.exe" -m uvicorn app:app --host 127.0.0.1 --port 8001 --workers 1
