[CmdletBinding()]
param([switch]$SkipPublic)

$failed = 0

function Pass([string]$Message) { Write-Host "[PASS] $Message" -ForegroundColor Green }
function Fail([string]$Message) { Write-Host "[FAIL] $Message" -ForegroundColor Red; $script:failed++ }

function Test-Endpoint([string]$Label, [string]$Url, [int]$Attempts = 5) {
  $statusCode = 0
  $curlExitCode = 1
  $lastBody = ''
  $lastCurlError = ''
  $bodyFile = [System.IO.Path]::GetTempFileName()
  $errorFile = [System.IO.Path]::GetTempFileName()
  try {
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
      [System.IO.File]::WriteAllText($bodyFile, '')
      [System.IO.File]::WriteAllText($errorFile, '')
      $statusText = (& curl.exe `
        --silent --show-error `
        --connect-timeout 3 --max-time 10 `
        --output $bodyFile --stderr $errorFile `
        --write-out '%{http_code}' $Url | Out-String).Trim()
      $curlExitCode = $LASTEXITCODE
      $statusCode = 0
      $parsed = [int]::TryParse($statusText, [ref]$statusCode)
      $lastBody = [System.Convert]::ToString((Get-Content -LiteralPath $bodyFile -Raw -ErrorAction SilentlyContinue))
      $lastCurlError = [System.Convert]::ToString((Get-Content -LiteralPath $errorFile -Raw -ErrorAction SilentlyContinue))
      $lastBody = $lastBody.Trim()
      $lastCurlError = $lastCurlError.Trim()
      if ($curlExitCode -eq 0 -and $parsed -and $statusCode -ge 200 -and $statusCode -lt 400) { break }
      if ($attempt -lt $Attempts) { Start-Sleep -Seconds 2 }
    }
  }
  finally {
    Remove-Item -LiteralPath $bodyFile, $errorFile -Force -ErrorAction SilentlyContinue
  }

  if ($curlExitCode -ne 0 -or $statusCode -eq 0) {
    $detail = if ($lastCurlError) { ": $lastCurlError" } else { '' }
    Fail "$Label could not be reached after $Attempts attempts$detail"
    return
  }
  # 3xx is healthy here: the affiliate root intentionally redirects to /login.
  if ($statusCode -ge 200 -and $statusCode -lt 400) {
    Pass "$Label ($statusCode)"
  }
  else {
    $detail = if ($lastBody) { " | response: $lastBody" } else { '' }
    Fail "$Label returned $statusCode$detail"
  }
}

Write-Host 'PM2 processes' -ForegroundColor Cyan
foreach ($name in @('affiliate-backend', 'affiliate-web', 'affiliate-marketing')) {
  # Do not parse `pm2 jlist` with Windows PowerShell: environment keys such as
  # USERNAME/username are case-insensitive there and can break ConvertFrom-Json.
  $runningPids = @()
  for ($attempt = 1; $attempt -le 15; $attempt++) {
    $pidText = (& pm2 pid $name 2>$null | Out-String)
    $runningPids = [regex]::Matches($pidText, '(?m)^\s*([1-9][0-9]*)\s*$')
    if ($runningPids.Count -gt 0) { break }
    if ($attempt -lt 15) { Start-Sleep -Seconds 1 }
  }
  if ($runningPids.Count -gt 0) { Pass "$name online" }
  else { Fail "$name is not online" }
}

Write-Host 'Local services' -ForegroundColor Cyan
# Liveness distinguishes a backend startup/listener failure from a dependency
# readiness failure. Readiness prints its JSON body (db/redis) when degraded.
Test-Endpoint 'API liveness' 'http://127.0.0.1:4100/v1/health' 15
Test-Endpoint 'API readiness (database + Redis)' 'http://127.0.0.1:4100/v1/health/ready' 15
Test-Endpoint 'Affiliate app' 'http://127.0.0.1:3100'
Test-Endpoint 'Marketing website' 'http://127.0.0.1:3002'

if (-not $SkipPublic) {
  Write-Host 'Cloudflare public routes' -ForegroundColor Cyan
  Test-Endpoint 'Public API readiness' 'https://affiliate.mentoringhub.online/v1/health/ready'
  Test-Endpoint 'Public affiliate app' 'https://affiliate.mentoringhub.online'
  Test-Endpoint 'Public marketing website' 'https://web.mentoringhub.online'
}

if ($failed -gt 0) {
  Write-Host "$failed check(s) failed." -ForegroundColor Red
  exit 1
}
Write-Host 'All checks passed.' -ForegroundColor Green

