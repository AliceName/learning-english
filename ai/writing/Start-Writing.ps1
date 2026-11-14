[CmdletBinding()]
param(
    [string]$CefrRun = 'artifacts/cefr-my-first-run',
    [string]$GecRun = '',
    [ValidateSet('auto', 'cpu', 'cuda')][string]$Device = 'auto',
    [switch]$EnableFeedback,
    [string]$FeedbackManifest = '.cache/feedback-local/manifest.json',
    [string]$FeedbackBenchmark = ''
)
$ErrorActionPreference = 'Stop'
$taskPython = Join-Path $PSScriptRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) { throw 'Run Install-Training.ps1 and install requirements-service.txt first.' }
if (-not $PSBoundParameters.ContainsKey('GecRun')) {
    $GecRun = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'model-defaults.json') -Raw | ConvertFrom-Json).gecRun
    if (-not $GecRun) { throw 'Missing default GEC run in model-defaults.json.' }
}
$env:WRITING_CEFR_RUN = if ([IO.Path]::IsPathRooted($CefrRun)) { $CefrRun } else { Join-Path $PSScriptRoot $CefrRun }
# Windows PowerShell removes empty env values. Preserve explicit GEC disable.
$env:WRITING_GEC_RUN = if ($GecRun) { if ([IO.Path]::IsPathRooted($GecRun)) { $GecRun } else { Join-Path $PSScriptRoot $GecRun } } else { ' ' }
$env:WRITING_DEVICE = $Device
$env:WRITING_FEEDBACK_ENABLED = '0'
$env:WRITING_FEEDBACK_MANIFEST = ''
function Test-FeedbackNumber($Value) {
    if ($Value -isnot [int] -and $Value -isnot [long] -and $Value -isnot [double] -and
        $Value -isnot [single] -and $Value -isnot [decimal]) { return $false }
    $number = [double]$Value
    return -not [double]::IsNaN($number) -and -not [double]::IsInfinity($number) -and $number -ge 0
}
function Test-FeedbackInteger($Value) {
    return ($Value -is [int] -or $Value -is [long]) -and $Value -ge 0
}
function Get-FeedbackHash([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw 'A pinned feedback payload is missing.' }
    $taskHashStream = [IO.File]::OpenRead($Path)
    $taskHasher = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($taskHasher.ComputeHash($taskHashStream))).Replace('-', '').ToLowerInvariant() }
    finally { $taskHashStream.Dispose(); $taskHasher.Dispose() }
}
if ($EnableFeedback) {
    if (-not $FeedbackBenchmark) { throw 'Feedback requires a passing 30-case benchmark. Supply -FeedbackBenchmark.' }
    $taskManifestPath = if ([IO.Path]::IsPathRooted($FeedbackManifest)) { $FeedbackManifest } else { Join-Path $PSScriptRoot $FeedbackManifest }
    $taskBenchmarkPath = if ([IO.Path]::IsPathRooted($FeedbackBenchmark)) { $FeedbackBenchmark } else { Join-Path $PSScriptRoot $FeedbackBenchmark }
    $taskManifest = Get-Content -LiteralPath $taskManifestPath -Raw | ConvertFrom-Json
    $taskBenchmark = Get-Content -LiteralPath $taskBenchmarkPath -Raw | ConvertFrom-Json
    $taskManifestHash = Get-FeedbackHash $taskManifestPath
    $taskFeedbackSourceHash = Get-FeedbackHash (Join-Path $PSScriptRoot 'local_feedback.py')
    $taskFixtureHash = Get-FeedbackHash (Join-Path $PSScriptRoot 'examples/feedback-benchmark.jsonl')
    $taskBenchmarkSourceHash = Get-FeedbackHash (Join-Path $PSScriptRoot 'benchmark_feedback.py')
    if ($taskBenchmark.technical_gate_passed -isnot [bool] -or $taskBenchmark.technical_gate_passed -ne $true -or
        $taskBenchmark.kind -cne 'self_authored_local_feedback_operational_benchmark_not_semantic_acceptance' -or
        -not (Test-FeedbackInteger $taskBenchmark.cases) -or $taskBenchmark.cases -ne 30 -or
        -not (Test-FeedbackInteger $taskBenchmark.readyCount) -or $taskBenchmark.readyCount -lt 27 -or $taskBenchmark.readyCount -gt 30 -or
        -not (Test-FeedbackNumber $taskBenchmark.maxSeconds) -or $taskBenchmark.maxSeconds -gt 30 -or
        -not (Test-FeedbackNumber $taskBenchmark.p95Seconds) -or $taskBenchmark.p95Seconds -gt $taskBenchmark.maxSeconds -or
        -not (Test-FeedbackNumber $taskBenchmark.coldStartupSeconds) -or
        $taskBenchmark.allMeasuredRequestsStartedWarm -isnot [bool] -or $taskBenchmark.allMeasuredRequestsStartedWarm -ne $true -or
        $taskBenchmark.successfuldoesnotmeanpedagogyvalidated -isnot [bool] -or $taskBenchmark.successfuldoesnotmeanpedagogyvalidated -ne $true -or
        $taskManifest.modelId -cne 'Qwen/Qwen2.5-1.5B-Instruct-GGUF' -or $taskBenchmark.modelId -cne $taskManifest.modelId -or
        $taskBenchmark.modelSha256 -ne $taskManifest.modelSha256 -or
        $taskBenchmark.manifestSha256 -ne $taskManifestHash -or
        $taskBenchmark.feedbackSourceSha256 -ne $taskFeedbackSourceHash -or
        $taskBenchmark.fixtureSha256 -ne $taskFixtureHash -or
        $taskBenchmark.benchmarkSourceSha256 -ne $taskBenchmarkSourceHash) {
        throw 'Feedback benchmark is failed, incomplete, or stale; feedback stays disabled.'
    }
    foreach ($taskPayload in @(@('modelPath', 'modelSha256'), @('runtimePath', 'runtimeSha256'))) {
        $taskPath = $taskManifest.($taskPayload[0])
        $taskHash = $taskManifest.($taskPayload[1])
        if ($taskPath -isnot [string] -or -not [IO.Path]::IsPathRooted($taskPath) -or
            $taskHash -isnot [string] -or $taskHash -cnotmatch '^[a-f0-9]{64}$' -or
            (Get-FeedbackHash $taskPath) -cne $taskHash) { throw 'A pinned feedback payload differs.' }
    }
    $taskRuntimeRoot = [IO.Path]::GetFullPath([IO.Path]::GetDirectoryName($taskManifest.runtimePath))
    $taskRuntimePrefix = $taskRuntimeRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if ($null -eq $taskManifest.runtimeFiles -or @($taskManifest.runtimeFiles.PSObject.Properties).Count -eq 0) {
        throw 'Pinned feedback runtime files are missing.'
    }
    foreach ($taskFile in $taskManifest.runtimeFiles.PSObject.Properties) {
        if ([IO.Path]::IsPathRooted($taskFile.Name)) { throw 'Invalid feedback runtime path.' }
        $taskRuntimeFile = [IO.Path]::GetFullPath((Join-Path $taskRuntimeRoot $taskFile.Name))
        if (-not $taskRuntimeFile.StartsWith($taskRuntimePrefix, [StringComparison]::OrdinalIgnoreCase) -or
            $taskFile.Value -isnot [string] -or $taskFile.Value -cnotmatch '^[a-f0-9]{64}$' -or
            (Get-FeedbackHash $taskRuntimeFile) -cne $taskFile.Value) { throw 'A pinned feedback runtime file differs.' }
    }
    $env:WRITING_FEEDBACK_MANIFEST = $taskManifestPath
    $env:WRITING_FEEDBACK_ENABLED = '1'
}
$env:OMP_NUM_THREADS = '2'
$env:MKL_NUM_THREADS = '2'
$env:HF_HUB_OFFLINE = '1'
# Windows PowerShell 5 converts redirected native stderr into error records.
# Uvicorn writes ordinary INFO messages there; fail on its exit code instead.
# Keep Stop for every validation above and restore it before reporting failure.
$taskPreviousErrorAction = $ErrorActionPreference
$taskNativeExit = $null
$taskLockDirectory = Join-Path $PSScriptRoot '.cache/locks'
$null = New-Item -ItemType Directory -Path $taskLockDirectory -Force
try {
    $taskServiceLock = [IO.File]::Open((Join-Path $taskLockDirectory 'writing-ai-start.lock'),
        [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
} catch [IO.IOException] {
    throw 'Writing AI is already starting or running from this checkout. Check http://127.0.0.1:8000/health.'
}
try {
    $ErrorActionPreference = 'Continue'
    & $taskPython -m uvicorn serve:app --app-dir $PSScriptRoot --host 127.0.0.1 --port 8000 --workers 1
    $taskNativeExit = $LASTEXITCODE
}
finally {
    $taskServiceLock.Dispose()
    $ErrorActionPreference = $taskPreviousErrorAction
}
if ($taskNativeExit -ne 0) { throw "Writing AI exited with code $taskNativeExit." }
