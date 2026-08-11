param(
  [string]$ToolDir = (Join-Path $PSScriptRoot '..\src-tauri\nsis\bin'),
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$toolDirectory = [IO.Path]::GetFullPath($ToolDir)
$requiredTools = @('7za.exe', 'minisign.exe', 'VRCNT.ReleaseHelper.exe')

function Get-Sha256([string]$Path) {
  $sha256 = [Security.Cryptography.SHA256]::Create()
  $stream = [IO.File]::OpenRead($Path)
  try {
    return (($sha256.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') }) -join '')
  } finally {
    $stream.Dispose()
    $sha256.Dispose()
  }
}

function Assert-InstallerTools {
  foreach ($tool in $requiredTools) {
    $path = Join-Path $toolDirectory $tool
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      throw "Bundled installer tool $tool is missing at $path."
    }

    if ((Get-Item -LiteralPath $path).Length -le 0) {
      throw "Bundled installer tool $tool is empty at $path."
    }
  }
}

function Find-SevenZip {
  $existing = Join-Path $toolDirectory '7za.exe'
  if (Test-Path -LiteralPath $existing -PathType Leaf) {
    return $existing
  }

  $command = Get-Command '7za.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($command) {
    return $command.Source
  }

  if ($env:ChocolateyInstall) {
    $chocolateyTool = Join-Path $env:ChocolateyInstall 'lib'
    if (Test-Path -LiteralPath $chocolateyTool) {
      $candidate = Get-ChildItem -LiteralPath $chocolateyTool -Recurse -File -Filter '7za.exe' -ErrorAction SilentlyContinue |
        Select-Object -First 1
      if ($candidate) {
        return $candidate.FullName
      }
    }
  }

  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  $isAdministrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  $choco = Get-Command 'choco.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($choco -and $isAdministrator) {
    Write-Host '7za.exe was not found; installing 7zip.commandline with Chocolatey.'
    & $choco.Source install 7zip.commandline -y --no-progress
    if ($LASTEXITCODE -eq 0 -and $env:ChocolateyInstall) {
      $chocolateyTool = Join-Path $env:ChocolateyInstall 'lib'
      $candidate = Get-ChildItem -LiteralPath $chocolateyTool -Recurse -File -Filter '7za.exe' -ErrorAction SilentlyContinue |
        Select-Object -First 1
      if ($candidate) {
        return $candidate.FullName
      }
    } elseif ($LASTEXITCODE -ne 0) {
      Write-Warning 'Chocolatey could not install 7zip.commandline; trying the per-user WinGet fallback.'
    }
  } elseif ($choco) {
    Write-Warning 'Chocolatey is available but this shell is not elevated; trying the per-user WinGet fallback.'
  }

  $winget = Get-Command 'winget.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($winget) {
    Write-Host '7za.exe was not available from Chocolatey; installing the per-user 7zip.7zr package with WinGet.'
    & $winget.Source install --id 7zip.7zr --scope user --silent --accept-package-agreements --accept-source-agreements | Out-Null
    $wingetExitCode = $LASTEXITCODE
    $command = Get-Command '7zr.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) {
      return $command.Source
    }

    $wingetPackageRoot = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    if (Test-Path -LiteralPath $wingetPackageRoot) {
      $candidate = Get-ChildItem -LiteralPath $wingetPackageRoot -Recurse -File -Filter '7zr.exe' -ErrorAction SilentlyContinue |
        Select-Object -First 1
      if ($candidate) {
        return $candidate.FullName
      }
    }

    if ($wingetExitCode -ne 0) {
      Write-Warning 'WinGet could not install or locate 7zip.7zr.'
    }
  }

  throw '7za.exe was not found. Install 7zip.commandline, 7zip.7zr, or provide src-tauri/nsis/bin/7za.exe.'
}

