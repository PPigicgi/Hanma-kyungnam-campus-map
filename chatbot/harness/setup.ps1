param([string]$Python, [string]$RuntimeDir, [switch]$Dev)
$ErrorActionPreference = 'Stop'
if (-not $Python) {
    $bundledPython = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
    $Python = if (Test-Path -LiteralPath $bundledPython) { $bundledPython } else { (Get-Command python -ErrorAction Stop).Source }
}
if (-not $RuntimeDir) { $RuntimeDir = Join-Path $PSScriptRoot '.venv' }
$RuntimeDir = [IO.Path]::GetFullPath($RuntimeDir)
$runtimePython = Join-Path $RuntimeDir 'Scripts/python.exe'
if (-not (Test-Path -LiteralPath $runtimePython)) {
    & $Python -m venv $RuntimeDir
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.11 이상으로 가상환경을 생성하지 못했습니다.' }
}
& $runtimePython -m pip install -r (Join-Path $PSScriptRoot 'requirements.lock')
if ($LASTEXITCODE -ne 0) { throw '패키지 설치에 실패했습니다.' }
if ($Dev) {
    & $runtimePython -m pip install -r (Join-Path $PSScriptRoot 'requirements-dev.txt')
    if ($LASTEXITCODE -ne 0) { throw '검증 패키지 설치에 실패했습니다.' }
}
$stateDir = Join-Path (Split-Path $RuntimeDir -Parent) 'campus-runtime'
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
@{ python=$runtimePython; state_dir=$stateDir } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot '.runtime.json') -Encoding utf8
Write-Output '설치 완료. .\start.ps1 -Background 로 웹 서버를 시작하세요.'
