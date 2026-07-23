[CmdletBinding()]
param(
  [string]$ZipPath = (Join-Path $env:USERPROFILE 'Downloads\Affiliate-Platform-mentoringhub-portal-v7.2.zip'),
  [string]$InstallPath = 'E:\Programs\Affiliate-Platform-Live',
  [switch]$BaselineExistingDatabase,
  [string]$AdminEmail = '',
  [string]$AdminName = 'Platform Admin',
  [Security.SecureString]$AdminPassword,
  [switch]$SkipAdminBootstrap,
  [switch]$SkipCloudflaredUpdate
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Invoke-Checked {
  param([string]$File, [string[]]$Arguments)
  $displayCommand = "$File $($Arguments -join ' ')".Trim()
  Write-Host "Running: $displayCommand" -ForegroundColor DarkCyan
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code $LASTEXITCODE`: $displayCommand"
  }
}

function Invoke-RobocopyMirror {
  param([string]$Source, [string]$Destination, [switch]$ExcludeNodeModules)
  if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
    throw "Mirror source does not exist: $Source"
  }
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  $robocopyArguments = @(
    $Source, $Destination, '/MIR', '/COPY:DAT', '/DCOPY:DAT',
    '/R:10', '/W:2', '/XJ', '/NP'
  )
  if ($ExcludeNodeModules) {
    # Exclude only the three top-level development dependency trees. Next.js
    # standalone builds contain their own traced node_modules directories and
    # those are release artifacts that must reach the live directory.
    $robocopyArguments += '/XD'
    foreach ($component in @('backend', 'web', 'marketing')) {
      $robocopyArguments += (Join-Path (Join-Path $Source $component) 'node_modules')
    }
  }

  $script:robocopyLogSequence++
  New-Item -ItemType Directory -Path $script:robocopyLogDirectory -Force | Out-Null
  $robocopyLog = Join-Path $script:robocopyLogDirectory "robocopy-$($script:robocopyLogSequence).log"
  $robocopyArguments += "/LOG:$robocopyLog"

  Write-Host "Robocopy: $Source -> $Destination" -ForegroundColor DarkCyan
  & robocopy.exe @robocopyArguments
  $code = $LASTEXITCODE
  # Robocopy uses 0-7 for successful/no-op/copy-with-extra-file outcomes.
  if ($code -gt 7) {
    Write-Host ''
    Write-Host 'Robocopy failure details:' -ForegroundColor Red
    if (Test-Path -LiteralPath $robocopyLog) {
      Get-Content -LiteralPath $robocopyLog -Tail 160 | ForEach-Object { Write-Host $_ }
    }
    throw "Robocopy failed with exit code $code ($Source -> $Destination). Detailed log: $robocopyLog"
  }
}

function Move-ProjectDependencies {
  param([string]$SourceRoot, [string]$DestinationRoot)

  $moved = New-Object System.Collections.Generic.List[string]
  try {
    foreach ($component in @('backend', 'web', 'marketing')) {
      $source = Join-Path (Join-Path $SourceRoot $component) 'node_modules'
      if (-not (Test-Path -LiteralPath $source -PathType Container)) { continue }
      $destinationParent = Join-Path $DestinationRoot $component
      $destination = Join-Path $destinationParent 'node_modules'
      New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
      if (Test-Path -LiteralPath $destination) {
        throw "Dependency backup destination already exists: $destination"
      }
      Move-Item -LiteralPath $source -Destination $destination -ErrorAction Stop
      $moved.Add($component)
    }
  }
  catch {
    # A partial dependency move must not leave the currently running release
    # incomplete. Put every already-moved tree back before reporting failure.
    foreach ($component in @($moved)) {
      $saved = Join-Path (Join-Path $DestinationRoot $component) 'node_modules'
      $originalParent = Join-Path $SourceRoot $component
      if (Test-Path -LiteralPath $saved) {
        New-Item -ItemType Directory -Path $originalParent -Force | Out-Null
        Move-Item -LiteralPath $saved -Destination (Join-Path $originalParent 'node_modules') -ErrorAction Stop
      }
    }
    throw
  }
  return @($moved)
}

function Invoke-Pm2BestEffort {
  param([string[]]$Arguments)
  $previousPreference = $ErrorActionPreference
  try {
    # PM2 returns an error when a named process does not exist. That is harmless
    # during replacement, so suppress every PowerShell/native output stream.
    $ErrorActionPreference = 'SilentlyContinue'
    & pm2 @Arguments *> $null
  }
  catch {}
  finally { $ErrorActionPreference = $previousPreference }
}

function Assert-NodeRuntime {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($null -eq $nodeCommand) { throw 'Node.js is not installed or is not available in PATH.' }
  $rawVersion = (& node -p "process.versions.node" | Out-String).Trim()
  try { $version = [version]$rawVersion }
  catch { throw "Could not parse the installed Node.js version: $rawVersion" }
  if ($version -lt [version]'20.11.0') {
    throw "Node.js 20.11.0 or newer is required. Installed version: $rawVersion"
  }
  Write-Host "Node.js runtime: $rawVersion" -ForegroundColor Green
}

function Test-TcpEndpoint {
  param([string]$ComputerName, [int]$Port)
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    # Test-NetConnection can display a persistent progress UI and wait for a
    # long ICMP fallback on Windows. A bounded TCP connect is faster and quiet.
    $connect = $client.ConnectAsync($ComputerName, $Port)
    if (-not $connect.Wait(3000)) { return $false }
    return $client.Connected
  }
  catch { return $false }
  finally { $client.Dispose() }
}

function Assert-CacheReady {
  param([string]$EnvPath)

  $redisHost = Get-EnvValue -Path $EnvPath -Name 'REDIS_HOST'
  if ([string]::IsNullOrWhiteSpace($redisHost) -or $redisHost -ieq 'localhost') {
    $redisHost = '127.0.0.1'
    Set-EnvValue -Path $EnvPath -Name 'REDIS_HOST' -Value $redisHost
  }
  $rawPort = Get-EnvValue -Path $EnvPath -Name 'REDIS_PORT'
  $redisPort = 6379
  if (-not [string]::IsNullOrWhiteSpace($rawPort) -and -not [int]::TryParse($rawPort, [ref]$redisPort)) {
    throw "Invalid REDIS_PORT in backend\.env: $rawPort"
  }

  if (Test-TcpEndpoint -ComputerName $redisHost -Port $redisPort) {
    Write-Host "Redis/Memurai reachable at $redisHost`:$redisPort" -ForegroundColor Green
    return
  }

  if (@('127.0.0.1', '::1') -contains $redisHost) {
    $cacheService = Get-Service -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match 'Memurai|Redis' -or $_.DisplayName -match 'Memurai|Redis' } |
      Select-Object -First 1
    if ($null -ne $cacheService) {
      Write-Host "Starting cache service: $($cacheService.Name)" -ForegroundColor Cyan
      if ($cacheService.Status -ne 'Running') { Start-Service -Name $cacheService.Name }
      Start-Sleep -Seconds 4
    }
  }

  if (-not (Test-TcpEndpoint -ComputerName $redisHost -Port $redisPort)) {
    throw "Redis/Memurai is not reachable at $redisHost`:$redisPort. Start the cache service before deploying; the live project was not changed."
  }
  Write-Host "Redis/Memurai reachable at $redisHost`:$redisPort" -ForegroundColor Green
}

