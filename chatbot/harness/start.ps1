param([ValidateRange(1024,65535)][int]$Port=8765,[switch]$Background,[switch]$Check)
$ErrorActionPreference='Stop'
$runtimeFile=Join-Path $PSScriptRoot '.runtime.json'
if (-not (Test-Path -LiteralPath $runtimeFile)) { throw '먼저 .\setup.ps1을 실행하세요.' }
$runtime=Get-Content -LiteralPath $runtimeFile -Raw | ConvertFrom-Json
if (-not (Test-Path -LiteralPath $runtime.python)) { throw 'Python 경로가 바뀌었습니다. .\setup.ps1을 다시 실행하세요.' }
$env:PYTHONIOENCODING='utf-8'
$env:PYTHONDONTWRITEBYTECODE='1'
if ($Check) {
    Push-Location $PSScriptRoot
    try { & $runtime.python -c 'from campus_bot.graph import CampusBot; b=CampusBot(); print("READY", b.repo.data_as_of, b.repo.count, "LLM", b.answerer.settings.state); b.close()' } finally { Pop-Location }
    exit $LASTEXITCODE
}
$argsList=@('-m','uvicorn','campus_bot.app:app','--host','127.0.0.1','--port',"$Port",'--limit-concurrency','64')
if (-not $Background) {
    Push-Location $PSScriptRoot
    try { & $runtime.python @argsList } finally { Pop-Location }
    exit $LASTEXITCODE
}
$existingRecordPath=Join-Path $runtime.state_dir 'server.json'
if (Test-Path -LiteralPath $existingRecordPath) {
    $existing=Get-Content -LiteralPath $existingRecordPath -Raw | ConvertFrom-Json
    $running=Get-CimInstance Win32_Process -Filter "ProcessId=$($existing.pid)"
    if ($running -and $running.CommandLine -eq $existing.command -and $running.CreationDate.ToUniversalTime().Ticks -eq ([datetime]$existing.creation).ToUniversalTime().Ticks) {
        if ($existing.port -ne $Port) { throw "이미 포트 $($existing.port)에서 실행 중입니다. 먼저 stop.ps1로 종료하세요." }
        Write-Output "이미 실행 중: http://127.0.0.1:$Port/"
        exit 0
    }
}
$portProbe=[Net.Sockets.TcpClient]::new()
try { $portProbe.Connect('127.0.0.1',$Port); $occupied=$true } catch { $occupied=$false } finally { $portProbe.Dispose() }
if ($occupied) { throw "포트 $Port 를 이미 사용 중입니다. -Port 옵션으로 다른 포트를 선택하세요." }
New-Item -ItemType Directory -Path $runtime.state_dir -Force | Out-Null
$process=Start-Process -FilePath $runtime.python -ArgumentList $argsList -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtime.state_dir 'server.out.log') -RedirectStandardError (Join-Path $runtime.state_dir 'server.err.log')
Start-Sleep -Seconds 2
$process.Refresh()
if ($process.HasExited) { throw "서버 시작 실패. 로그: $($runtime.state_dir)" }
$observed=Get-CimInstance Win32_Process -Filter "ProcessId=$($process.Id)"
@{ pid=$process.Id; creation=$observed.CreationDate.ToUniversalTime().ToString('o'); port=$Port; command=$observed.CommandLine } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtime.state_dir 'server.json') -Encoding utf8
Write-Output "웹 채팅: http://127.0.0.1:$Port/"
Write-Output "API 문서: http://127.0.0.1:$Port/docs"
Write-Output '종료: .\stop.ps1'
