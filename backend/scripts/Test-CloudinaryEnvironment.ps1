[CmdletBinding()]
param([switch]$Adapter, [switch]$DictionaryAudio, [switch]$CourseMedia, [switch]$CleanupOnly)
$ErrorActionPreference = 'Stop'
if (@($Adapter, $DictionaryAudio, $CourseMedia).Where({ $_ }).Count -gt 1) { throw 'Choose one smoke mode: Adapter, DictionaryAudio or CourseMedia.' }
if ($CleanupOnly -and -not ($Adapter -or $DictionaryAudio -or $CourseMedia)) { throw 'CleanupOnly requires a selected smoke mode.' }
$cloudinaryWorkspacePath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$cloudinaryProjectPath = Join-Path $cloudinaryWorkspacePath 'backend/EnglishLearning.Api/EnglishLearning.Api.csproj'
# Separate output avoids touching DLLs locked by the user's Visual Studio backend.
$cloudinaryOutputPath = Join-Path $cloudinaryWorkspacePath $(if ($CourseMedia) { 'backend/EnglishLearning.Api/bin/CloudinaryCourseMedia' } elseif ($DictionaryAudio) { 'backend/EnglishLearning.Api/bin/CloudinaryDictionaryAudio' } elseif ($Adapter) { 'backend/EnglishLearning.Api/bin/CloudinaryAdapter' } else { 'backend/EnglishLearning.Api/bin/CloudinaryEnvironment' })
$cloudinaryReportPath = Join-Path $cloudinaryWorkspacePath $(if ($CourseMedia) { 'reports/Cloudinary_course_media_smoke.json' } elseif ($DictionaryAudio) { 'reports/Cloudinary_dictionary_audio_smoke.json' } elseif ($Adapter) { 'reports/Cloudinary_adapter_smoke.json' } else { 'reports/Cloudinary_environment_smoke.json' })
$cloudinaryPreviousEnvironment = $env:ASPNETCORE_ENVIRONMENT
try {
    $env:ASPNETCORE_ENVIRONMENT = 'Development'
    & dotnet build $cloudinaryProjectPath --output $cloudinaryOutputPath --verbosity quiet
    if ($LASTEXITCODE -ne 0) { throw 'Cloudinary environment verification build failed.' }
    Push-Location (Join-Path $cloudinaryWorkspacePath 'backend/EnglishLearning.Api')
    try {
        # Reconcile only fixture IDs recorded by earlier failed smoke runs before creating new assets.
        if ($CleanupOnly) {
            if (-not (Test-Path -LiteralPath $cloudinaryReportPath)) { throw 'No smoke report exists to reconcile.' }
            $cloudinaryPriorReports = @(Get-Item -LiteralPath $cloudinaryReportPath)
        } else {
            $cloudinaryPriorReports = @(Get-ChildItem -LiteralPath (Join-Path $cloudinaryWorkspacePath 'reports') -Filter 'Cloudinary_environment_*failure_*.json' -File | Where-Object { $_.BaseName -notlike '*_recovery' })
            $cloudinaryPriorReports += @(Get-Item -LiteralPath (Join-Path $cloudinaryWorkspacePath 'reports/Cloudinary_adapter_smoke.json'), (Join-Path $cloudinaryWorkspacePath 'reports/Cloudinary_dictionary_audio_smoke.json'), (Join-Path $cloudinaryWorkspacePath 'reports/Cloudinary_course_media_smoke.json') -ErrorAction SilentlyContinue)
        }
        foreach ($cloudinaryPriorReport in $cloudinaryPriorReports) {
            $cloudinaryPriorData = Get-Content -LiteralPath $cloudinaryPriorReport.FullName -Raw | ConvertFrom-Json
            if (@($cloudinaryPriorData.assetsNeedingCleanup).Count -eq 0) {
                if ($CleanupOnly -and $cloudinaryPriorData.status -ne 'passed') { throw 'This smoke failed without pending cleanup; cleanup-only cannot resolve it.' }
                continue
            }
            $cloudinaryRecoveryPath = Join-Path $cloudinaryWorkspacePath ('reports/' + $cloudinaryPriorReport.BaseName + '_recovery.json')
            if (Test-Path -LiteralPath $cloudinaryRecoveryPath) {
                $cloudinaryPreviousRecovery = Get-Content -LiteralPath $cloudinaryRecoveryPath -Raw | ConvertFrom-Json
                $cloudinarySameTargets = if ($null -ne $cloudinaryPreviousRecovery.cleanupTargets) {
                    @(Compare-Object @($cloudinaryPriorData.assetsNeedingCleanup | Sort-Object -Unique) @($cloudinaryPreviousRecovery.cleanupTargets | Sort-Object -Unique)).Count -eq 0
                } else { $cloudinaryPriorReport.BaseName -like 'Cloudinary_environment_*failure_*' }
                if ($cloudinaryPreviousRecovery.status -eq 'passed' -and $cloudinaryPreviousRecovery.runPrefix -eq $cloudinaryPriorData.runPrefix -and
                    $cloudinarySameTargets -and
                    @($cloudinaryPreviousRecovery.assetsNeedingCleanup).Count -eq 0 -and @($cloudinaryPreviousRecovery.checks).Count -gt 0 -and
                    @($cloudinaryPreviousRecovery.checks | Where-Object {-not $_.passed}).Count -eq 0) { continue }
            }
            & dotnet (Join-Path $cloudinaryOutputPath 'EnglishLearning.Api.dll') '--cloudinary-smoke=true' "--cloudinary-smoke-cleanup-report=$($cloudinaryPriorReport.FullName)" "--cloudinary-smoke-report=$cloudinaryRecoveryPath"
            if ($LASTEXITCODE -ne 0) { throw 'A previous smoke cleanup could not be confirmed. See its recovery report; no new assets were uploaded.' }
        }
        if ($CleanupOnly) {
            Write-Output 'Cloudinary cleanup passed. Original smoke evidence is preserved; see its matching _recovery.json report if cleanup was needed. No new assets were uploaded.'
            return
        }
        $cloudinarySmokeMode = if ($CourseMedia) { '--cloudinary-course-smoke=true' } elseif ($DictionaryAudio) { '--cloudinary-dictionary-smoke=true' } elseif ($Adapter) { '--cloudinary-adapter-smoke=true' } else { '--cloudinary-smoke=true' }
        & dotnet (Join-Path $cloudinaryOutputPath 'EnglishLearning.Api.dll') $cloudinarySmokeMode "--cloudinary-smoke-report=$cloudinaryReportPath"
        $cloudinarySmokeExitCode = $LASTEXITCODE
    }
    finally { Pop-Location }
    if ($cloudinarySmokeExitCode -eq 2) {
        Write-Output 'Cloudinary is not configured. Run backend/scripts/Set-CloudinarySecrets.ps1 after creating your Cloudinary account.'
    }
    if ($cloudinarySmokeExitCode -ne 0) { throw "Cloudinary smoke did not pass (exit $cloudinarySmokeExitCode). See the JSON report; no secret values are included." }
    Write-Output "Cloudinary smoke passed. Report: $cloudinaryReportPath"
}
finally { $env:ASPNETCORE_ENVIRONMENT = $cloudinaryPreviousEnvironment }
