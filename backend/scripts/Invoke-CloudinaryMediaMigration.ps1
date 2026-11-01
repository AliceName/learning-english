[CmdletBinding()]
param(
    [ValidateSet('DryRun','Apply','Verify','All')][string]$Mode = 'DryRun',
    [string]$PlanPath,
    [string]$BackupRoot
)
$ErrorActionPreference = 'Stop'
$migrationWorkspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$migrationProject = Join-Path $migrationWorkspace 'backend/EnglishLearning.Api/EnglishLearning.Api.csproj'
$migrationOutput = Join-Path $migrationWorkspace 'backend/EnglishLearning.Api/bin/CloudinaryMigration'
$migrationPreviousEnvironment = $env:ASPNETCORE_ENVIRONMENT
try {
    $env:ASPNETCORE_ENVIRONMENT = 'Development'
    & dotnet build $migrationProject --output $migrationOutput --verbosity quiet
    if ($LASTEXITCODE -ne 0) { throw 'Media migration build failed.' }
    $migrationMode = if ($Mode -eq 'DryRun') { 'dry-run' } else { $Mode.ToLowerInvariant() }
    $migrationArguments = @((Join-Path $migrationOutput 'EnglishLearning.Api.dll'), "--media-migration=$migrationMode")
    if ($PlanPath) { $migrationArguments += "--media-migration-plan=$([System.IO.Path]::GetFullPath($PlanPath))" }
    if ($BackupRoot) { $migrationArguments += "--media-migration-backup-root=$([System.IO.Path]::GetFullPath($BackupRoot))" }
    Push-Location (Join-Path $migrationWorkspace 'backend/EnglishLearning.Api')
    try { & dotnet @migrationArguments; $migrationExitCode = $LASTEXITCODE } finally { Pop-Location }
    if ($migrationExitCode -ne 0) { throw 'Media migration did not verify all items. Read reports/Cloudinary_media_migration_*.json; source files were not deleted.' }
    Write-Output "Media migration $Mode finished. Reports: $(Join-Path $migrationWorkspace 'reports'). Source files were not deleted."
} finally { $env:ASPNETCORE_ENVIRONMENT = $migrationPreviousEnvironment }
