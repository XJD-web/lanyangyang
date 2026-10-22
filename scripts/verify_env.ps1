# Dev environment verification script (ASCII only, Windows PowerShell)
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verify_env.ps1

$ErrorActionPreference = 'SilentlyContinue'

# Rebuild PATH from registry (Machine + User) so results are accurate even when this
# script is launched from a shell that started before the env vars were configured.
# (A newly spawned child process inherits the PARENT's env, not a fresh registry read.)
$machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
$userPathRaw = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($machinePath -or $userPathRaw) {
  $env:Path = (@($machinePath, $userPathRaw) | Where-Object { $_ }) -join ';'
}

$tools = @(
  @{ Name = 'JDK';        Cmd = 'java';         Args = @('-version') },
  @{ Name = 'javac';      Cmd = 'javac';        Args = @('-version') },
  @{ Name = 'Maven';      Cmd = 'mvn';          Args = @('-v') },
  @{ Name = 'Gradle';     Cmd = 'gradle';       Args = @('-v') },
  @{ Name = 'Python';     Cmd = 'python';       Args = @('--version') },
  @{ Name = 'pip';        Cmd = 'pip';          Args = @('--version') },
  @{ Name = 'Node.js';    Cmd = 'node';         Args = @('-v') },
  @{ Name = 'npm';        Cmd = 'npm';          Args = @('-v') },
  @{ Name = 'pnpm';       Cmd = 'pnpm';         Args = @('-v') },
  @{ Name = 'Git';        Cmd = 'git';          Args = @('--version') },
  @{ Name = 'CMake';      Cmd = 'cmake';        Args = @('--version') },
  @{ Name = 'MySQL';      Cmd = 'mysql';        Args = @('--version') },
  @{ Name = 'Redis';      Cmd = 'redis-server'; Args = @('--version') },
  @{ Name = 'MongoDB';    Cmd = 'mongod';       Args = @('--version') },
  @{ Name = 'Docker';     Cmd = 'docker';       Args = @('--version') },
  @{ Name = 'kubectl';    Cmd = 'kubectl';      Args = @('version', '--client') },
  @{ Name = 'Nginx';      Cmd = 'nginx';        Args = @('-v') },
  @{ Name = 'Hadoop';     Cmd = 'hadoop';       Args = @('version') },
  @{ Name = 'Kafka';      Cmd = 'kafka-topics'; Args = @('--version') }
)

Write-Host ''
Write-Host '== Tool version check (PATH) ==' -ForegroundColor Cyan
$ok = 0
$fail = 0

foreach ($t in $tools) {
  $resolved = Get-Command $t.Cmd -ErrorAction SilentlyContinue
  if (-not $resolved) {
    Write-Host ('[MISS] {0,-10} not found in PATH' -f $t.Name) -ForegroundColor DarkGray
    $fail++
    continue
  }
  # Native commands: capture stderr too (java/mvn/nginx write version to stderr)
  $lines = & $t.Cmd @($t.Args) 2>&1
  $out = ($lines | Where-Object { "$_".Trim() } | Select-Object -First 1)
  $out = ("$out").Trim()
  $src = $resolved.Source
  Write-Host ('[ OK ] {0,-10} {1}' -f $t.Name, $out) -ForegroundColor Green
  Write-Host ('         -> {0}' -f $src) -ForegroundColor DarkGray
  $ok++
}

Write-Host ''
Write-Host ('Result: found={0}  missing={1}' -f $ok, $fail) -ForegroundColor Yellow

Write-Host ''
Write-Host '== HOME variables (User scope) ==' -ForegroundColor Cyan
foreach ($v in @('JAVA_HOME', 'MAVEN_HOME', 'GRADLE_HOME', 'HADOOP_HOME', 'CONDA_HOME', 'SPARK_HOME', 'KAFKA_HOME', 'MYSQL_HOME')) {
  $val = [Environment]::GetEnvironmentVariable($v, 'User')
  if ($val) {
    $exists = Test-Path $val
    $flag = if ($exists) { 'OK' } else { 'PATH NOT EXIST' }
    Write-Host ('{0,-12} = {1}  [{2}]' -f $v, $val, $flag)
  } else {
    Write-Host ('{0,-12} = (not set)' -f $v) -ForegroundColor DarkGray
  }
}

Write-Host ''
Write-Host '== User Path (contains bin entries) ==' -ForegroundColor Cyan
$up = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($up) {
  $up.Split(';') | Where-Object { $_.Trim() } | ForEach-Object { Write-Host ('  ' + $_) }
} else {
  Write-Host '  (empty)' -ForegroundColor DarkGray
}

# Detect stale placeholder entries like C:\Users\xxx\.env-tools\... left by old buggy builds
Write-Host ''
$stale = @()
if ($up) { $stale += $up.Split(';') | Where-Object { $_ -match '\\xxx\\' } }
foreach ($v in @('JAVA_HOME', 'MAVEN_HOME', 'GRADLE_HOME', 'HADOOP_HOME', 'CONDA_HOME', 'SPARK_HOME', 'KAFKA_HOME', 'MYSQL_HOME')) {
  $val = [Environment]::GetEnvironmentVariable($v, 'User')
  if ($val -and $val -match '\\xxx\\') { $stale += "$v = $val" }
}
if ($stale.Count -gt 0) {
  Write-Host 'WARNING: stale placeholder entries found (from old buggy builds):' -ForegroundColor Red
  $stale | ForEach-Object { Write-Host ('  ' + $_) -ForegroundColor Red }
  Write-Host '  -> these point to a fake user "xxx" and should be removed.' -ForegroundColor Red
} else {
  Write-Host 'No stale placeholder (\\xxx\\) entries. OK' -ForegroundColor Green
}

Write-Host ''
Write-Host 'Tip: open a NEW terminal before running this, otherwise new vars are not visible.' -ForegroundColor Yellow
