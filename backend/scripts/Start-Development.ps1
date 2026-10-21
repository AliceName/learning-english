param(
    [ValidateSet('http', 'https')]
    [string]$LaunchProfile = 'http'
)

$ErrorActionPreference = 'Stop'
$taskProjectPath = (Resolve-Path (Join-Path $PSScriptRoot '../EnglishLearning.Api/EnglishLearning.Api.csproj')).Path

& (Join-Path $PSScriptRoot 'Initialize-JwtSecret.ps1')

# User Secrets are loaded in Development. DOTNET_ENVIRONMENT takes precedence
# over the ASPNETCORE_ENVIRONMENT value supplied by the launch profile.
$taskPreviousEnvironment = $env:DOTNET_ENVIRONMENT
try {
    $env:DOTNET_ENVIRONMENT = 'Development'
    dotnet run --project $taskProjectPath --launch-profile $LaunchProfile
    if ($LASTEXITCODE -ne 0) { throw 'The Development API failed to start or stopped with an error.' }
}
finally {
    $env:DOTNET_ENVIRONMENT = $taskPreviousEnvironment
}