function Assert-ProductionEnvironment {
  param([string]$EnvPath)

  $required = @('DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY', 'CORS_ORIGIN')
  $missing = @($required | Where-Object { [string]::IsNullOrWhiteSpace((Get-EnvValue -Path $EnvPath -Name $_)) })
  if ($missing.Count -gt 0) {
    throw "Production backend environment is incomplete: $($missing -join ', ')"
  }

  $secretNames = @('JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY')
  $secretValues = @($secretNames | ForEach-Object { Get-EnvValue -Path $EnvPath -Name $_ })
  $unsafe = New-Object System.Collections.Generic.List[string]
  for ($i = 0; $i -lt $secretNames.Count; $i++) {
    if ($secretValues[$i].Length -lt 32 -or $secretValues[$i] -match 'change-me|replace_with|example|password') {
      $unsafe.Add($secretNames[$i])
    }
  }
  if ($unsafe.Count -gt 0) {
    throw "Production secrets are insecure or placeholders: $($unsafe -join ', '). Fix backend\.env before deploying; secret values were not printed."
  }
  if (@($secretValues | Select-Object -Unique).Count -ne $secretValues.Count) {
    throw 'JWT_ACCESS_SECRET, JWT_REFRESH_SECRET and ENCRYPTION_KEY must all be different.'
  }
  $cors = Get-EnvValue -Path $EnvPath -Name 'CORS_ORIGIN'
  if (@($cors.Split(',') | ForEach-Object { $_.Trim() }) -contains '*') {
    throw 'Wildcard CORS is not permitted in production.'
  }
}

