[CmdletBinding()]
param(
    [string]$Source = (Join-Path $env:USERPROFILE 'Downloads/write-and-improve-corpus-2024-v2'),
    [ValidateSet('gec','cefr')][string]$ModelTask = 'gec',
    [ValidateSet('first-final','verified-unicode-train')][string]$DataProfile = 'first-final',
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]*$')][string]$RunName = 'gec-expanded-v1',
    [ValidateRange(1,100)][double]$Epochs = 6,
    [ValidateRange(1,16)][int]$BatchSize = 16,
    [ValidateScript({ -not [double]::IsNaN($_) -and -not [double]::IsInfinity($_) -and $_ -gt 0 })][double]$LearningRate = 0.0002,
    [ValidateSet('none','sqrt-inverse')][string]$CefrClassWeighting = 'none',
    [ValidateSet('qv','qvo')][string]$GecLoraProfile = 'qv',
    [int]$GecEvalSeed = 2026,
    [switch]$NoTokenCache,
    [switch]$PrepareOnly,
    [switch]$Smoke,
    [switch]$Experiment,
    [switch]$RequireBf16,
    [switch]$Resume,
    [switch]$StopLocalAi,
    [switch]$RestoreLocalAi,
    [string]$InitRun = ''
)
$taskPreviousErrorAction = $ErrorActionPreference
$taskPreviousNativePreference = Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue
$taskPreviousEnvironment = @{}
foreach ($taskEnvironmentName in @('OMP_NUM_THREADS','MKL_NUM_THREADS','HF_HUB_OFFLINE')) {
    $taskPreviousEnvironment[$taskEnvironmentName] = [Environment]::GetEnvironmentVariable($taskEnvironmentName, 'Process')
}
try {
$ErrorActionPreference = 'Stop'
if ($ModelTask -ne 'cefr' -and $CefrClassWeighting -ne 'none') { throw 'CefrClassWeighting applies only to cefr.' }
if ($ModelTask -ne 'gec' -and $GecLoraProfile -ne 'qv') { throw 'GecLoraProfile applies only to gec.' }
if ($DataProfile -eq 'verified-unicode-train' -and $ModelTask -ne 'gec') { throw 'verified-unicode-train applies only to gec.' }
if ($RestoreLocalAi -and -not $StopLocalAi) { throw 'RestoreLocalAi requires StopLocalAi.' }
if ($ModelTask -eq 'cefr') {
    if (-not $PSBoundParameters.ContainsKey('RunName')) { $RunName = 'cefr-expanded-v1' }
    if (-not $PSBoundParameters.ContainsKey('BatchSize')) { $BatchSize = 8 }
}
$taskPython = Join-Path $PSScriptRoot '.venv/Scripts/python.exe'
$taskLegacyData = Join-Path $PSScriptRoot 'data/prepared-first-final'
$taskData = if ($DataProfile -eq 'verified-unicode-train') {
    Join-Path $PSScriptRoot 'data/prepared-verified-unicode-train-v2'
} else { $taskLegacyData }
if (-not (Test-Path -LiteralPath $taskPython)) { throw 'Run Install-Training.ps1 first.' }
if ($Resume -and $InitRun) { throw 'Choose Resume or InitRun, not both.' }
$taskLogDirectory = Join-Path $PSScriptRoot '.cache/training-launcher-logs'
$null = New-Item -ItemType Directory -Path $taskLogDirectory -Force
$taskLogPath = Join-Path $taskLogDirectory ($RunName + '-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff') + '-' + $PID + '.log')
$null = New-Item -ItemType File -Path $taskLogPath
function Write-TaskLog([string]$Line) {
    Write-Host $Line
    Add-Content -LiteralPath $taskLogPath -Value $Line -Encoding UTF8 -ErrorAction Stop
}
function Invoke-TaskPython([string[]]$Arguments) {
    $taskCommandStarted = [DateTime]::UtcNow.ToString('o')
    Write-TaskLog ('START ' + $taskCommandStarted)
    $taskQuotedArguments = @(@($taskPython) + $Arguments | ForEach-Object { '"' + $_.Replace('"','\"') + '"' })
    Write-TaskLog ('COMMAND ' + ($taskQuotedArguments -join ' '))
    $taskNativeErrorAction = $ErrorActionPreference
    $taskNativePreference = Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue
    try {
        # PS5 wraps native stderr in error records. INFO is not process failure.
        $ErrorActionPreference = 'Continue'
        $PSNativeCommandUseErrorActionPreference = $false
        & $taskPython @Arguments 2>&1 | ForEach-Object { Write-TaskLog $_.ToString() }
        $taskNativeExit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $taskNativeErrorAction
        if ($taskNativePreference) { $PSNativeCommandUseErrorActionPreference = $taskNativePreference.Value }
        else { Remove-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue }
    }
    Write-TaskLog ('END ' + [DateTime]::UtcNow.ToString('o') + ' EXIT ' + $taskNativeExit)
    return $taskNativeExit
}
Write-TaskLog ('CONFIG ' + ($PSBoundParameters | ConvertTo-Json -Compress))
$taskNativeExit = Invoke-TaskPython @((Join-Path $PSScriptRoot 'data.py'),'--source',$Source,'--gec-versions','first-final','--output',$taskLegacyData,'--reuse')
if ($taskNativeExit -ne 0) { throw ('Data preparation or integrity verification failed. Exit code ' + $taskNativeExit) }
if ($DataProfile -eq 'verified-unicode-train') {
    $taskNativeExit = Invoke-TaskPython @((Join-Path $PSScriptRoot 'prepare_verified_corpus.py'),
        '--source',$Source,'--prepared',$taskLegacyData,'--output',$taskData,'--reuse')
    if ($taskNativeExit -ne 0) { throw ('Verified corpus preparation or integrity verification failed. Exit code ' + $taskNativeExit) }
}
$taskReport = Get-Content -LiteralPath (Join-Path $taskData 'preparation-report.json') -Raw -Encoding UTF8 | ConvertFrom-Json
Write-Host ('Prepared {0}: train={1}, dev={2}, test={3}' -f $ModelTask,$taskReport.$ModelTask.train.count,$taskReport.$ModelTask.dev.count,$taskReport.$ModelTask.test.count)
if ($PrepareOnly) { return }
$taskName = if ($Smoke) { $RunName + '-smoke' } else { $RunName }
$taskOutput = Join-Path $PSScriptRoot ('artifacts/' + $taskName)
$taskCheckpoint = $null
if ($Resume) {
    $taskCandidates = @(Get-ChildItem -LiteralPath $taskOutput -Directory | Where-Object { $_.Name -match '^checkpoint-\d+$' } | Sort-Object { [int]($_.Name -replace '^checkpoint-','') } -Descending)
    foreach ($taskCandidate in $taskCandidates) {
        $taskComplete = $true
        foreach ($taskFile in @('trainer_state.json','optimizer.pt','scheduler.pt','rng_state.pth','adapter_model.safetensors','tokenizer_config.json')) {
            if (-not (Test-Path -LiteralPath (Join-Path $taskCandidate.FullName $taskFile))) { $taskComplete = $false }
        }
        if ($taskComplete) { $taskCheckpoint = $taskCandidate.FullName; break }
    }
    if (-not $taskCheckpoint) { throw 'No complete checkpoint found. Checkpoint saves occur every 250 optimizer steps and each epoch.' }
} elseif ((Test-Path -LiteralPath $taskOutput) -and (Get-ChildItem -LiteralPath $taskOutput -Force | Select-Object -First 1)) {
    throw 'Run already exists. Use -Resume or choose a new -RunName.'
}
$taskLockDirectory = Join-Path $PSScriptRoot '.cache/locks'
$null = New-Item -ItemType Directory -Path $taskLockDirectory -Force
try {
    $taskLock = [IO.File]::Open((Join-Path $taskLockDirectory ($taskName + '.lock')), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
} catch { throw 'This run is already active in another terminal.' }
$taskOriginalHealth = $null
$taskAiStopped = $false
$taskTrainingFailure = $null
$taskGpuLock = $null
try {
    try {
        $taskGpuLock = [IO.File]::Open((Join-Path $taskLockDirectory 'writing-gpu.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    } catch { throw 'Another Writing GPU operation is active; no service was stopped and no training was started.' }
    if ($StopLocalAi) {
        $taskListeners = @(Get-NetTCPConnection -State Listen -LocalPort 8000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
        foreach ($taskListenerPid in $taskListeners) {
            $taskProcess = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $taskListenerPid)
            $taskCommand = [string]$taskProcess.CommandLine
            if ($taskCommand -notmatch 'uvicorn\s+serve:app' -or $taskCommand.Replace('/','\').IndexOf($PSScriptRoot,[StringComparison]::OrdinalIgnoreCase) -lt 0) {
                throw 'Port 8000 belongs to a different process; it was not stopped.'
            }
        }
        if ($RestoreLocalAi -and $taskListeners.Count -gt 0) {
            $taskOriginalHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health' -TimeoutSec 10
            if ($taskOriginalHealth.status -ne 'ready') { throw 'Writing AI must be ready before recording its restore configuration.' }
            if ($taskOriginalHealth.feedbackEnabled) { throw 'Cannot automatically restore enabled feedback with its benchmark configuration; service was not stopped.' }
            foreach ($taskRestoreName in @($taskOriginalHealth.cefrRun) + @(if ($taskOriginalHealth.correctionsEnabled) { $taskOriginalHealth.gecRun })) {
                if ($taskRestoreName -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]*$' -or
                    -not (Test-Path -LiteralPath (Join-Path $PSScriptRoot ('artifacts/' + $taskRestoreName + '/run.json')))) {
                    throw 'Cannot restore this service automatically: its model names must resolve to this project artifacts directory.'
                }
            }
        }
        foreach ($taskListenerPid in $taskListeners) {
            Stop-Process -Id $taskListenerPid
            $taskAiStopped = $true
            Wait-Process -Id $taskListenerPid -Timeout 10 -ErrorAction SilentlyContinue
            Write-Host 'Stopped this project Writing AI to free GPU memory. Frontend/backend remain available.'
        }
    }
    $env:OMP_NUM_THREADS = '2'
    $env:MKL_NUM_THREADS = '2'
    $env:HF_HUB_OFFLINE = '1'
    # VRAM alone is insufficient: another model can fit but must not run with us.
    $taskGpuQueryCommand = (Get-Command 'nvidia-smi.exe' -ErrorAction Stop).Source
    Write-TaskLog ('START ' + [DateTime]::UtcNow.ToString('o') + ' COMMAND nvidia-smi --query-compute-apps=pid --format=csv,noheader,nounits')
    $taskGpuQueryErrorAction = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $taskGpuQueryOutput = @(& $taskGpuQueryCommand --query-compute-apps=pid --format=csv,noheader,nounits 2>&1)
        $taskGpuQuerySucceeded = $?
        $taskGpuQueryExit = $LASTEXITCODE
        if (-not $taskGpuQuerySucceeded -and $taskGpuQueryExit -eq 0) { $taskGpuQueryExit = -1 }
    } finally { $ErrorActionPreference = $taskGpuQueryErrorAction }
    foreach ($taskGpuQueryLine in $taskGpuQueryOutput) { Write-TaskLog $taskGpuQueryLine.ToString() }
    Write-TaskLog ('END ' + [DateTime]::UtcNow.ToString('o') + ' EXIT ' + $taskGpuQueryExit)
    if ($taskGpuQueryExit -ne 0) { throw 'Cannot verify GPU process exclusivity; no training was started.' }
    $taskGpuProcessIds = @($taskGpuQueryOutput | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ })
    if ($taskGpuProcessIds.Count -gt 0) {
        throw ('GPU compute processes are active (PIDs: ' + ($taskGpuProcessIds -join ', ') + '). Stop the owned service with -StopLocalAi or close the other workload. No unrelated process was stopped.')
    }
    $taskMinimumFree = if ($Smoke) { 900 } elseif ($BatchSize -le 4) { 1600 } elseif ($BatchSize -le 8) { 2200 } else { 3000 }
    $taskNativeExit = Invoke-TaskPython @('-c',"import sys,torch; ok=torch.cuda.is_available(); free=int(torch.cuda.mem_get_info()[0]/1024**2) if ok else 0; print('Free CUDA VRAM:',free,'MiB'); sys.exit(0 if ok and free>=int(sys.argv[1]) else 1)",([string]$taskMinimumFree))
    if ($taskNativeExit -ne 0) { throw 'Not enough free CUDA memory. Stop other GPU workloads; this launcher will not change batch or precision.' }
    $taskArguments = @((Join-Path $PSScriptRoot 'train.py'),$ModelTask,
        '--train-file',(Join-Path $taskData ($ModelTask + '-train.jsonl')),'--dev-file',(Join-Path $taskData ($ModelTask + '-dev.jsonl')),
        '--output',$taskOutput,'--epochs',$Epochs.ToString([Globalization.CultureInfo]::InvariantCulture),
        '--learning-rate',$LearningRate.ToString('R',[Globalization.CultureInfo]::InvariantCulture),
        '--gradient-accumulation','1','--early-stopping-patience','2','--progress')
    if ($Experiment) {
        $taskArguments += '--experiment'
        $taskArguments[$taskArguments.IndexOf('--early-stopping-patience') + 1] = '0'
    }
    if ($RequireBf16) { $taskArguments += '--require-bf16' }
    if ($DataProfile -eq 'verified-unicode-train') {
        $taskArguments += @('--preparation-report',(Join-Path $taskData 'preparation-report.json'))
    }
    if ($ModelTask -eq 'gec') { $taskArguments += @('--gec-edit-weight','4','--gec-eval-seed',([string]$GecEvalSeed),'--gec-lora-profile',$GecLoraProfile) }
    if ($NoTokenCache) { $taskArguments += '--no-token-cache' }
    if ($ModelTask -eq 'cefr') { $taskArguments += @('--cefr-class-weighting',$CefrClassWeighting) }
    if ($Smoke) {
        $taskTargetSteps = if ($Resume) { '6' } else { '3' }
        $taskArguments += @('--batch-size','2','--max-steps',$taskTargetSteps,'--limit-train','32','--limit-dev','64','--checkpoint-steps','1')
        if ($ModelTask -eq 'gec') { $taskArguments += @('--gec-eval-per-group','2','--gec-eval-batch-size','2') }
    } else {
        $taskArguments += @('--batch-size',([string]$BatchSize),'--checkpoint-steps','250')
        if ($ModelTask -eq 'gec') { $taskArguments += @('--gec-eval-per-group','128','--gec-eval-batch-size','4') }
    }
    if ($Resume) { $taskArguments += @('--resume-checkpoint',$taskCheckpoint) }
    if ($InitRun) { $taskArguments += @('--init-run',$InitRun) }
    $taskNativeExit = Invoke-TaskPython $taskArguments
    if ($taskNativeExit -ne 0) { throw ('Training stopped with exit code ' + $taskNativeExit + '. Read the error above; use -Resume after fixing it if a complete checkpoint exists.') }
    Write-Host ('Saved run: ' + $taskOutput)
    if (-not $Smoke -and -not $Experiment) {
        $taskRunFlag = if ($ModelTask -eq 'gec') { '-GecRun' } else { '-CefrRun' }
        Write-Host ('After checking quality: .\ai\writing\Start-Writing.ps1 ' + $taskRunFlag + ' artifacts/' + $taskName)
    }
} catch {
    $taskTrainingFailure = $_
    throw
} finally {
    try {
        if ($RestoreLocalAi -and $taskAiStopped -and $taskOriginalHealth) {
            $taskAlreadyRestored = $false
            $taskRestoreListeners = @(Get-NetTCPConnection -State Listen -LocalPort 8000 -ErrorAction SilentlyContinue)
            if ($taskRestoreListeners.Count -gt 0) {
                $taskRestoreHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health' -TimeoutSec 5
                $taskAlreadyRestored = $taskRestoreHealth.status -eq 'ready' -and $taskRestoreHealth.cefrRun -eq $taskOriginalHealth.cefrRun -and
                    $taskRestoreHealth.gecRun -eq $taskOriginalHealth.gecRun -and $taskRestoreHealth.correctionsEnabled -eq $taskOriginalHealth.correctionsEnabled
                if (-not $taskAlreadyRestored) { throw 'Port 8000 was occupied during training; no process was replaced.' }
            }
            if (-not $taskAlreadyRestored) {
                $taskServiceLogs = Join-Path $PSScriptRoot ('.cache/service-logs/' + $taskName + '-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff'))
                $null = New-Item -ItemType Directory -Path $taskServiceLogs -Force
                $taskRestoreArguments = @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'Start-Writing.ps1'),
                    '-CefrRun',(Join-Path $PSScriptRoot ('artifacts/' + $taskOriginalHealth.cefrRun)),'-Device','auto')
                if ($taskOriginalHealth.correctionsEnabled) { $taskRestoreArguments += @('-GecRun',(Join-Path $PSScriptRoot ('artifacts/' + $taskOriginalHealth.gecRun))) }
                # Start-Process joins ArgumentList; quote paths so workspaces containing spaces work too.
                $taskQuotedRestoreArguments = @($taskRestoreArguments | ForEach-Object { '"' + $_.Replace('"','\"') + '"' })
                $null = Start-Process -FilePath 'powershell.exe' -ArgumentList $taskQuotedRestoreArguments -WorkingDirectory $PSScriptRoot `
                    -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskServiceLogs 'stdout.log') `
                    -RedirectStandardError (Join-Path $taskServiceLogs 'stderr.log')
                for ($taskRestoreAttempt=0; $taskRestoreAttempt -lt 45; $taskRestoreAttempt++) {
                    try {
                        $taskRestoreHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health' -TimeoutSec 2
                        if ($taskRestoreHealth.status -eq 'ready' -and $taskRestoreHealth.cefrRun -eq $taskOriginalHealth.cefrRun -and
                            $taskRestoreHealth.gecRun -eq $taskOriginalHealth.gecRun -and $taskRestoreHealth.correctionsEnabled -eq $taskOriginalHealth.correctionsEnabled) {
                            $taskAlreadyRestored = $true
                            break
                        }
                    } catch { }
                    Start-Sleep -Seconds 1
                }
                if (-not $taskAlreadyRestored) { throw ('Original Writing AI did not return ready. Read logs: ' + $taskServiceLogs) }
            }
            Write-Host 'Restored the original Writing AI models. The new training run was not promoted.'
        }
    } catch {
        if ($taskTrainingFailure) { Write-Warning ('Training failed and service restoration also needs attention: ' + $_.Exception.Message) }
        else { throw }
    } finally {
        if ($taskGpuLock) { $taskGpuLock.Dispose() }
        $taskLock.Dispose()
    }
}
} finally {
    foreach ($taskEnvironmentName in $taskPreviousEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($taskEnvironmentName, $taskPreviousEnvironment[$taskEnvironmentName], 'Process')
    }
    $ErrorActionPreference = $taskPreviousErrorAction
    if ($taskPreviousNativePreference) { $PSNativeCommandUseErrorActionPreference = $taskPreviousNativePreference.Value }
    else { Remove-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue }
}
