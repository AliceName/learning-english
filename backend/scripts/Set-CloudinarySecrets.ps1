[CmdletBinding()]
param(
    [ValidatePattern('^els/(dev|test)(/[a-z0-9][a-z0-9-]{0,31}){0,2}$')]
    [string]$EnvironmentPrefix = 'els/dev'
)
$ErrorActionPreference = 'Stop'
$cloudinaryProjectPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../EnglishLearning.Api/EnglishLearning.Api.csproj')).Path
$cloudinaryCloudName = (Read-Host 'Cloudinary Cloud Name').Trim()
$cloudinaryApiKey = Read-Host 'Cloudinary API Key' -AsSecureString
$cloudinaryApiSecret = Read-Host 'Cloudinary API Secret' -AsSecureString
$cloudinaryKeyPointer = [IntPtr]::Zero
$cloudinarySecretPointer = [IntPtr]::Zero
try {
    $cloudinaryKeyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($cloudinaryApiKey)
    $cloudinarySecretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($cloudinaryApiSecret)
    $cloudinaryKeyText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($cloudinaryKeyPointer)
    $cloudinarySecretText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($cloudinarySecretPointer)
    if ($cloudinaryCloudName -notmatch '^[a-zA-Z0-9_-]{1,100}$' -or $cloudinaryApiKey.Length -lt 5 -or
        $cloudinaryKeyText -notmatch '^[0-9]{5,40}$' -or $cloudinaryApiSecret.Length -lt 8 -or $cloudinarySecretText -match '\s') {
        throw 'Cloudinary credentials are missing or have an unexpected format. No values were saved.'
    }
    $cloudinarySecretPayload = @{
        'Cloudinary:Enabled' = 'true'
        'Cloudinary:CloudName' = $cloudinaryCloudName
        'Cloudinary:ApiKey' = $cloudinaryKeyText
        'Cloudinary:ApiSecret' = $cloudinarySecretText
        'Cloudinary:EnvironmentPrefix' = $EnvironmentPrefix
    } | ConvertTo-Json -Compress
    # stdin avoids placing credentials in process arguments or PowerShell command history.
    # user-secrets set merges these keys and preserves unrelated JWT/SQL/Mongo settings.
    $cloudinarySecretPayload | & dotnet user-secrets set --project $cloudinaryProjectPath | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not save Cloudinary User Secrets.' }
    Write-Output "Cloudinary User Secrets saved. Prefix: $EnvironmentPrefix. Existing media storage has not been switched."
}
finally {
    if ($cloudinaryKeyPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($cloudinaryKeyPointer) }
    if ($cloudinarySecretPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($cloudinarySecretPointer) }
    $cloudinaryKeyText = $null; $cloudinarySecretText = $null; $cloudinarySecretPayload = $null
    $cloudinaryApiKey.Dispose(); $cloudinaryApiSecret.Dispose()
}
