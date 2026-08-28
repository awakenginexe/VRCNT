param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('cpu', 'cuda')]
  [string]$Variant,
  [string]$ShellPath,
  [string]$BackendPayloadPath,
  [string]$OutputPath,
  [string]$Version,
  [string]$SourceCommit,
  [string]$BuildRecipe
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$usingDefaultShell = [string]::IsNullOrWhiteSpace($ShellPath)
if ($usingDefaultShell) { $ShellPath = Join-Path $repoRoot 'build\shared-shell' }
if ([string]::IsNullOrWhiteSpace($BackendPayloadPath)) {
  $BackendPayloadPath = if ($Variant -eq 'cpu') { Join-Path $repoRoot 'src-tauri\bin' } else { Join-Path $repoRoot 'build\backend\cuda' }
}
if ([string]::IsNullOrWhiteSpace($OutputPath)) { $OutputPath = Join-Path $repoRoot "build\release\$Variant" }
if ([string]::IsNullOrWhiteSpace($Version)) { $Version = (Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).version }
if ([string]::IsNullOrWhiteSpace($SourceCommit)) {
  $SourceCommit = (& git -C $repoRoot rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'The source commit could not be resolved.' }
}
if ([string]::IsNullOrWhiteSpace($BuildRecipe)) { $BuildRecipe = "pyinstaller-$Variant-v1" }

if ($usingDefaultShell -and -not (Test-Path -LiteralPath $ShellPath)) {
  $shellExecutable = Join-Path $repoRoot 'src-tauri\target\release\VRCNT.exe'
  $frontend = Join-Path $repoRoot 'dist'
  if (-not (Test-Path -LiteralPath $shellExecutable -PathType Leaf) -or -not (Test-Path -LiteralPath $frontend -PathType Container)) {
    throw 'The built Tauri shell and frontend are required before runtime staging.'
  }
  New-Item -ItemType Directory -Path $ShellPath | Out-Null
  Copy-Item -LiteralPath $shellExecutable -Destination (Join-Path $ShellPath 'VRCNT.exe')
  Copy-Item -LiteralPath $frontend -Destination (Join-Path $ShellPath 'frontend') -Recurse
}

function Get-AbsolutePath([string]$Path) {
  return [IO.Path]::GetFullPath($Path)
}

function Get-RelativeFilePath([string]$Root, [string]$Path) {
  return $Path.Substring($Root.Length).TrimStart([char[]]'\\/') -replace '\\', '/'
}

function ConvertTo-LowerHex([byte[]]$Bytes) {
  return -join ($Bytes | ForEach-Object { $_.ToString('x2') })
}

function Get-BytesSha256([byte[]]$Bytes) {
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try { return ConvertTo-LowerHex $sha256.ComputeHash($Bytes) } finally { $sha256.Dispose() }
}

