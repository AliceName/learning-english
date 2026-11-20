[CmdletBinding()]
param(
    [ValidateSet('Gemini', 'ChatCompletions')]
    [string]$Provider = 'Gemini',
    [string]$Model,
    [uri]$Endpoint
)

$ErrorActionPreference = 'Stop'
$translationProject = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../EnglishLearning.Api/EnglishLearning.Api.csproj')).Path

if (-not $PSBoundParameters.ContainsKey('Model')) {
    $Model = if ($Provider -eq 'Gemini') { 'gemini-3.5-flash-lite' } else { Read-Host 'Translation AI model ID' }
}
$Model = ([string]$Model).Trim()
if ([string]::IsNullOrWhiteSpace($Model) -or $Model.Length -gt 200 -or $Model -match '\s') {
    throw 'Enter a valid model ID without spaces.'
}
if ($Provider -eq 'Gemini' -and $Model -cnotmatch '^(models/)?gemini-[a-zA-Z0-9._-]+$') {
    throw 'Enter a Gemini model ID, for example gemini-3.5-flash-lite.'
}
if ($Provider -eq 'Gemini' -and $PSBoundParameters.ContainsKey('Endpoint')) {
    throw 'Gemini uses the Google API endpoint automatically. Omit -Endpoint.'
}
if ($PSBoundParameters.ContainsKey('Endpoint') -and
    (-not $Endpoint -or -not $Endpoint.IsAbsoluteUri -or $Endpoint.UserInfo -or
        -not ($Endpoint.Scheme -eq 'https' -or ($Endpoint.Scheme -eq 'http' -and $Endpoint.IsLoopback)))) {
    throw 'Use an HTTPS endpoint or a loopback HTTP endpoint.'
}

$translationSecureKey = Read-Host "$Provider API key (hidden)" -AsSecureString
try {
    $translationKey = [System.Net.NetworkCredential]::new('', $translationSecureKey).Password.Trim()
    if ([string]::IsNullOrWhiteSpace($translationKey) -or $translationKey -match '\s') {
        throw 'Enter a valid API key.'
    }

    $translationSettings = @{
        'TranslationAi:Provider' = $Provider
        'TranslationAi:ApiKey' = $translationKey
        'TranslationAi:Model' = $Model
    }
    if ($Endpoint) {
        $translationSettings['TranslationAi:Endpoint'] = $Endpoint.AbsoluteUri
    }

    # stdin keeps the key out of command history and process arguments.
    $translationSettings | ConvertTo-Json -Compress | & dotnet user-secrets set --project $translationProject *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Could not save Translation AI User Secrets.' }
    Write-Output 'Translation AI User Secrets saved. Restart the backend in Development mode.'
}
finally {
    $translationSettings = $null
    $translationKey = $null
    $translationSecureKey.Dispose()
}
