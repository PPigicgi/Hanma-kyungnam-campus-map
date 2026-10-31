$ErrorActionPreference='Stop'
$runtime=Get-Content -LiteralPath (Join-Path $PSScriptRoot '.runtime.json') -Raw | ConvertFrom-Json
$recordPath=Join-Path $runtime.state_dir 'server.json'
if (-not (Test-Path -LiteralPath $recordPath)) { Write-Output '실행 기록이 없습니다.'; exit 0 }
$record=Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
$observed=Get-CimInstance Win32_Process -Filter "ProcessId=$($record.pid)"
if (-not $observed) { Write-Output '서버가 이미 종료되었습니다.'; exit 0 }
if ($observed.CreationDate.ToUniversalTime().Ticks -ne ([datetime]$record.creation).ToUniversalTime().Ticks -or $observed.CommandLine -ne $record.command -or $observed.CommandLine -notmatch 'campus_bot.app:app') { throw '프로세스가 실행 기록과 다르므로 종료하지 않았습니다.' }
# Terminate only the verified app's complete process tree, including an active Codex request.
# Stopping just the venv launcher/interpreter would leave the model child running.
& (Join-Path $env:SystemRoot 'System32/taskkill.exe') /PID $record.pid /T /F | Out-Null
if ($LASTEXITCODE -ne 0 -and (Get-Process -Id $record.pid -ErrorAction SilentlyContinue)) { throw '서버 프로세스 트리를 종료하지 못했습니다.' }
Write-Output '캠퍼스 도우미 서버를 종료했습니다.'
