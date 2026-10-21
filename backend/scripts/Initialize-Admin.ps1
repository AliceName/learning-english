[CmdletBinding()]
param(
    # Reads the saved local credentials only; does not provision or reset an account.
    [switch]$ShowCredentials
)

$ErrorActionPreference = 'Stop'
$taskProjectPath = (Resolve-Path (Join-Path $PSScriptRoot '../EnglishLearning.Api/EnglishLearning.Api.csproj')).Path
$taskProjectXml = [xml](Get-Content -LiteralPath $taskProjectPath -Raw)
$taskSecretsId = [string]$taskProjectXml.Project.PropertyGroup.UserSecretsId
if (-not $taskSecretsId) { throw 'The API project must declare UserSecretsId.' }
$taskSecretsPath = Join-Path $env:APPDATA ('Microsoft/UserSecrets/' + $taskSecretsId + '/secrets.json')
$taskSecrets = if (Test-Path -LiteralPath $taskSecretsPath) { Get-Content -LiteralPath $taskSecretsPath -Raw | ConvertFrom-Json } else { $null }
$taskEmail = $taskSecrets.'BootstrapAdmin:Email'
if (-not $taskEmail) { $taskEmail = $taskSecrets.BootstrapAdmin.Email }
$taskPassword = $taskSecrets.'BootstrapAdmin:Password'
if (-not $taskPassword) { $taskPassword = $taskSecrets.BootstrapAdmin.Password }
$taskFullName = $taskSecrets.'BootstrapAdmin:FullName'
if (-not $taskFullName) { $taskFullName = $taskSecrets.BootstrapAdmin.FullName }

if ($ShowCredentials) {
    if (-not $taskEmail -or -not $taskPassword) { throw 'No saved admin credentials. Run Initialize-Admin.ps1 first.' }
    [PSCustomObject]@{ Email = $taskEmail; Password = $taskPassword }
    return
}

if (-not $taskEmail) { $taskEmail = 'admin@linguaai.local' }
if (-not $taskFullName) { $taskFullName = 'Quản trị viên' }
if (-not $taskPassword) {
    $taskBytes = New-Object byte[] 24
    $taskRandom = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $taskRandom.GetBytes($taskBytes) } finally { $taskRandom.Dispose() }
    $taskPassword = [Convert]::ToBase64String($taskBytes)
}

# Use stdin so credentials do not appear in process arguments or shell history.
$taskPreviousOutputEncoding = $OutputEncoding
try {
    $OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    @{
        'BootstrapAdmin:Email' = $taskEmail.Trim().ToLowerInvariant()
        'BootstrapAdmin:FullName' = $taskFullName.Trim()
        'BootstrapAdmin:Password' = $taskPassword
    } | ConvertTo-Json -Compress | dotnet user-secrets set --project $taskProjectPath | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not save admin credentials in User Secrets.' }
} finally { $OutputEncoding = $taskPreviousOutputEncoding }

$taskOldDotnetEnvironment = $env:DOTNET_ENVIRONMENT
$taskOldAspnetEnvironment = $env:ASPNETCORE_ENVIRONMENT
try {
    $env:DOTNET_ENVIRONMENT = 'Development'
    $env:ASPNETCORE_ENVIRONMENT = 'Development'
    dotnet run --project $taskProjectPath --configuration Release --no-launch-profile -- --bootstrap-admin=true
    if ($LASTEXITCODE -ne 0) { throw 'Admin provisioning failed. Check connection settings and apply migration 002 first.' }
} finally {
    $env:DOTNET_ENVIRONMENT = $taskOldDotnetEnvironment
    $env:ASPNETCORE_ENVIRONMENT = $taskOldAspnetEnvironment
}
Write-Output 'Admin is ready. Credentials are stored in User Secrets; use -ShowCredentials to view them locally.'
