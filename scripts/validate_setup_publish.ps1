[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectPath,

    [Parameter(Mandatory = $true)]
    [string]$PublishOutputPath
)

$ErrorActionPreference = "Stop"

$projectPath = [System.IO.Path]::GetFullPath($ProjectPath)
$publishOutputPath = [System.IO.Path]::GetFullPath($PublishOutputPath)

if (-not (Test-Path -LiteralPath $projectPath -PathType Leaf)) {
    throw "Setup project does not exist: $projectPath"
}

if (-not (Test-Path -LiteralPath $publishOutputPath -PathType Container)) {
    throw "Setup publish output directory does not exist: $publishOutputPath"
}

$propertyNames = @(
    "PublishSingleFile",
    "SelfContained",
    "RuntimeIdentifier",
    "PublishTrimmed",
    "IncludeNativeLibrariesForSelfExtract",
    "UseWPF"
)
$propertyJson = & dotnet msbuild $projectPath -nologo ("-getProperty:{0}" -f ($propertyNames -join ","))
if ($LASTEXITCODE -ne 0) {
    throw "Could not evaluate Setup publish properties from $projectPath."
}

try {
    $properties = (($propertyJson -join [Environment]::NewLine) | ConvertFrom-Json).Properties
}
catch {
    throw "Could not parse evaluated Setup publish properties from dotnet msbuild: $($_.Exception.Message)"
}

$violations = [System.Collections.Generic.List[string]]::new()
$expectedProperties = [ordered]@{
    PublishSingleFile = "true"
    SelfContained = "true"
    RuntimeIdentifier = "win-x64"
    PublishTrimmed = "false"
    IncludeNativeLibrariesForSelfExtract = "true"
    UseWPF = "true"
}

foreach ($entry in $expectedProperties.GetEnumerator()) {
    $actual = [string]$properties.($entry.Key)
    if (-not [string]::Equals($actual, $entry.Value, [System.StringComparison]::OrdinalIgnoreCase)) {
        $violations.Add("$($entry.Key) must be '$($entry.Value)' but evaluated as '$actual'.")
    }
}

$setupPath = Join-Path $publishOutputPath "VRCNT.Setup.exe"
if (-not (Test-Path -LiteralPath $setupPath -PathType Leaf)) {
    $violations.Add("Published Setup executable is missing: $setupPath")
}
elseif ((Get-Item -LiteralPath $setupPath).Length -le 0) {
    $violations.Add("Published Setup executable is empty: $setupPath")
}

$nativeSidecars = @(
    "PresentationNative_cor3.dll",
    "wpfgfx_cor3.dll",
    "PenImc_cor3.dll",
    "D3DCompiler_47_cor3.dll",
    "vcruntime140_cor3.dll"
)
$presentNativeSidecars = @(
    $nativeSidecars |
        Where-Object { Test-Path -LiteralPath (Join-Path $publishOutputPath $_) -PathType Leaf }
)
if ($presentNativeSidecars.Count -gt 0) {
    $violations.Add("Published Setup still requires native sidecars: $($presentNativeSidecars -join ", ")")
}

if ($violations.Count -gt 0) {
    throw "Setup publish contract failed:`n - $($violations -join "`n - ")"
}

Write-Output "Setup publish contract validated: $setupPath"
