param([string]$ReportDir,[switch]$Live)
$ErrorActionPreference='Stop'
$runtime=Get-Content -LiteralPath (Join-Path $PSScriptRoot '.runtime.json') -Raw | ConvertFrom-Json
if (-not $ReportDir) { $ReportDir=Join-Path $runtime.state_dir 'verification' }
$env:PYTHONIOENCODING='utf-8'
$env:PYTHONDONTWRITEBYTECODE='1'
New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
Push-Location $PSScriptRoot
try {
    & $runtime.python -m pytest -q --junitxml (Join-Path $ReportDir 'pytest.xml')
    if ($LASTEXITCODE -ne 0) { throw '테스트 실패. 검증 패키지가 없으면 setup.ps1 -Dev를 실행하세요.' }
    & $runtime.python -m campus_bot.evaluate --output (Join-Path $ReportDir 'evaluation.json')
    if ($LASTEXITCODE -ne 0) { throw '실제 DB 질문 평가가 실패했습니다.' }
    if ($Live) {
        & $runtime.python -m campus_bot.live_check --output (Join-Path $ReportDir 'live-model.json')
        if ($LASTEXITCODE -ne 0) { throw '모델 실호출 검증 미완료. 설정과 보고서를 확인하세요.' }
    }
} finally { Pop-Location }
Write-Output "검증 결과: $ReportDir"
