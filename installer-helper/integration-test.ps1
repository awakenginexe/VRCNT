param(
  [Parameter(Mandatory = $true)][string]$SevenZip,
  [Parameter(Mandatory = $true)][string]$Minisign
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$SevenZip = (Resolve-Path $SevenZip).Path
$Minisign = (Resolve-Path $Minisign).Path
$testRoot = Join-Path $repoRoot 'tmp/release-helper-integration'
$previousLocalAppData = $env:LOCALAPPDATA
$resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
$resolvedRepoRoot = [IO.Path]::GetFullPath($repoRoot) + [IO.Path]::DirectorySeparatorChar
if (-not $resolvedTestRoot.StartsWith($resolvedRepoRoot, [StringComparison]::OrdinalIgnoreCase) -or
    (Split-Path -Leaf $resolvedTestRoot) -ne 'release-helper-integration') {
  throw "Unsafe integration-test directory: $resolvedTestRoot"
}
if (Test-Path $testRoot) {
  Remove-Item -LiteralPath $testRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$env:LOCALAPPDATA = Join-Path $testRoot 'local-app-data'

function Invoke-Helper([string]$InstallerDirectory, [string]$CacheDirectory, [string]$Destination, [string]$BaseUrl) {
  $arguments = @(
    '--version', '4.2.2',
    '--release-base-url', $BaseUrl,
    '--installer-directory', $InstallerDirectory,
    '--cache-directory', $CacheDirectory,
    '--destination', $Destination,
    '--manifest-name', 'package-manifest.json',
    '--signature-name', 'package-manifest.json.sig',
    '--part-count', '3',
    '--sevenzip', $SevenZip,
    '--minisign', $Minisign
  )
  $output = & $script:helperExe @arguments 2>&1 | Out-String
  return @{ ExitCode = $LASTEXITCODE; Output = $output }
}

try {
  $payload = Join-Path $testRoot 'payload'
  New-Item -ItemType Directory -Path "$payload/frontend", "$payload/_internal" -Force | Out-Null
  Set-Content -LiteralPath "$payload/VRCNT.exe" -Value 'test executable' -Encoding utf8
  Set-Content -LiteralPath "$payload/VRCNT-backend.exe" -Value 'test backend' -Encoding utf8
  Set-Content -LiteralPath "$payload/VRCNT.runtime.json" -Value '{"product":"VRCNT","version":"4.2.2","variant":"Cpu","architecture":"x64","buildIdentity":"fixture-cpu"}' -Encoding utf8
  Set-Content -LiteralPath "$payload/frontend/index.html" -Value '<html>test</html>' -Encoding utf8
  Set-Content -LiteralPath "$payload/_internal/runtime.txt" -Value 'runtime' -Encoding utf8

  $release = Join-Path $testRoot 'release'
  New-Item -ItemType Directory -Path $release -Force | Out-Null
  $archive = Join-Path $release 'VRCNT_4.2.2.7z'
  Push-Location $payload
  try {
    & $SevenZip a -t7z -mx=1 $archive VRCNT.exe VRCNT-backend.exe VRCNT.runtime.json frontend _internal | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Fixture archive generation failed.' }
  } finally {
    Pop-Location
  }

  $python = @'
import pathlib, sys
sys.path.insert(0, sys.argv[1])
from release import split_exactly
import hashlib, json
root = pathlib.Path(sys.argv[2])
payload = pathlib.Path(sys.argv[3])
parts = split_exactly(root / "VRCNT_4.2.2.7z", 3, 2_000_000_000)
entries = [{"name": part.name, "size": part.stat().st_size, "sha256": hashlib.sha256(part.read_bytes()).hexdigest()} for part in parts]
digest = hashlib.sha256(b"fixture").hexdigest()
marker_sha256 = hashlib.sha256((payload / "VRCNT.runtime.json").read_bytes()).hexdigest()
manifest = {
  "schema": 1, "product": "VRCNT", "version": "4.2.2", "architecture": "x64",
  "bootstrapper": {"name": "VRCNT-setup.exe", "size": 1, "sha256": digest, "managerProtocol": 1, "manifestSchema": 1, "runtimeStateSchema": 1, "activationProtocol": 1},
  "variants": {"cpu": {"archiveFormat": "7z", "compressedSize": sum(item["size"] for item in entries), "installedSize": 1, "parts": entries, "requiresNvidia": False, "markerPath": "VRCNT.runtime.json", "identity": {"product": "VRCNT", "version": "4.2.2", "variant": "Cpu", "architecture": "x64", "buildIdentity": "fixture-cpu", "markerSha256": marker_sha256}}}
}
(root / "package-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
'@
  $python | python - (Join-Path $repoRoot 'utils') $release $payload
  if ($LASTEXITCODE -ne 0) { throw 'Fixture multipart generation failed.' }

  $publicKey = Join-Path $testRoot 'manifest.pub'
  $secretKey = Join-Path $testRoot 'manifest.key'
  & $Minisign -G -p $publicKey -s $secretKey -W
  if ($LASTEXITCODE -ne 0) { throw 'Fixture signing key generation failed.' }
  $rawSignature = Join-Path $testRoot 'manifest.minisig'
  & $Minisign -Sm "$release/package-manifest.json" -s $secretKey -x $rawSignature
  if ($LASTEXITCODE -ne 0) { throw 'Fixture manifest signing failed.' }
  [IO.File]::WriteAllText(
    "$release/package-manifest.json.sig",
    [Convert]::ToBase64String([IO.File]::ReadAllBytes($rawSignature))
  )

  $testProject = Join-Path $testRoot 'helper'
  New-Item -ItemType Directory -Path $testProject -Force | Out-Null
  Copy-Item "$PSScriptRoot/VRCNT.ReleaseHelper.csproj" "$testProject/VRCNT.ReleaseHelper.csproj"
  Copy-Item "$PSScriptRoot/Program.cs" "$testProject/Program.cs"
  Copy-Item "$PSScriptRoot/VRCNT.RuntimeCore" "$testProject/VRCNT.RuntimeCore" -Recurse
  Remove-Item -LiteralPath "$testProject/VRCNT.RuntimeCore/bin", "$testProject/VRCNT.RuntimeCore/obj" -Recurse -Force -ErrorAction SilentlyContinue
  $productionKey = 'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDY4NTYzNUI0QUI2RTI4RkMKUldUOEtHNnJ0RFZXYUt4L1cwOVhIL1NtZXJGQkxzZkVVYXMrWGJZQlZ5NFNPdldRMk9RdUkrVCsK'
  $fixtureKey = [Convert]::ToBase64String([IO.File]::ReadAllBytes($publicKey))
  $verifierPath = "$testProject/VRCNT.RuntimeCore/Security/MinisignVerifier.cs"
  $verifierSource = Get-Content -Raw $verifierPath
  if (-not $verifierSource.Contains($productionKey)) { throw 'Production embedded public key was not found.' }
  Set-Content -LiteralPath $verifierPath -Value $verifierSource.Replace($productionKey, $fixtureKey) -Encoding utf8
  dotnet publish "$testProject/VRCNT.ReleaseHelper.csproj" -c Release -o "$testProject/publish"
  if ($LASTEXITCODE -ne 0) { throw 'Fixture helper build failed.' }
  $script:helperExe = "$testProject/publish/VRCNT.ReleaseHelper.exe"

  $localDestination = Join-Path $testRoot 'local-install'
  $local = Invoke-Helper $release (Join-Path $testRoot 'local-cache') $localDestination 'http://127.0.0.1:1'
    if ($local.ExitCode -ne 0 -or -not (Test-Path "$localDestination/VRCNT.exe")) {
    throw "Local multipart installation failed:`n$($local.Output)"
  }
  if ($local.Output -notmatch 'Found all signed manifest-selected package files beside the installer') {
    throw 'Local installation did not select the adjacent package path.'
  }

  $existingExecutable = [IO.File]::ReadAllText("$localDestination/VRCNT.exe")
  Set-Content -LiteralPath "$localDestination/VRCNT.runtime.json" -Value '{"product":"VRCNT","version":"4.2.2","variant":"Cpu","architecture":"x64","buildIdentity":"tampered"}' -Encoding utf8
  $blockedReplacement = Invoke-Helper $release (Join-Path $testRoot 'blocked-cache') $localDestination 'http://127.0.0.1:1'
  if ($blockedReplacement.ExitCode -eq 0 -or [IO.File]::ReadAllText("$localDestination/VRCNT.exe") -ne $existingExecutable) {
    throw "Existing runtime replacement was not blocked before overwrite:`n$($blockedReplacement.Output)"
  }

  $portable = Join-Path $testRoot 'portable'
  & $SevenZip x -y "${release}/VRCNT_4.2.2.7z.001" "-o$portable" | Out-Null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path "$portable/VRCNT.exe")) {
    throw 'Manual portable extraction failed.'
  }

  $badHash = Join-Path $testRoot 'bad-hash'
  Copy-Item $release $badHash -Recurse
  $bytes = [IO.File]::ReadAllBytes("$badHash/VRCNT_4.2.2.7z.001")
  $bytes[0] = $bytes[0] -bxor 1
  [IO.File]::WriteAllBytes("$badHash/VRCNT_4.2.2.7z.001", $bytes)
  $rejectedHash = Invoke-Helper $badHash (Join-Path $testRoot 'bad-hash-cache') (Join-Path $testRoot 'bad-hash-install') 'http://127.0.0.1:1'
  if ($rejectedHash.ExitCode -eq 0 -or $rejectedHash.Output -notmatch 'SHA-256 mismatch') {
    throw 'Invalid package hash was not rejected clearly.'
  }

  $badSignature = Join-Path $testRoot 'bad-signature'
  Copy-Item $release $badSignature -Recurse
  Set-Content "$badSignature/package-manifest.json.sig" -Value 'not-a-valid-signature' -Encoding ascii
  $rejectedSignature = Invoke-Helper $badSignature (Join-Path $testRoot 'bad-signature-cache') (Join-Path $testRoot 'bad-signature-install') 'http://127.0.0.1:1'
  if ($rejectedSignature.ExitCode -eq 0 -or $rejectedSignature.Output -notmatch 'manifest signature verification failed') {
    throw 'Invalid manifest signature was not rejected before package hashes.'
  }

  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $listener.Start()
  $port = ([Net.IPEndPoint]$listener.LocalEndpoint).Port
  $listener.Stop()
  $server = Start-Process node -ArgumentList @("$PSScriptRoot/TestServer.mjs", $release, $port) -PassThru -WindowStyle Hidden
  try {
    Start-Sleep -Milliseconds 500
    $onlineInstaller = Join-Path $testRoot 'online-installer'
    $onlineCache = Join-Path $testRoot 'online-cache'
    New-Item -ItemType Directory -Path $onlineInstaller, $onlineCache -Force | Out-Null
    $firstPart = [IO.File]::ReadAllBytes("$release/VRCNT_4.2.2.7z.001")
    [IO.File]::WriteAllBytes(
      "$onlineCache/VRCNT_4.2.2.7z.001.partial",
      $firstPart[0..([Math]::Min(31, $firstPart.Length - 1))]
    )
    $onlineDestination = Join-Path $testRoot 'online-install'
    $online = Invoke-Helper $onlineInstaller $onlineCache $onlineDestination "http://127.0.0.1:$port"
    if ($online.ExitCode -ne 0 -or -not (Test-Path "$onlineDestination/VRCNT.exe")) {
      throw "Online installation failed:`n$($online.Output)"
    }
  } finally {
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
  }

  Write-Output 'Release helper integration scenarios passed: local, online, resume, signature/hash rejection, and portable extraction.'
} finally {
  if ($null -eq $previousLocalAppData) { Remove-Item Env:LOCALAPPDATA -ErrorAction SilentlyContinue } else { $env:LOCALAPPDATA = $previousLocalAppData }
  if (Test-Path $testRoot) {
    Remove-Item -LiteralPath $testRoot -Recurse -Force
  }
}