function Ensure-Minisign {
  $target = Join-Path $toolDirectory 'minisign.exe'
  if (Test-Path -LiteralPath $target -PathType Leaf) {
    if ((Get-Item -LiteralPath $target).Length -gt 0) {
      return
    }
  }

  $downloadRoot = Join-Path ([IO.Path]::GetTempPath()) 'vrcnt-installer-tools'
  New-Item -ItemType Directory -Path $downloadRoot -Force | Out-Null
  $archive = Join-Path $downloadRoot 'minisign-0.12-win64.zip'
  $extractRoot = Join-Path $downloadRoot 'minisign-0.12'
  $url = 'https://github.com/jedisct1/minisign/releases/download/0.12/minisign-0.12-win64.zip'
  $expectedHash = '37b600344e20c19314b2e82813db2bfdcc408b77b876f7727889dbd46d539479'

  $needsDownload = -not (Test-Path -LiteralPath $archive -PathType Leaf)
  if (-not $needsDownload) {
    $actualHash = (Get-Sha256 $archive).ToLowerInvariant()
    $needsDownload = $actualHash -ne $expectedHash
  }

  if ($needsDownload) {
    Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
    Write-Host 'Downloading and verifying minisign 0.12.'
    $curl = Get-Command 'curl.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($curl) {
      & $curl.Source -L --fail --retry 3 -o $archive $url
      if ($LASTEXITCODE -ne 0) {
        throw 'Could not download minisign 0.12.'
      }
    } else {
      Invoke-WebRequest -Uri $url -OutFile $archive
    }
  }

  $actualHash = (Get-Sha256 $archive).ToLowerInvariant()
  if ($actualHash -ne $expectedHash) {
    throw "minisign archive SHA-256 mismatch: expected $expectedHash, got $actualHash."
  }

  if (Test-Path -LiteralPath $extractRoot) {
    Remove-Item -LiteralPath $extractRoot -Recurse -Force
  }
  Expand-Archive -LiteralPath $archive -DestinationPath $extractRoot -Force
  $candidate = Get-ChildItem -LiteralPath $extractRoot -Recurse -File -Filter 'minisign.exe' |
    Where-Object { $_.FullName -match 'x86_64' } |
    Select-Object -First 1
  if (-not $candidate) {
    throw 'The verified minisign 0.12 archive did not contain the x86_64 executable.'
  }

  Copy-Item -LiteralPath $candidate.FullName -Destination $target -Force
}

if ($CheckOnly) {
  Assert-InstallerTools
  Write-Host "Installer tools are ready in $toolDirectory."
  exit 0
}

try {
  New-Item -ItemType Directory -Path $toolDirectory -Force | Out-Null

  $sevenZipSource = Find-SevenZip
  $sevenZipTarget = Join-Path $toolDirectory '7za.exe'
  if (-not [string]::Equals(
      [IO.Path]::GetFullPath($sevenZipSource),
      [IO.Path]::GetFullPath($sevenZipTarget),
      [StringComparison]::OrdinalIgnoreCase)) {
    Copy-Item -LiteralPath $sevenZipSource -Destination $sevenZipTarget -Force
  }

  Ensure-Minisign

  $dotnet = Get-Command 'dotnet.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $dotnet) {
    throw 'dotnet.exe is required to publish VRCNT.ReleaseHelper.exe.'
  }

  $helperProject = Join-Path $repoRoot 'installer-helper\VRCNT.ReleaseHelper.csproj'
  $helperPublish = Join-Path $repoRoot 'installer-helper\publish'
  Write-Host 'Publishing VRCNT.ReleaseHelper.exe.'
  & $dotnet.Source publish $helperProject -c Release -r win-x64 --self-contained true `
    '-p:PublishSingleFile=true' '-p:PublishTrimmed=false' -o $helperPublish
  if ($LASTEXITCODE -ne 0) {
    throw 'Installer helper publish failed.'
  }

  $helper = Join-Path $helperPublish 'VRCNT.ReleaseHelper.exe'
  if (-not (Test-Path -LiteralPath $helper -PathType Leaf)) {
    throw "Installer helper publish completed without producing $helper."
  }
  Copy-Item -LiteralPath $helper -Destination (Join-Path $toolDirectory 'VRCNT.ReleaseHelper.exe') -Force

  Assert-InstallerTools
  Write-Host "Installer tools are ready in $toolDirectory."
} catch {
  Write-Error $_
  exit 1
}