function Test-CandidateBackend {
  param([string]$WorkingDirectory, [string]$DiagnosticDirectory)

  $candidatePort = 4199
  if (Test-TcpEndpoint -ComputerName '127.0.0.1' -Port $candidatePort) {
    throw "Candidate preflight port $candidatePort is already in use. Free that port and run deployment again."
  }

  New-Item -ItemType Directory -Path $DiagnosticDirectory -Force | Out-Null
  $stdoutPath = Join-Path $DiagnosticDirectory 'candidate-backend-out.log'
  $stderrPath = Join-Path $DiagnosticDirectory 'candidate-backend-error.log'
  $bodyPath = Join-Path $DiagnosticDirectory 'candidate-readiness.json'
  $curlErrorPath = Join-Path $DiagnosticDirectory 'candidate-curl-error.log'
  $previousPort = [Environment]::GetEnvironmentVariable('API_PORT', 'Process')
  $process = $null
  try {
    [Environment]::SetEnvironmentVariable('API_PORT', [string]$candidatePort, 'Process')
    $process = Start-Process `
      -FilePath (Get-Command node -ErrorAction Stop).Source `
      -ArgumentList @('dist/main.js') `
      -WorkingDirectory $WorkingDirectory `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath `
      -WindowStyle Hidden `
      -PassThru
  }
  finally {
    [Environment]::SetEnvironmentVariable('API_PORT', $previousPort, 'Process')
  }

  $ready = $false
  try {
    for ($attempt = 1; $attempt -le 30; $attempt++) {
      $process.Refresh()
      if ($process.HasExited) { break }
      $status = (& curl.exe `
        --silent `
        --connect-timeout 2 --max-time 5 `
        --output $bodyPath --stderr $curlErrorPath `
        --write-out '%{http_code}' `
        "http://127.0.0.1:$candidatePort/v1/health/ready" | Out-String).Trim()
      if ($LASTEXITCODE -eq 0 -and $status -eq '200') {
        $ready = $true
        break
      }
      Start-Sleep -Seconds 2
    }
  }
  finally {
    if ($null -ne $process) {
      $process.Refresh()
      if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
      try { $process.WaitForExit(5000) | Out-Null } catch {}
    }
  }

  if (-not $ready) {
    Write-Host ''
    Write-Host 'Candidate backend preflight failed. Recent backend output:' -ForegroundColor Red
    foreach ($log in @($stderrPath, $stdoutPath, $bodyPath, $curlErrorPath)) {
      if (Test-Path -LiteralPath $log) {
        Write-Host "--- $([System.IO.Path]::GetFileName($log)) ---" -ForegroundColor Yellow
        Get-Content -LiteralPath $log -Tail 120 | ForEach-Object { Write-Host $_ }
      }
    }
    throw 'Candidate API did not become ready on temporary port 4199. The current live project was not changed; diagnostic logs are being saved.'
  }
  Write-Host 'Candidate API preflight passed (backend + database + Redis).' -ForegroundColor Green
}

function Save-DeploymentDiagnostics {
  param([string]$Directory, [string]$LivePath, [string]$TemporaryPath)

  New-Item -ItemType Directory -Path $Directory -Force | Out-Null
  if (Test-Path -LiteralPath $TemporaryPath) {
    Get-ChildItem -LiteralPath $TemporaryPath -Filter 'candidate-*' -File -ErrorAction SilentlyContinue |
      Copy-Item -Destination $Directory -Force
  }
  $runtimeLogs = Join-Path $LivePath 'logs'
  if (Test-Path -LiteralPath $runtimeLogs -PathType Container) {
    $savedRuntimeLogs = Join-Path $Directory 'runtime-logs'
    New-Item -ItemType Directory -Path $savedRuntimeLogs -Force | Out-Null
    Get-ChildItem -LiteralPath $runtimeLogs -File -ErrorAction SilentlyContinue | ForEach-Object {
      # Keep the bundle shareable even if PM2 logs have grown for months.
      Get-Content -LiteralPath $_.FullName -Tail 1000 -ErrorAction SilentlyContinue |
        Out-File (Join-Path $savedRuntimeLogs $_.Name) -Encoding utf8
    }
  }

  if ($pm2Available) {
    & pm2 status *> (Join-Path $Directory 'pm2-status.txt')
    foreach ($name in @('affiliate-backend', 'affiliate-web', 'affiliate-marketing')) {
      & pm2 describe $name *> (Join-Path $Directory "pm2-$name-describe.txt")
      & pm2 logs $name --lines 250 --nostream *> (Join-Path $Directory "pm2-$name-logs.txt")
    }
  }

  Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { @(3002, 3100, 4100, 4199, 6379) -contains $_.LocalPort } |
    Sort-Object LocalPort |
    Format-List * | Out-File (Join-Path $Directory 'listening-ports.txt') -Encoding utf8
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Select-Object ProcessId, ParentProcessId, ExecutablePath, CommandLine |
    Format-List | Out-File (Join-Path $Directory 'node-processes.txt') -Encoding utf8

  foreach ($probe in @(
    @{ Name = 'api-liveness'; Url = 'http://127.0.0.1:4100/v1/health' },
    @{ Name = 'api-readiness'; Url = 'http://127.0.0.1:4100/v1/health/ready' }
  )) {
    & curl.exe --silent --show-error --include --connect-timeout 3 --max-time 10 $probe.Url `
      *> (Join-Path $Directory "$($probe.Name).txt")
  }
}

function Prepare-NextStandalone {
  param([string]$ApplicationPath)

  $nextPath = Join-Path $ApplicationPath '.next'
  $standalonePath = Join-Path $nextPath 'standalone'
  $serverPath = Join-Path $standalonePath 'server.js'
  if (-not (Test-Path -LiteralPath $serverPath -PathType Leaf)) {
    throw "Next.js standalone server was not generated: $serverPath"
  }

  $staticSource = Join-Path $nextPath 'static'
  $staticDestination = Join-Path (Join-Path $standalonePath '.next') 'static'
  New-Item -ItemType Directory -Path $staticDestination -Force | Out-Null
  if (Test-Path -LiteralPath $staticSource -PathType Container) {
    Copy-Item -Path (Join-Path $staticSource '*') -Destination $staticDestination -Recurse -Force
  }

  $publicSource = Join-Path $ApplicationPath 'public'
  $publicDestination = Join-Path $standalonePath 'public'
  New-Item -ItemType Directory -Path $publicDestination -Force | Out-Null
  if (Test-Path -LiteralPath $publicSource -PathType Container) {
    Copy-Item -Path (Join-Path $publicSource '*') -Destination $publicDestination -Recurse -Force
  }
}

function ConvertFrom-SecureAdminPassword {
  param([Security.SecureString]$Value)
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Assert-AdminPasswordStrength {
  param([string]$Value)
  $failures = New-Object System.Collections.Generic.List[string]
  if ($Value.Length -lt 12) { $failures.Add('12 or more characters') }
  if ($Value -cnotmatch '[a-z]') { $failures.Add('a lowercase letter') }
  if ($Value -cnotmatch '[A-Z]') { $failures.Add('an uppercase letter') }
  if ($Value -notmatch '[0-9]') { $failures.Add('a number') }
  if ($Value -notmatch '[^A-Za-z0-9]') { $failures.Add('a symbol') }
  if ($failures.Count -gt 0) {
    throw "The super-admin password must contain: $($failures -join ', ')."
  }
}

function Invoke-SuperAdminBootstrap {
  param(
    [string]$WorkingDirectory,
    [string]$Email,
    [string]$Name,
    [string]$PlainPassword
  )
  $oldEmail = [Environment]::GetEnvironmentVariable('ADMIN_EMAIL', 'Process')
  $oldName = [Environment]::GetEnvironmentVariable('ADMIN_NAME', 'Process')
  $oldPassword = [Environment]::GetEnvironmentVariable('ADMIN_PASSWORD', 'Process')
  try {
    [Environment]::SetEnvironmentVariable('ADMIN_EMAIL', $Email, 'Process')
    [Environment]::SetEnvironmentVariable('ADMIN_NAME', $Name, 'Process')
    [Environment]::SetEnvironmentVariable('ADMIN_PASSWORD', $PlainPassword, 'Process')
    Push-Location $WorkingDirectory
    try { Invoke-Checked 'npm' @('run', 'admin:ensure') } finally { Pop-Location }
  }
  finally {
    [Environment]::SetEnvironmentVariable('ADMIN_EMAIL', $oldEmail, 'Process')
    [Environment]::SetEnvironmentVariable('ADMIN_NAME', $oldName, 'Process')
    [Environment]::SetEnvironmentVariable('ADMIN_PASSWORD', $oldPassword, 'Process')
  }
}

function Stop-ProjectPm2Apps {
  if (-not $pm2Available) { return }

  $names = New-Object System.Collections.Generic.List[string]
  foreach ($knownName in @('affiliate-backend', 'affiliate-api', 'affiliate-web', 'affiliate-marketing')) {
    $names.Add($knownName)
  }

  # Also stop any PM2 app whose cwd is inside this exact project, even if it was
  # previously started with a different name. Unrelated projects are untouched.
  try {
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    $raw = (& pm2 jlist 2>$null | Out-String)
    $ErrorActionPreference = $previousPreference
    if (-not [string]::IsNullOrWhiteSpace($raw)) {
      $apps = @($raw | ConvertFrom-Json)
      foreach ($app in $apps) {
        $cwd = [string]$app.pm2_env.pm_cwd
        if ($cwd -and $cwd.StartsWith($InstallPath, [System.StringComparison]::OrdinalIgnoreCase)) {
          $names.Add([string]$app.name)
        }
      }
    }
  }
  catch { $ErrorActionPreference = $previousPreference }

  foreach ($name in @($names | Select-Object -Unique)) {
    Invoke-Pm2BestEffort @('stop', $name)
    Invoke-Pm2BestEffort @('delete', $name)
  }
  Start-Sleep -Seconds 3

  # Next.js can leave child node.exe processes alive for a few seconds after
  # PM2 exits. Those children keep node_modules locked and make Robocopy fail
  # with code 8/11. Stop only processes that are provably owned by this app:
  # either their command line contains this exact InstallPath, or they are
  # listening on one of the three reserved affiliate ports.
  $processIds = New-Object System.Collections.Generic.HashSet[int]
  $pathPattern = [regex]::Escape($InstallPath.TrimEnd('\'))
  try {
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and $_.CommandLine -match $pathPattern } |
      ForEach-Object { [void]$processIds.Add([int]$_.ProcessId) }
  }
  catch {}

  try {
    Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
      Where-Object { @(3100, 3002, 4100) -contains $_.LocalPort } |
      ForEach-Object { [void]$processIds.Add([int]$_.OwningProcess) }
  }
  catch {}

  foreach ($processId in $processIds) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
  if ($processIds.Count -gt 0) { Start-Sleep -Seconds 5 }

  $lockedPorts = @(
    Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
      Where-Object { @(3100, 3002, 4100) -contains $_.LocalPort }
  )
  if ($lockedPorts.Count -gt 0) {
    throw "Affiliate runtime ports are still locked after stopping PM2: $((($lockedPorts | Select-Object -ExpandProperty LocalPort -Unique) -join ', '))"
  }
}

function Set-EnvValue {
  param([string]$Path, [string]$Name, [string]$Value)
  $lines = if (Test-Path -LiteralPath $Path) { [System.IO.File]::ReadAllLines($Path) } else { @() }
  $pattern = '^\s*' + [regex]::Escape($Name) + '='
  $found = $false
  for ($i = 0; $i -lt $lines.Length; $i++) {
    if ($lines[$i] -match $pattern) {
      $lines[$i] = "$Name=$Value"
      $found = $true
      break
    }
  }
  if (-not $found) { $lines += "$Name=$Value" }
  [System.IO.File]::WriteAllLines($Path, $lines, $utf8NoBom)
}

function Get-EnvValue {
  param([string]$Path, [string]$Name)
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $pattern = '^\s*' + [regex]::Escape($Name) + '=(.*)$'
  foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
    if ($line -match $pattern) { return $Matches[1].Trim().Trim('"') }
  }
  return $null
}

function New-RandomHex {
  param([int]$Bytes = 32)
  $buffer = New-Object byte[] $Bytes
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
  return -join ($buffer | ForEach-Object { $_.ToString('x2') })
}

function Ensure-Secret {
  param([string]$Path, [string]$Name)
  $current = Get-EnvValue -Path $Path -Name $Name
  if ([string]::IsNullOrWhiteSpace($current) -or $current -match 'change-me|REPLACE_WITH') {
    Set-EnvValue -Path $Path -Name $Name -Value (New-RandomHex)
  }
}

function Confirm-ExistingDatabaseMatchesSchema {
  param([string]$WorkingDirectory, [string]$OutputPath)

  Push-Location $WorkingDirectory
  try {
    Invoke-Checked 'npx' @(
      'prisma', 'migrate', 'diff',
      '--from-schema-datasource', 'prisma\schema.prisma',
      '--to-schema-datamodel', 'prisma\schema.prisma',
      '--script', '--output', $OutputPath
    )
  }
  finally { Pop-Location }

  $lines = if (Test-Path -LiteralPath $OutputPath) {
    @([System.IO.File]::ReadAllLines($OutputPath))
  }
  else { @() }
  $meaningful = @($lines | Where-Object {
    -not [string]::IsNullOrWhiteSpace($_) -and
    $_.Trim() -notmatch '^-- This is an empty migration'
  })
  if ($meaningful.Count -gt 0) {
    Write-Host 'Database/schema difference:' -ForegroundColor Red
    $meaningful | ForEach-Object { Write-Host $_ }
    throw 'The existing database does not exactly match schema.prisma, so 0_init was not baselined automatically.'
  }
}

function Resolve-InitBaseline {
  param([string]$WorkingDirectory)

  Push-Location $WorkingDirectory
  try {
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $output = (& npx prisma migrate resolve --applied 0_init 2>&1 | Out-String)
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousPreference
    if (-not [string]::IsNullOrWhiteSpace($output)) { Write-Host ($output.Trim()) }
    if ($exitCode -ne 0 -and $output -notmatch 'P3008|already.+applied') {
      throw "Could not record 0_init as the existing database baseline (exit code $exitCode)."
    }
    if ($exitCode -ne 0) {
      Write-Host '0_init is already recorded; continuing.' -ForegroundColor Yellow
    }
    else {
      Write-Host '0_init recorded as the existing database baseline.' -ForegroundColor Green
    }
  }
  finally {
    $ErrorActionPreference = 'Stop'
    Pop-Location
  }
}

$ZipPath = [System.IO.Path]::GetFullPath($ZipPath)
$InstallPath = [System.IO.Path]::GetFullPath($InstallPath)
if (-not (Test-Path -LiteralPath $ZipPath -PathType Leaf)) {
  throw "ZIP not found: $ZipPath"
}
if ($InstallPath -match '^[A-Za-z]:\\?$' -or $InstallPath.Length -lt 10) {
  throw "Unsafe install path: $InstallPath"
}

Assert-NodeRuntime

$adminPasswordPlain = $null
if (-not $SkipAdminBootstrap) {
  if ([string]::IsNullOrWhiteSpace($AdminEmail)) {
    $AdminEmail = Read-Host 'Super-admin email'
  }
  $AdminEmail = $AdminEmail.Trim().ToLowerInvariant()
  if ($AdminEmail -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') {
    throw "Invalid super-admin email: $AdminEmail"
  }
  if ($null -eq $AdminPassword) {
    $AdminPassword = Read-Host 'New super-admin password (12+ chars, upper/lower/number/symbol)' -AsSecureString
  }
  $adminPasswordPlain = ConvertFrom-SecureAdminPassword -Value $AdminPassword
  Assert-AdminPasswordStrength -Value $adminPasswordPlain
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupPath = "$InstallPath-backup-$stamp"
$failedDependenciesPath = "$InstallPath-failed-dependencies-$stamp"
$tempPath = Join-Path $env:TEMP "affiliate-platform-$stamp"
$extractPath = Join-Path $tempPath 'extract'
$script:robocopyLogDirectory = Join-Path $tempPath 'robocopy-logs'
$script:robocopyLogSequence = 0
$failureLogDirectory = Join-Path (Join-Path $env:USERPROFILE 'Downloads') "Affiliate-Deploy-Error-$stamp"
$backupCreated = $false
$cutoverStarted = $false
$databaseMigrated = $false
$dependencyComponents = @()
$pm2Available = $null -ne (Get-Command pm2 -ErrorAction SilentlyContinue)

Write-Host "Deploying from: $ZipPath" -ForegroundColor Cyan
Write-Host "Install path:   $InstallPath" -ForegroundColor Cyan

try {
  # Extract and build outside the live tree. This means the command is safe even
  # when the parent PowerShell prompt is currently inside InstallPath.
  New-Item -ItemType Directory -Path $extractPath -Force | Out-Null
  Expand-Archive -LiteralPath $ZipPath -DestinationPath $extractPath -Force

  $sourceRoot = $extractPath
  $children = @(Get-ChildItem -LiteralPath $extractPath -Force)
  if ($children.Count -eq 1 -and $children[0].PSIsContainer -and
      (Test-Path -LiteralPath (Join-Path $children[0].FullName 'backend\package.json'))) {
    $sourceRoot = $children[0].FullName
  }
  if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot 'backend\package.json'))) {
    throw 'The ZIP does not contain the expected Affiliate Platform project.'
  }

  # Fail before dependencies, database migrations or credential bootstrap if
  # the archive is incomplete. In particular, never cut over to a release that
  # cannot verify itself or restore the three affiliate PM2 applications.
  $requiredSourceFiles = @(
    'backend\package-lock.json',
    'backend\prisma\schema.prisma',
    'web\package.json',
    'web\package-lock.json',
    'marketing\package.json',
    'marketing\package-lock.json',
    'deploy\ecosystem.config.js',
    'deploy\verify-windows.ps1',
    'deploy\security-check-windows.ps1',
    'deploy\update-cloudflared-windows.ps1'
  )
  foreach ($relative in $requiredSourceFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot $relative) -PathType Leaf)) {
      throw "The ZIP is incomplete; required file is missing: $relative"
    }
  }

  # Keep the existing database, mail, provider and payment secrets in the
  # candidate build. The live tree is still untouched and serving traffic.
  if (Test-Path -LiteralPath $InstallPath) {
    foreach ($relative in @('backend\.env', 'web\.env.production', 'marketing\.env.production')) {
      $oldFile = Join-Path $InstallPath $relative
      if (Test-Path -LiteralPath $oldFile) {
        Copy-Item -LiteralPath $oldFile -Destination (Join-Path $sourceRoot $relative) -Force
      }
    }
  }

  $backendEnv = Join-Path $sourceRoot 'backend\.env'
  if (-not (Test-Path -LiteralPath $backendEnv)) {
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'backend\.env.mentoringhub.example') -Destination $backendEnv
  }
  Set-EnvValue $backendEnv 'NODE_ENV' 'production'
  Set-EnvValue $backendEnv 'API_PORT' '4100'
  Set-EnvValue $backendEnv 'API_PREFIX' 'v1'
  Set-EnvValue $backendEnv 'API_HOST' '127.0.0.1'
  Set-EnvValue $backendEnv 'APP_URL' 'https://affiliate.mentoringhub.online'
  Set-EnvValue $backendEnv 'APP_PUBLIC_URL' 'https://affiliate.mentoringhub.online'
  Set-EnvValue $backendEnv 'API_PUBLIC_URL' 'https://affiliate.mentoringhub.online/v1'
  Set-EnvValue $backendEnv 'TRACKING_BASE_URL' 'https://affiliate.mentoringhub.online/v1'
  Set-EnvValue $backendEnv 'SHOPIFY_APP_URL' 'https://affiliate.mentoringhub.online'
  Set-EnvValue $backendEnv 'CORS_ORIGIN' 'https://affiliate.mentoringhub.online,https://web.mentoringhub.online'
  Set-EnvValue $backendEnv 'TRUST_PROXY' 'loopback'
  Set-EnvValue $backendEnv 'SWAGGER_ENABLED' 'false'
  Set-EnvValue $backendEnv 'ALLOW_BEARER_AUTH' 'false'
  Ensure-Secret $backendEnv 'JWT_ACCESS_SECRET'
  Ensure-Secret $backendEnv 'JWT_REFRESH_SECRET'
  Ensure-Secret $backendEnv 'ENCRYPTION_KEY'
  Assert-ProductionEnvironment -EnvPath $backendEnv
  Assert-CacheReady -EnvPath $backendEnv

  $databaseUrl = Get-EnvValue -Path $backendEnv -Name 'DATABASE_URL'
  if ([string]::IsNullOrWhiteSpace($databaseUrl) -or
      $databaseUrl -notmatch '^postgres(?:ql)?://' -or
      $databaseUrl -match 'REPLACE_WITH|postgres:password@localhost') {
    throw 'backend\.env DATABASE_URL is missing or still uses the example placeholder. Restore the working live backend\.env before deploying.'
  }

  $webEnv = Join-Path $sourceRoot 'web\.env.production'
  if (-not (Test-Path -LiteralPath $webEnv)) {
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'web\.env.production.example') -Destination $webEnv
  }
  Set-EnvValue $webEnv 'NEXT_PUBLIC_API_URL' 'https://affiliate.mentoringhub.online/v1'
  Set-EnvValue $webEnv 'API_PROXY_URL' 'http://127.0.0.1:4100'

  $marketingEnv = Join-Path $sourceRoot 'marketing\.env.production'
  if (-not (Test-Path -LiteralPath $marketingEnv)) {
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'marketing\.env.production.example') -Destination $marketingEnv
  }
  Set-EnvValue $marketingEnv 'NEXT_PUBLIC_API_URL' 'https://affiliate.mentoringhub.online'
  Set-EnvValue $marketingEnv 'NEXT_PUBLIC_APP_URL' 'https://affiliate.mentoringhub.online'

  Push-Location $sourceRoot
  try {
    Invoke-Checked 'npm' @('--prefix', 'backend', 'ci', '--no-audit', '--no-fund')
    Invoke-Checked 'npm' @('--prefix', 'web', 'ci', '--no-audit', '--no-fund')
    Invoke-Checked 'npm' @('--prefix', 'marketing', 'ci', '--no-audit', '--no-fund')
    Invoke-Checked 'npm' @('--prefix', 'backend', 'run', 'prisma:generate')
    Invoke-Checked 'npm' @('--prefix', 'backend', 'run', 'db:prepare')

    $backendPath = Join-Path $sourceRoot 'backend'
    if ($BaselineExistingDatabase) {
      Write-Host 'Checking the existing database before recording migration 0_init...' -ForegroundColor Cyan
      Confirm-ExistingDatabaseMatchesSchema -WorkingDirectory $backendPath -OutputPath (Join-Path $tempPath 'database-schema-diff.sql')
      Resolve-InitBaseline -WorkingDirectory $backendPath
    }

    Push-Location $backendPath
    try { Invoke-Checked 'npx' @('prisma', 'migrate', 'deploy') } finally { Pop-Location }
    $databaseMigrated = $true

    Invoke-Checked 'npm' @('--prefix', 'backend', 'run', 'build')
    Invoke-Checked 'npm' @('--prefix', 'web', 'run', 'build')
    Invoke-Checked 'npm' @('--prefix', 'marketing', 'run', 'build')
    Prepare-NextStandalone -ApplicationPath (Join-Path $sourceRoot 'web')
    Prepare-NextStandalone -ApplicationPath (Join-Path $sourceRoot 'marketing')

    foreach ($artifact in @('main.js', 'app.module.js', 'auth\auth.module.js', 'health\health.controller.js')) {
      $artifactPath = Join-Path (Join-Path $sourceRoot 'backend\dist') $artifact
      if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) {
        throw "Backend build was incomplete; expected artifact is missing: backend\dist\$artifact"
      }
    }

    # Boot the exact production backend from the candidate directory while the
    # current release is still online. This catches environment, Prisma, Redis,
    # native-module and Nest startup failures before any live files are moved.
    Test-CandidateBackend `
      -WorkingDirectory $backendPath `
      -DiagnosticDirectory $tempPath

    if (-not $SkipAdminBootstrap) {
      Write-Host "Preparing super-admin login for $AdminEmail..." -ForegroundColor Cyan
      Invoke-SuperAdminBootstrap `
        -WorkingDirectory $backendPath `
        -Email $AdminEmail `
        -Name $AdminName `
        -PlainPassword $adminPasswordPlain
      $adminPasswordPlain = $null
    }

  } finally {
    Pop-Location
  }

  if (-not $pm2Available) { throw 'PM2 is not installed or is not available in PATH.' }

  # The candidate is complete and migrations succeeded. Downtime starts only
  # here. node_modules is deliberately excluded from Robocopy: deleting the
  # old dependency tree through /MIR is unreliable on Windows and caused code
  # 11 on this host. The old trees are atomically moved into the rollback copy,
  # then dependencies are installed fresh against the new lockfiles.
  Stop-ProjectPm2Apps
  if (Test-Path -LiteralPath $InstallPath) {
    Write-Host "Creating verified rollback copy at: $backupPath" -ForegroundColor Yellow
    Invoke-RobocopyMirror -Source $InstallPath -Destination $backupPath -ExcludeNodeModules
    $dependencyComponents = @(Move-ProjectDependencies -SourceRoot $InstallPath -DestinationRoot $backupPath)
    $backupCreated = $true
  }
  $cutoverStarted = $true
  Write-Host 'Synchronizing the tested candidate into the live directory...' -ForegroundColor Cyan
  Invoke-RobocopyMirror -Source $sourceRoot -Destination $InstallPath -ExcludeNodeModules

  Write-Host 'Installing clean dependencies in the live directory...' -ForegroundColor Cyan
  Invoke-Checked 'npm' @('--prefix', (Join-Path $InstallPath 'backend'), 'ci', '--no-audit', '--no-fund')
  Invoke-Checked 'npm' @('--prefix', (Join-Path $InstallPath 'web'), 'ci', '--no-audit', '--no-fund')
  Invoke-Checked 'npm' @('--prefix', (Join-Path $InstallPath 'marketing'), 'ci', '--no-audit', '--no-fund')
  Invoke-Checked 'npm' @('--prefix', (Join-Path $InstallPath 'backend'), 'run', 'prisma:generate')

  New-Item -ItemType Directory -Path (Join-Path $InstallPath 'logs') -Force | Out-Null
  Invoke-Checked 'pm2' @('start', (Join-Path $InstallPath 'deploy\ecosystem.config.js'))
  # On this Windows host the Nest application can take roughly ten seconds to
  # initialize under load. Avoid checking transient PM2 startup state.
  Start-Sleep -Seconds 15

  $verifyScript = Join-Path $InstallPath 'deploy\verify-windows.ps1'
  $securityScript = Join-Path $InstallPath 'deploy\security-check-windows.ps1'
  foreach ($requiredScript in @($verifyScript, $securityScript)) {
    if (-not (Test-Path -LiteralPath $requiredScript -PathType Leaf)) {
      throw "Required post-deploy verification script is missing: $requiredScript"
    }
  }

  # First prove the application itself is healthy before changing/checking the
  # tunnel service. A failed API can never be reported as a successful deploy.
  Invoke-Checked 'powershell.exe' @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $verifyScript, '-SkipPublic'
  )

  if (-not $SkipCloudflaredUpdate) {
    $cloudflaredUpdater = Join-Path $InstallPath 'deploy\update-cloudflared-windows.ps1'
    if (-not (Test-Path -LiteralPath $cloudflaredUpdater -PathType Leaf)) {
      throw "Cloudflared updater is missing: $cloudflaredUpdater"
    }
    Write-Host 'Updating cloudflared and restarting its existing Windows service...' -ForegroundColor Cyan
    try {
      Invoke-Checked 'powershell.exe' @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $cloudflaredUpdater
      )
    }
    catch {
      # An updater failure must not roll back a healthy application when the
      # existing Cloudflare service and public routes still work. The next
      # public verification remains authoritative and fails the deployment if
      # the tunnel is actually unavailable.
      Write-Warning "Cloudflared updater reported a problem: $($_.Exception.Message)"
      Write-Host 'Continuing to public route verification with the existing tunnel service.' -ForegroundColor Yellow
    }
  }

  Invoke-Checked 'powershell.exe' @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $verifyScript
  )
  Invoke-Checked 'powershell.exe' @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $securityScript
  )
  # Persist only a release that passed local, public and security checks.
  Invoke-Checked 'pm2' @('save')
  & pm2 status

  Write-Host ''
  Write-Host 'Deployment completed.' -ForegroundColor Green
  if ($backupCreated) { Write-Host "Backup kept at: $backupPath" -ForegroundColor Yellow }
  Write-Host 'Affiliate services and the super-admin login are ready.' -ForegroundColor Cyan
}
catch {
  $adminPasswordPlain = $null
  $failure = $_
  Write-Host ''
  Write-Host '================ DEPLOYMENT ERROR ================' -ForegroundColor Red
  Write-Host "Deployment failed: $($failure.Exception.Message)" -ForegroundColor Red
  if ($failure.ScriptStackTrace) {
    Write-Host ''
    Write-Host 'PowerShell stack trace:' -ForegroundColor Red
    Write-Host $failure.ScriptStackTrace
  }

  try {
    New-Item -ItemType Directory -Path $failureLogDirectory -Force | Out-Null
    Save-DeploymentDiagnostics `
      -Directory $failureLogDirectory `
      -LivePath $InstallPath `
      -TemporaryPath $tempPath
    if (Test-Path -LiteralPath $script:robocopyLogDirectory) {
      Copy-Item -LiteralPath $script:robocopyLogDirectory -Destination $failureLogDirectory -Recurse -Force
    }
    $errorText = @(
      "Time: $(Get-Date -Format o)",
      "Message: $($failure.Exception.Message)",
      "Category: $($failure.CategoryInfo)",
      "FullyQualifiedErrorId: $($failure.FullyQualifiedErrorId)",
      "ScriptStackTrace:",
      [string]$failure.ScriptStackTrace
    ) -join [Environment]::NewLine
    [System.IO.File]::WriteAllText((Join-Path $failureLogDirectory 'deployment-error.txt'), $errorText, $utf8NoBom)
    $failureZip = "$failureLogDirectory.zip"
    Compress-Archive -Path (Join-Path $failureLogDirectory '*') -DestinationPath $failureZip -Force
    Write-Host ''
    Write-Host "Complete error logs saved at: $failureLogDirectory" -ForegroundColor Yellow
    Write-Host "Shareable error ZIP saved at: $failureZip" -ForegroundColor Yellow
  }
  catch {
    Write-Warning "Could not preserve the deployment logs: $($_.Exception.Message)"
  }

  if ($cutoverStarted -and $backupCreated) {
    Stop-ProjectPm2Apps
    if ($dependencyComponents.Count -gt 0) {
      foreach ($component in $dependencyComponents) {
        $liveDependencies = Join-Path (Join-Path $InstallPath $component) 'node_modules'
        if (Test-Path -LiteralPath $liveDependencies) {
          $failedParent = Join-Path $failedDependenciesPath $component
          New-Item -ItemType Directory -Path $failedParent -Force | Out-Null
          Move-Item -LiteralPath $liveDependencies -Destination (Join-Path $failedParent 'node_modules') -ErrorAction Stop
        }
      }
    }
    Invoke-RobocopyMirror -Source $backupPath -Destination $InstallPath -ExcludeNodeModules
    foreach ($component in $dependencyComponents) {
      $savedDependencies = Join-Path (Join-Path $backupPath $component) 'node_modules'
      $liveParent = Join-Path $InstallPath $component
      if (Test-Path -LiteralPath $savedDependencies) {
        New-Item -ItemType Directory -Path $liveParent -Force | Out-Null
        Move-Item -LiteralPath $savedDependencies -Destination (Join-Path $liveParent 'node_modules') -ErrorAction Stop
      }
    }
    Write-Host 'The previous project contents were restored automatically.' -ForegroundColor Yellow
  }
  elseif ($cutoverStarted) {
    Write-Host 'This was a new installation, so there was no previous project to restore.' -ForegroundColor Yellow
  }
  else {
    Write-Host 'The existing project folder was not changed.' -ForegroundColor Yellow
  }
  if ($databaseMigrated) {
    Write-Host 'Additive database migrations may already be recorded; they are safe for the previous app during automatic recovery.' -ForegroundColor Yellow
  }
  if ($pm2Available -and (Test-Path -LiteralPath (Join-Path $InstallPath 'deploy\ecosystem.config.js'))) {
    & pm2 start (Join-Path $InstallPath 'deploy\ecosystem.config.js') | Out-Null
    & pm2 save | Out-Null
  }
  throw $failure
}
finally {
  # The extracted candidate contains a copy of the production .env while it is
  # being built. Remove it on both success and failure so secrets are not left
  # behind in the user's TEMP directory.
  $adminPasswordPlain = $null
  if (Test-Path -LiteralPath $tempPath) {
    try { Remove-Item -LiteralPath $tempPath -Recurse -Force -ErrorAction Stop }
    catch { Write-Warning "Could not remove temporary deployment files at $tempPath. Remove that exact folder manually." }
  }
}
