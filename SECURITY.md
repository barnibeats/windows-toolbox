# Security policy

## Supported versions

Only the latest release of Windows Toolbox gets fixes. The app updates itself, so most people are on it within a day.

## Reporting a vulnerability

Please do not open a public issue. Use [Report a vulnerability](https://github.com/barnibeats/windows-toolbox/security/advisories/new) on the Security tab, which is private. Include what you did, what you expected and what happened. You will get an answer as soon as the maintainer can, and a fix before the details are made public.

## What counts

- The app installing or running something the user did not confirm, or a way around the Windows confirmation dialog.
- Tampering with the update channel (`latest.json`, the update download, the cached page).
- Script injection through catalog data or a shared set link.
- Anything that makes the page or the app send data to a third party.

## What does not

- Problems in an app that the catalog lists. Report those to the app's own maintainers.
- A listed app that has become unsafe or abandoned. Open a normal issue, and it will be removed.

## How the app protects you

- Every install is confirmed in a native Windows dialog that a web page cannot draw or click.
- The page is only replaced by a newer one that carries the Windows Toolbox marker.
- A new version of the app is installed only if its size, file header and version match what was announced and, for signed builds, the signature is from the same publisher.
- The app has no accounts and no analytics. The project's own requests go to GitHub and to this repository's GitHub Pages site.
