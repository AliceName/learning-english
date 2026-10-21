$ErrorActionPreference = 'Stop'
$taskProjectPath = (Resolve-Path (Join-Path $PSScriptRoot '../EnglishLearning.Api/EnglishLearning.Api.csproj')).Path
$taskProjectXml = [xml](Get-Content -LiteralPath $taskProjectPath -Raw)
$taskSecretsId = [string]$taskProjectXml.Project.PropertyGroup.UserSecretsId
if (-not $taskSecretsId) { throw 'The API project must declare UserSecretsId.' }
if ($env:Jwt__SigningKey) { Write-Output 'JWT signing key is configured through the environment.'; return }

$taskSecretsPath = Join-Path $env:APPDATA ('Microsoft/UserSecrets/' + $taskSecretsId + '/secrets.json')
if (Test-Path -LiteralPath $taskSecretsPath) {
    $taskSecrets = Get-Content -LiteralPath $taskSecretsPath -Raw | ConvertFrom-Json
    if ($taskSecrets.'Jwt:SigningKey' -or $taskSecrets.Jwt.SigningKey) {
        Write-Output 'JWT signing key is already configured in User Secrets.'
        return
    }
}

$taskKeyBytes = New-Object byte[] 64
$taskRandom = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $taskRandom.GetBytes($taskKeyBytes) } finally { $taskRandom.Dispose() }
$taskSigningKey = [Convert]::ToBase64String($taskKeyBytes)
dotnet user-secrets set 'Jwt:SigningKey' $taskSigningKey --project $taskProjectPath
if ($LASTEXITCODE -ne 0) { throw 'Could not save the JWT signing key.' }
Write-Output 'JWT signing key saved in User Secrets. No secret value was printed.'
