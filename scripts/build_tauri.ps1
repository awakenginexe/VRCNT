param(
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tauri = Join-Path $repoRoot 'node_modules\.bin\tauri.cmd'
if (-not (Test-Path -LiteralPath $tauri -PathType Leaf)) {
  throw "Tauri CLI was not found at $tauri. Run npm install first."
}

$arguments = @('build', '--no-bundle')

if ($DryRun) {
  Write-Output ($arguments -join ' ')
  exit 0
}

& $tauri @arguments
exit $LASTEXITCODE
