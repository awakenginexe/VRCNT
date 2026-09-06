param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('cpu', 'cuda')]
  [string]$Variant,
  [string]$OutputPath,
  [string]$EnvironmentPath
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$environmentDirectory = if ($Variant -eq 'cpu') { '.venv' } else { '.venv_cuda' }
$environmentRoot = if ([string]::IsNullOrWhiteSpace($EnvironmentPath)) {
  Join-Path $repoRoot $environmentDirectory
} else {
  [IO.Path]::GetFullPath($EnvironmentPath)
}
$python = Join-Path $environmentRoot 'Scripts\python.exe'
$specRelative = if ($Variant -eq 'cpu') { 'spec\backend.spec' } else { 'spec\backend_cuda.spec' }
$spec = Join-Path $repoRoot $specRelative
if ([string]::IsNullOrWhiteSpace($OutputPath)) { $OutputPath = Join-Path $repoRoot "build\backend\$Variant" }
$output = [IO.Path]::GetFullPath($OutputPath)
if (-not (Test-Path -LiteralPath $python -PathType Leaf)) { throw "The $Variant backend environment is unavailable at $environmentRoot." }
if (-not (Test-Path -LiteralPath $spec -PathType Leaf)) { throw "The $Variant backend specification is unavailable." }

$env:VRCNT_BACKEND_VARIANT = $Variant
$env:VRCNT_BACKEND_VENV = $environmentRoot
$workPath = Join-Path $repoRoot "build\pyinstaller\$Variant"
Push-Location $repoRoot
try {
  & $python -m PyInstaller $spec --distpath $output --workpath $workPath --clean --noconfirm --log-level ERROR
  if ($LASTEXITCODE -ne 0) { throw "The $Variant backend build failed." }
} finally {
  Pop-Location
}
if (-not (Test-Path -LiteralPath (Join-Path $output 'VRCNT-backend-x86_64-pc-windows-msvc.exe') -PathType Leaf)) { throw "The $Variant backend build did not produce its sidecar." }
Write-Output $output
