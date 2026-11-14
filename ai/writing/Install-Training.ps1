param([switch]$CpuOnly)
$ErrorActionPreference = 'Stop'
$taskPython = Join-Path $PSScriptRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) {
    py -3.11 -m venv (Join-Path $PSScriptRoot '.venv')
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.11 is required. Check py -0p.' }
}
& $taskPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw 'Could not update pip in the private training environment.' }
$taskTorchIndex = if ($CpuOnly) { 'https://download.pytorch.org/whl/cpu' } else { 'https://download.pytorch.org/whl/cu126' }
& $taskPython -m pip install --timeout 120 --retries 5 --resume-retries 8 torch==2.9.1 --index-url $taskTorchIndex
if ($LASTEXITCODE -ne 0) { throw 'Could not install PyTorch. Retry this script; do not substitute a CPU wheel for GPU training.' }
& $taskPython -m pip install --timeout 120 -r (Join-Path $PSScriptRoot 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Could not install the training requirements.' }
& $taskPython -m pip check
if ($LASTEXITCODE -ne 0) { throw 'Training dependency versions conflict.' }
& $taskPython (Join-Path $PSScriptRoot 'check_environment.py')
if ($LASTEXITCODE -ne 0) { throw 'Environment check failed.' }
