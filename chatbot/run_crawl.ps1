param(
    [switch]$Refresh,
    [switch]$RetryErrors,
    [switch]$ExportOnly,
    [switch]$Reprocess
)
$ErrorActionPreference = 'Stop'
$taskPython = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) {
    $taskPython = (Get-Command python -ErrorAction Stop).Source
}
$taskArgs = @((Join-Path $PSScriptRoot 'crawl.py'))
if ($Refresh) { $taskArgs += '--refresh' }
if ($RetryErrors) { $taskArgs += '--retry-errors' }
if ($ExportOnly) { $taskArgs += '--export-only' }
if ($Reprocess) { $taskArgs += '--reprocess' }
$env:PYTHONIOENCODING = 'utf-8'
& $taskPython @taskArgs
exit $LASTEXITCODE
