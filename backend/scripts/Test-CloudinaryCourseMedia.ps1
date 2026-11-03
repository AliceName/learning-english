[CmdletBinding()]
param([switch]$CleanupOnly)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'Test-CloudinaryEnvironment.ps1') -CourseMedia -CleanupOnly:$CleanupOnly
