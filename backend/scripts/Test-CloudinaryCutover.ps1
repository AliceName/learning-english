[CmdletBinding()]
param(
    [ValidateSet('Verify','CleanupDryRun','Cleanup')][string]$Mode = 'Verify',
    [string]$BackendUrl = 'http://localhost:5000',
    [string]$PlaywrightModulePath
)
$ErrorActionPreference = 'Stop'
$cutoverWorkspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$cutoverOutput = Join-Path $cutoverWorkspace 'backend/EnglishLearning.Api/bin/CloudinaryCutover'
$cutoverPreviousEnvironment = $env:ASPNETCORE_ENVIRONMENT
$cutoverPreviousPlaywright = $env:PLAYWRIGHT_MODULE_PATH
function Get-CutoverFailureHint {
    $cutoverFailurePath = Join-Path $cutoverWorkspace 'reports/Cloudinary_cutover_error.json'
    $cutoverFailureCode = $null
    if (Test-Path -LiteralPath $cutoverFailurePath) {
        try { $cutoverFailureCode = (Get-Content -LiteralPath $cutoverFailurePath -Raw | ConvertFrom-Json).errorCode } catch { }
    }
    switch ($cutoverFailureCode) {
        'backend_unreachable' { 'Backend is not reachable at BackendUrl. Start the existing API in Visual Studio, wait for Now listening on, and use -BackendUrl if its address differs.' }
        'backend_health_timeout' { 'Backend health timed out. Confirm the existing API is running and responsive.' }
        'backend_tls_validation_failed' { 'Backend HTTPS certificate validation failed. Use the configured HTTP listener or trust the local development certificate.' }
        'restart_backend_with_cutover_code_required' { 'The API does not expose the new media health endpoint. Restart the existing API with current code.' }
        'cutover_acceptance_required_before_cleanup' { 'No successful cutover acceptance exists. Complete Verify before running CleanupDryRun or Cleanup.' }
        default { 'Read reports/Cloudinary_cutover_error.json for its mode, stage and safe error code.' }
    }
}
try {
    $env:ASPNETCORE_ENVIRONMENT = 'Development'
    & dotnet build (Join-Path $cutoverWorkspace 'backend/EnglishLearning.Api/EnglishLearning.Api.csproj') --output $cutoverOutput --verbosity quiet
    if ($LASTEXITCODE -ne 0) { throw 'Cutover build failed.' }
    Push-Location (Join-Path $cutoverWorkspace 'backend/EnglishLearning.Api')
    try {
        $cutoverDll = Join-Path $cutoverOutput 'EnglishLearning.Api.dll'
        if ($Mode -eq 'Verify') {
            & dotnet $cutoverDll '--media-cutover=probe' "--media-cutover-backend=$BackendUrl"
            if ($LASTEXITCODE -ne 0) { throw ('Cutover probe failed. ' + (Get-CutoverFailureHint)) }
            $cutoverModule = if ($PlaywrightModulePath) { $PlaywrightModulePath } elseif ($env:PLAYWRIGHT_MODULE_PATH) { $env:PLAYWRIGHT_MODULE_PATH } else { Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs' }
            if (Test-Path -LiteralPath $cutoverModule) { $env:PLAYWRIGHT_MODULE_PATH = $cutoverModule }
            & node (Join-Path $cutoverWorkspace 'frontend/tests/cloudinary-cutover-browser.mjs')
            if ($LASTEXITCODE -ne 0) { throw 'Cutover browser decode/offline test failed; acceptance was not recorded.' }
            & dotnet $cutoverDll '--media-cutover=accept' "--media-cutover-backend=$BackendUrl"
        } else {
            $cutoverMode = if ($Mode -eq 'CleanupDryRun') { 'cleanup-dry-run' } else { 'cleanup' }
            & dotnet $cutoverDll "--media-cutover=$cutoverMode" "--media-cutover-backend=$BackendUrl"
        }
        if ($LASTEXITCODE -ne 0) { throw ('Cutover/cleanup did not pass. ' + (Get-CutoverFailureHint)) }
    } finally { Pop-Location }
} finally {
    $env:ASPNETCORE_ENVIRONMENT = $cutoverPreviousEnvironment
    $env:PLAYWRIGHT_MODULE_PATH = $cutoverPreviousPlaywright
}