function Get-FileSha256([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try { return ConvertTo-LowerHex $sha256.ComputeHash($stream) } finally { $sha256.Dispose(); $stream.Dispose() }
}

function Get-TreeIdentity([string]$Path, [string[]]$Excluded = @()) {
  $root = (Get-AbsolutePath $Path).TrimEnd([char[]]'\\/') + [IO.Path]::DirectorySeparatorChar
  [string[]]$lines = @(Get-ChildItem -LiteralPath $Path -File -Recurse -Force | ForEach-Object {
    $relative = Get-RelativeFilePath $root $_.FullName
    if ($Excluded -notcontains $relative) {
      "$relative`n$(Get-FileSha256 $_.FullName)"
    }
  })
  [Array]::Sort($lines, [StringComparer]::Ordinal)
  $bytes = [Text.Encoding]::UTF8.GetBytes(($lines -join "`n"))
  return Get-BytesSha256 $bytes
}

function Test-PathOverlap([string]$Left, [string]$Right) {
  $leftFull = (Get-AbsolutePath $Left).TrimEnd([char[]]'\\/')
  $rightFull = (Get-AbsolutePath $Right).TrimEnd([char[]]'\\/')
  $comparison = [StringComparison]::OrdinalIgnoreCase
  return $leftFull.Equals($rightFull, $comparison) -or
    $leftFull.StartsWith($rightFull + [IO.Path]::DirectorySeparatorChar, $comparison) -or
    $rightFull.StartsWith($leftFull + [IO.Path]::DirectorySeparatorChar, $comparison)
}

$shell = Get-AbsolutePath $ShellPath
$backend = Get-AbsolutePath $BackendPayloadPath
$output = Get-AbsolutePath $OutputPath
if (-not (Test-Path -LiteralPath $shell -PathType Container) -or -not (Test-Path -LiteralPath $backend -PathType Container)) {
  throw 'The shared shell and backend payload directories must exist.'
}
if (Test-Path -LiteralPath $output) {
  throw 'The staged runtime output must be a new directory.'
}
if (Test-PathOverlap $output $shell -or Test-PathOverlap $output $backend) {
  throw 'The staged runtime output must not overlap its inputs.'
}
foreach ($base in @($env:LOCALAPPDATA, $env:APPDATA)) {
  if (-not [string]::IsNullOrWhiteSpace($base) -and (Test-PathOverlap $output (Join-Path $base 'VRCNTData'))) {
    throw 'The staged runtime output must not overlap VRCNT user data.'
  }
}
if (-not $Version -match '^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$') { throw 'The runtime version is invalid.' }
if (-not $SourceCommit -match '^[0-9a-fA-F]{40}$') { throw 'The source commit must be a full SHA-1 commit.' }
if ([string]::IsNullOrWhiteSpace($BuildRecipe)) { throw 'The payload build recipe is required.' }
if (-not (Test-Path -LiteralPath (Join-Path $shell 'VRCNT.exe') -PathType Leaf)) { throw 'The shared shell is missing VRCNT.exe.' }
if (Test-Path -LiteralPath (Join-Path $shell 'VRCNT.runtime.json')) { throw 'The shared shell must not provide a runtime identity marker.' }
if ((Test-Path -LiteralPath (Join-Path $shell 'VRCNT-backend.exe')) -or (Test-Path -LiteralPath (Join-Path $shell 'VRCNT-backend-x86_64-pc-windows-msvc.exe'))) { throw 'The shared shell must not include a backend payload.' }
$portableBackend = Join-Path $backend 'VRCNT-backend.exe'
$builtBackend = Join-Path $backend 'VRCNT-backend-x86_64-pc-windows-msvc.exe'
$hasPortableBackend = Test-Path -LiteralPath $portableBackend -PathType Leaf
$hasBuiltBackend = Test-Path -LiteralPath $builtBackend -PathType Leaf
if ($hasPortableBackend -and $hasBuiltBackend) { throw 'The backend payload contains ambiguous executable names.' }
$backendExecutable = if ($hasPortableBackend) { $portableBackend } elseif ($hasBuiltBackend) { $builtBackend } else { $null }
if ($null -eq $backendExecutable) { throw 'The backend payload is missing its VRCNT backend executable.' }
if (Test-Path -LiteralPath (Join-Path $backend 'VRCNT.runtime.json')) { throw 'The backend payload must not provide a runtime identity marker.' }

$shellFiles = @{}
$shellRoot = $shell.TrimEnd([char[]]'\/') + [IO.Path]::DirectorySeparatorChar
Get-ChildItem -LiteralPath $shell -File -Recurse -Force | ForEach-Object {
  $shellFiles[(Get-RelativeFilePath $shellRoot $_.FullName).ToLowerInvariant()] = $true
}
$backendRoot = $backend.TrimEnd([char[]]'\/') + [IO.Path]::DirectorySeparatorChar
Get-ChildItem -LiteralPath $backend -File -Recurse -Force | ForEach-Object {
  $relative = Get-RelativeFilePath $backendRoot $_.FullName
  if ($_.FullName -ne $backendExecutable -and $shellFiles.ContainsKey($relative.ToLowerInvariant())) {
    throw "The shared shell and backend payload overlap at $relative."
  }
}

New-Item -ItemType Directory -Path $output -Force | Out-Null
Get-ChildItem -LiteralPath $shell -Force | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $output -Recurse -Force
}
Get-ChildItem -LiteralPath $backend -Force | Where-Object { $_.FullName -ne $backendExecutable } | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $output -Recurse -Force
}
Copy-Item -LiteralPath $backendExecutable -Destination (Join-Path $output 'VRCNT-backend.exe')

$sharedShellIdentity = Get-TreeIdentity $shell
$backendPayloadIdentity = Get-TreeIdentity $backend
$variantName = if ($Variant -eq 'cpu') { 'Cpu' } else { 'Cuda' }
$payloadIdentity = Get-TreeIdentity $output
$buildIdentityInput = @(
  'VRCNT', $Version, $variantName, 'x64', $SourceCommit.ToLowerInvariant(),
  $BuildRecipe, $sharedShellIdentity, $backendPayloadIdentity, $payloadIdentity
) -join "`n"
$buildIdentity = Get-BytesSha256 ([Text.Encoding]::UTF8.GetBytes($buildIdentityInput))
$marker = [ordered]@{
  product = 'VRCNT'
  version = $Version
  variant = $variantName
  architecture = 'x64'
  sourceCommit = $SourceCommit.ToLowerInvariant()
  buildRecipe = $BuildRecipe
  sharedShellIdentity = $sharedShellIdentity
  backendPayloadIdentity = $backendPayloadIdentity
  buildIdentity = $buildIdentity
}
$markerJson = $marker | ConvertTo-Json
$utf8NoBom = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $output 'VRCNT.runtime.json'), $markerJson, $utf8NoBom)

& (Join-Path $PSScriptRoot 'validate_runtime_payload.ps1') -Variant $Variant -PayloadPath $output
