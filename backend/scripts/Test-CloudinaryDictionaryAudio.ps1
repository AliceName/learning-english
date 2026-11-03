[CmdletBinding()]
param([switch]$CleanupOnly)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'Test-CloudinaryEnvironment.ps1') -DictionaryAudio -CleanupOnly:$CleanupOnly
