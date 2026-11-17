# Writes winget manifests (version, installer, defaultLocale) for a released WindowsToolbox.exe.
# The release workflow attaches them as winget-manifests.zip; submitting them to
# microsoft/winget-pkgs is a manual pull request (see CONTRIBUTING.md).
#
#   .\tools\winget-manifest.ps1 -Version v1.2.0 -Exe WindowsToolbox.exe -Out winget
param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$Repo = "barnibeats/windows-toolbox",
    [string]$Exe = "WindowsToolbox.exe",
    [string]$Out = "winget"
)
$ErrorActionPreference = "Stop"
$ver = $Version -replace '^v', ''
$tag = "v$ver"
$id = "barnibeats.WindowsToolbox"
$owner = $Repo.Split('/')[0]
$sha = (Get-FileHash -Algorithm SHA256 $Exe).Hash
$dir = Join-Path $Out "manifests\b\barnibeats\WindowsToolbox\$ver"
New-Item -ItemType Directory -Force $dir | Out-Null
$schema = "1.6.0"

@"
# yaml-language-server: `$schema=https://aka.ms/winget-manifest.version.$schema.schema.json
PackageIdentifier: $id
PackageVersion: $ver
DefaultLocale: en-US
ManifestType: version
ManifestVersion: $schema
"@ | Set-Content -Encoding UTF8 (Join-Path $dir "$id.yaml")

@"
# yaml-language-server: `$schema=https://aka.ms/winget-manifest.installer.$schema.schema.json
PackageIdentifier: $id
PackageVersion: $ver
InstallerType: portable
Commands:
- windows-toolbox
Installers:
- Architecture: x64
  InstallerUrl: https://github.com/$Repo/releases/download/$tag/WindowsToolbox.exe
  InstallerSha256: $sha
ManifestType: installer
ManifestVersion: $schema
"@ | Set-Content -Encoding UTF8 (Join-Path $dir "$id.installer.yaml")

@"
# yaml-language-server: `$schema=https://aka.ms/winget-manifest.defaultLocale.$schema.schema.json
PackageIdentifier: $id
PackageVersion: $ver
PackageLocale: en-US
Publisher: $owner
PublisherUrl: https://github.com/$owner
PackageName: Windows Toolbox
PackageUrl: https://github.com/$Repo
License: MIT
ShortDescription: A catalog of open-source Windows apps with one-click downloads and winget installs.
Description: Personalization, gaming, administration and system tweaking apps from GitHub, built-in Windows tricks and handy commands. English, Ukrainian and Russian.
Tags:
- catalog
- gaming
- sysadmin
- tweaks
- winget
ReleaseNotesUrl: https://github.com/$Repo/releases/tag/$tag
ManifestType: defaultLocale
ManifestVersion: $schema
"@ | Set-Content -Encoding UTF8 (Join-Path $dir "$id.locale.en-US.yaml")

Write-Host "winget manifests written to $dir (sha256 $sha)"
