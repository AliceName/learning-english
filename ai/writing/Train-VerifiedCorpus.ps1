[CmdletBinding()]
param(
    [string]$Source = (Join-Path $env:USERPROFILE 'Downloads/write-and-improve-corpus-2024-v2'),
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]*$')][string]$RunName = 'gec-unicode-verified-v1',
    [ValidateRange(1,100)][double]$Epochs = 2,
    [ValidateRange(1,16)][int]$BatchSize = 8,
    [ValidateScript({ -not [double]::IsNaN($_) -and -not [double]::IsInfinity($_) -and $_ -gt 0 })][double]$LearningRate = 0.0002,
    [int]$GecEvalSeed = 2026,
    [string]$InitRun = '',
    [switch]$StopLocalAi,
    [switch]$RestoreLocalAi,
    [switch]$PrepareOnly,
    [switch]$Resume,
    [switch]$NoTokenCache
)

# Splat typed arguments: paths with spaces remain single PowerShell arguments.
# The shared launcher owns preflight, GPU exclusivity, logs, and restoration.
if ($Resume -and $PSBoundParameters.ContainsKey('InitRun')) {
    throw 'Choose Resume or an explicit InitRun, not both.'
}
if (-not $PSBoundParameters.ContainsKey('InitRun')) {
    # Windows PowerShell 5 can leave PSScriptRoot empty while binding defaults.
    $InitRun = Join-Path $PSScriptRoot 'artifacts/gec-expanded-v1'
}
$taskVerifiedOptions = @{
    Source = $Source
    ModelTask = 'gec'
    DataProfile = 'verified-unicode-train'
    RunName = $RunName
    Epochs = $Epochs
    BatchSize = $BatchSize
    LearningRate = $LearningRate
    GecLoraProfile = 'qvo'
    GecEvalSeed = $GecEvalSeed
    RequireBf16 = $true
}
if (-not $Resume) { $taskVerifiedOptions.InitRun = $InitRun }
foreach ($taskVerifiedSwitch in @('StopLocalAi','RestoreLocalAi','PrepareOnly','Resume','NoTokenCache')) {
    if ($PSBoundParameters.ContainsKey($taskVerifiedSwitch) -and $PSBoundParameters[$taskVerifiedSwitch]) {
        $taskVerifiedOptions[$taskVerifiedSwitch] = $true
    }
}
& (Join-Path $PSScriptRoot 'Train-Expanded.ps1') @taskVerifiedOptions
