[CmdletBinding()]
param([string]$InstallPath = 'E:\Programs\Affiliate-Platform-Live')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$failed = 0
function Pass([string]$Message) { Write-Host "[PASS] $Message" -ForegroundColor Green }
function Fail([string]$Message) { Write-Host "[FAIL] $Message" -ForegroundColor Red; $script:failed++ }

$rawNodeVersion = (& node -p "process.versions.node" | Out-String).Trim()
try { $nodeVersion = [version]$rawNodeVersion }
catch { $nodeVersion = [version]'0.0.0' }
if ($nodeVersion -ge [version]'20.11.0') { Pass "Node.js $rawNodeVersion" }
else { Fail "Node.js 20.11.0+ is required; installed $rawNodeVersion" }

foreach ($app in @('backend', 'web', 'marketing')) {
  $packageLock = Join-Path $InstallPath "$app\package-lock.json"
  if (-not (Test-Path -LiteralPath $packageLock -PathType Leaf)) {
    Fail "$app package-lock.json is missing"
    continue
  }
  Push-Location $InstallPath
  try {
    & npm --prefix $app audit --package-lock-only --omit=dev --audit-level=high
    if ($LASTEXITCODE -eq 0) { Pass "$app npm audit" }
    else { Fail "$app npm audit reported a known vulnerability" }
  }
  finally { Pop-Location }
}

$service = Get-CimInstance Win32_Service -Filter "Name='cloudflared'"
if ($null -eq $service) {
  Fail 'cloudflared Windows service is not installed'
}
elseif ($service.State -ne 'Running' -or $service.StartMode -ne 'Auto') {
  Fail 'cloudflared Windows service is not Running with Automatic startup'
}
else {
  $serviceCommand = [string]$service.PathName
  $serviceExe = $null
  if ($serviceCommand -match '^\s*"([^"]+\.exe)"') { $serviceExe = $Matches[1] }
  elseif ($serviceCommand -match '^\s*(\S+\.exe)') { $serviceExe = $Matches[1] }
  if ([string]::IsNullOrWhiteSpace($serviceExe) -or
      -not (Test-Path -LiteralPath $serviceExe -PathType Leaf)) {
    Fail 'cloudflared service executable could not be resolved'
  }
  else {
    $cloudflaredVersion = (& $serviceExe --version | Out-String).Trim()
    Pass "$cloudflaredVersion; Windows service Running/Automatic"
  }
}

if ($failed -gt 0) {
  Write-Host "$failed security check(s) failed." -ForegroundColor Red
  exit 1
}

Write-Host 'All dependency and runtime security checks passed.' -ForegroundColor Green
