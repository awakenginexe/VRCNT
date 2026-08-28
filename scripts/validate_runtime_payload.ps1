param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('cpu', 'cuda')]
  [string]$Variant,
  [Parameter(Mandatory = $true)]
  [string]$PayloadPath
)

$ErrorActionPreference = 'Stop'

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
  $root = [IO.Path]::GetFullPath($Path).TrimEnd([char[]]'\\/') + [IO.Path]::DirectorySeparatorChar
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

$payload = [IO.Path]::GetFullPath($PayloadPath)
$markerPath = Join-Path $payload 'VRCNT.runtime.json'
if (-not (Test-Path -LiteralPath $payload -PathType Container)) { throw 'The runtime payload directory is unavailable.' }
foreach ($required in @('VRCNT.exe', 'VRCNT-backend.exe', 'VRCNT.runtime.json')) {
  if (-not (Test-Path -LiteralPath (Join-Path $payload $required) -PathType Leaf)) { throw "The runtime payload is missing $required." }
}
try { $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json } catch { throw 'The runtime identity marker is malformed.' }
$expectedVariant = if ($Variant -eq 'cpu') { 'Cpu' } else { 'Cuda' }
foreach ($field in @('product', 'version', 'variant', 'architecture', 'sourceCommit', 'buildRecipe', 'sharedShellIdentity', 'backendPayloadIdentity', 'buildIdentity')) {
  if ([string]::IsNullOrWhiteSpace([string]$marker.$field)) { throw "The runtime identity marker is missing $field." }
}
if ($marker.product -ne 'VRCNT' -or $marker.variant -ne $expectedVariant -or $marker.architecture -ne 'x64') { throw 'The runtime identity marker does not match the staged variant.' }
if ($marker.version -notmatch '^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$') { throw 'The runtime identity marker version is invalid.' }
if ($marker.sourceCommit -notmatch '^[0-9a-f]{40}$') { throw 'The runtime identity marker source commit is invalid.' }
foreach ($field in @('sharedShellIdentity', 'backendPayloadIdentity', 'buildIdentity')) {
  if ($marker.$field -notmatch '^[0-9a-f]{64}$') { throw "The runtime identity marker $field is invalid." }
}

$files = Get-ChildItem -LiteralPath $payload -File -Recurse -Force | ForEach-Object {
  Get-RelativeFilePath ($payload.TrimEnd([char[]]'\\/') + [IO.Path]::DirectorySeparatorChar) $_.FullName
}
$cudaBoundaries = @(
  @{ Name = 'Torch CUDA'; Pattern = '(^|/)(torch_cuda|c10_cuda)' },
  @{ Name = 'cuDNN'; Pattern = '(^|/)cudnn[0-9_]*' },
  @{ Name = 'cuBLAS'; Pattern = '(^|/)cublas[0-9_]*' },
  @{ Name = 'CUDA ONNX Runtime'; Pattern = '(^|/)onnxruntime.*/onnxruntime_providers_cuda' },
  @{ Name = 'CUDA sherpa-onnx'; Pattern = '(^|/)(sherpa-onnx-cuda|sherpa_onnx/.+cuda)' }
)
if ($Variant -eq 'cpu') {
  foreach ($boundary in $cudaBoundaries) {
    if ($files | Where-Object { $_ -match $boundary.Pattern }) { throw "CPU payload contains $($boundary.Name) libraries." }
  }
} else {
  foreach ($boundary in $cudaBoundaries) {
    if (-not ($files | Where-Object { $_ -match $boundary.Pattern })) { throw "CUDA payload is missing $($boundary.Name) libraries." }
  }
}

$payloadIdentity = Get-TreeIdentity $payload @('VRCNT.runtime.json')
$identityInput = @(
  'VRCNT', $marker.version, $marker.variant, 'x64', $marker.sourceCommit,
  $marker.buildRecipe, $marker.sharedShellIdentity, $marker.backendPayloadIdentity, $payloadIdentity
) -join "`n"
$actualIdentity = Get-BytesSha256 ([Text.Encoding]::UTF8.GetBytes($identityInput))
if ($actualIdentity -ne $marker.buildIdentity) { throw 'The runtime identity marker does not match the physical payload.' }
