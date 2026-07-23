[CmdletBinding()]
param(
  [string]$ServiceName = 'cloudflared',
  [int]$StartTimeoutSeconds = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this updater from an Administrator PowerShell window.'
}

$service = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'"
if ($null -eq $service) {
  throw "Windows service '$ServiceName' is not installed. The existing tunnel was not changed."
}

$imagePath = [string]$service.PathName
$cloudflared = $null
if ($imagePath -match '^\s*"([^"]+\.exe)"') {
  $cloudflared = $Matches[1]
}
elseif ($imagePath -match '^\s*(\S+\.exe)') {
  $cloudflared = $Matches[1]
}
if ([string]::IsNullOrWhiteSpace($cloudflared) -or
    -not (Test-Path -LiteralPath $cloudflared -PathType Leaf)) {
  throw "Could not resolve the cloudflared executable used by service '$ServiceName'. Service command: $imagePath"
}

$configPath = $null
if ($imagePath -match '(?i)--config(?:=|\s+)(?:"([^"]+)"|(\S+))') {
  if ($Matches[1]) { $configPath = $Matches[1] } else { $configPath = $Matches[2] }
}

if ($configPath -and (Test-Path -LiteralPath $configPath -PathType Leaf)) {
  & $cloudflared "--config=$configPath" tunnel ingress validate
  if ($LASTEXITCODE -ne 0) { throw "Cloudflare ingress config is invalid: $configPath" }
}

$beforeVersion = (& $cloudflared --version | Out-String).Trim()
Write-Host "Before: $beforeVersion" -ForegroundColor Cyan

try { Stop-Service -Name $ServiceName -Force -ErrorAction Stop }
catch { Write-Warning "Normal service stop did not complete: $($_.Exception.Message)" }
Start-Sleep -Seconds 3

$service = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'"
if ($service.ProcessId -gt 0) {
  # Only the exact PID registered to the cloudflared service is terminated.
  Stop-Process -Id $service.ProcessId -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}

$afterVersion = $beforeVersion
$updateFailure = $null
try {
  # cloudflared writes informational "up to date" messages to stderr. With
  # ErrorActionPreference=Stop, Windows PowerShell turns that harmless stderr
  # stream into a terminating NativeCommandError before we can inspect it.
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $updateOutput = @(& $cloudflared update 2>&1)
    $updateCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousPreference
  }
  $updateText = ($updateOutput | Out-String).Trim()
  if ($updateText) { Write-Host $updateText }

  $afterVersion = (& $cloudflared --version | Out-String).Trim()
  $updateConfirmed = ($afterVersion -ne $beforeVersion) -or
    ($updateText -match '(?i)has been updated|already.*(?:latest|up.to.date)|is up.to.date')
  if ($updateCode -ne 0 -and -not $updateConfirmed) {
    throw "cloudflared update failed with exit code $updateCode."
  }
}
catch {
  # Record the updater error, but restore tunnel availability before reporting it.
  $updateFailure = $_.Exception
}

Set-Service -Name $ServiceName -StartupType Automatic
Start-Service -Name $ServiceName

$deadline = (Get-Date).AddSeconds($StartTimeoutSeconds)
do {
  Start-Sleep -Seconds 2
  $service = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'"
} while ($service.State -ne 'Running' -and (Get-Date) -lt $deadline)

if ($service.State -ne 'Running') {
  throw "cloudflared was updated but the Windows service did not stay running. Current state: $($service.State)"
}

if ($null -ne $updateFailure) {
  throw "Cloudflared update failed, but the existing service was restarted. Existing tunnel files and routes were not changed. $($updateFailure.Message)"
}

Write-Host "After:  $afterVersion" -ForegroundColor Green
Write-Host "Service: $($service.State), startup Automatic, PID $($service.ProcessId)" -ForegroundColor Green
Write-Host 'Existing tunnel credentials, ingress rules and DNS routes were preserved.' -ForegroundColor Green
