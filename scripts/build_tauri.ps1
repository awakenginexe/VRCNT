param(
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tauri = Join-Path $repoRoot 'node_modules\.bin\tauri.cmd'
if (-not (Test-Path -LiteralPath $tauri -PathType Leaf)) {
  throw "Tauri CLI was not found at $tauri. Run npm install first."
}

$arguments = @('build')
if ([string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY)) {
  Write-Warning 'TAURI_SIGNING_PRIVATE_KEY is not set; building the unsigned local installer without updater artifacts.'
  $arguments += @('--config', (Join-Path $repoRoot 'src-tauri\tauri.local.conf.json'))
}

if ($DryRun) {
  Write-Output ($arguments -join ' ')
  exit 0
}

& $tauri @arguments
exit $LASTEXITCODE
