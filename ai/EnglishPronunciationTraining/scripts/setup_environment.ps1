param([string]$PythonCommand = 'python', [switch]$SkipModelCheck)
$ErrorActionPreference = 'Stop'
$taskProjectRoot = Split-Path $PSScriptRoot -Parent
Push-Location $taskProjectRoot
try {
    $env:PYTHONUTF8 = '1'
    $env:PIP_CACHE_DIR = Join-Path $taskProjectRoot '.cache\pip'
    $taskPython = Join-Path $taskProjectRoot '.venv\Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $taskPython)) {
        & $PythonCommand -c 'import sys; assert sys.version_info[:2] == (3, 13), "Use Python 3.13 for the saved Windows environment"'
        if ($LASTEXITCODE -ne 0) { throw 'Python 3.13 is required.' }
        & $PythonCommand -m venv .venv
        if ($LASTEXITCODE -ne 0) { throw 'venv creation failed.' }
    }
    & $taskPython -m pip install --upgrade pip
    if ($LASTEXITCODE -ne 0) { throw 'pip upgrade failed.' }
    if (Test-Path -LiteralPath 'requirements-lock-win-py313-cu126.txt') {
        & $taskPython -m pip install -r requirements-lock-win-py313-cu126.txt
        if ($LASTEXITCODE -ne 0) { throw 'Locked dependency installation failed.' }
    } else {
        & $taskPython -m pip install -r requirements-torch-cu126.txt
        if ($LASTEXITCODE -ne 0) { throw 'PyTorch CUDA installation failed.' }
        & $taskPython -m pip install -r requirements.txt
        if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed.' }
    }
    $taskLibrary = Join-Path $taskProjectRoot '.tools\espeak-ng\eSpeak NG\libespeak-ng.dll'
    if (-not (Test-Path -LiteralPath $taskLibrary)) {
        New-Item -ItemType Directory -Path '.tools\downloads' -Force | Out-Null
        $taskMsi = Join-Path $taskProjectRoot '.tools\downloads\espeak-ng-1.52.0.msi'
        Invoke-WebRequest -Uri 'https://github.com/espeak-ng/espeak-ng/releases/download/1.52.0/espeak-ng.msi' -OutFile $taskMsi
        $taskExpectedHash = '7F673C709EA5DD579D3B5EBB98688CC575328A6AB7438D2BC405B88CEDAEAFB9'
        if ((Get-FileHash -LiteralPath $taskMsi -Algorithm SHA256).Hash -ne $taskExpectedHash) {
            throw 'The eSpeak download differs from the verified setup artifact.'
        }
        $taskExtractRoot = Join-Path $taskProjectRoot '.tools\espeak-ng'
        $taskExtractLog = Join-Path $taskProjectRoot '.tools\downloads\espeak-extract.log'
        $taskArguments = '/a "' + $taskMsi + '" /qn TARGETDIR="' + $taskExtractRoot + '" /L*v "' + $taskExtractLog + '"'
        $taskProcess = Start-Process -FilePath 'msiexec.exe' -ArgumentList $taskArguments -WindowStyle Hidden -Wait -PassThru
        if ($taskProcess.ExitCode -notin @(0, 3010)) { throw "eSpeak extraction failed. See $taskExtractLog" }
        if (-not (Test-Path -LiteralPath $taskLibrary)) { throw 'eSpeak x64 DLL missing after extraction.' }
    }
    . (Join-Path $taskProjectRoot 'Enter-Training.ps1')
    & $taskPython -m pip check
    if ($LASTEXITCODE -ne 0) { throw 'Dependency consistency check failed.' }
    & $taskPython scripts\check_environment.py --require-cuda
    if ($LASTEXITCODE -ne 0) { throw 'Environment check failed.' }
    if (-not $SkipModelCheck) {
        & $taskPython scripts\smoke_test_model.py
        if ($LASTEXITCODE -ne 0) { throw 'Acoustic model smoke test failed.' }
    }
    Write-Host 'Training environment is ready.'
} finally {
    Pop-Location
}
