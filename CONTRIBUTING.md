# Contributing

Thanks for helping. The most useful contribution is a good app in the catalog, and that takes one line.

## Add or fix an app

Edit [`catalog.json`](catalog.json). You can do it right on github.com. One app is one line inside a group's `items`:

```json
{"n":"Windhawk","r":"ramensoftware/windhawk","w":"RamenSoftware.Windhawk","d":{"en":"Mod store: taskbar, Start menu, tray, clock","uk":"Магазин модів: панель завдань, «Пуск», трей, годинник","ru":"Магазин модов: панель задач, «Пуск», трей, часы"}}
```

| Field | Meaning |
| --- | --- |
| `n` | name as the project writes it |
| `r` | `owner/repo` on GitHub, or a full URL for projects that live elsewhere |
| `w` | winget ID, optional. Find it with `winget search <name>`. Without it the app has no Install button |
| `d` | one short description (about 60 characters) in `en`, `uk` and `ru` |
| `archived` | optional `true`: the repository is archived but the app is still worth listing |

An app belongs in the catalog when it is:

- free and open source, with a build that runs on Windows;
- still useful, preferably maintained. Archived projects need `"archived": true` and a good reason;
- not already listed (the same `r` twice is rejected).

Pick the section and group where people would look for it. If its releases have no ready Windows file, add the download page to `downloadOverrides` at the end of the file.

## Check your change

```powershell
npm ci
npm test
```

This validates the catalog (all three languages are required for new entries), builds the page and runs the interface tests in a real browser. To check repositories, releases and winget IDs against GitHub:

```powershell
$env:GITHUB_TOKEN = "<a token with no scopes>"
node tools/resolve.mjs        # then read problems.md
```

## Change the interface

The page is `site/index.html`. The tests in `tools/test-ui.mjs` describe what the desktop app and users rely on: the host messages, element ids, storage keys. Keep them passing, and add a test for new behavior. The page must not request anything from the network at load time and must work offline and from `file://`. After a visible change, refresh the screenshots with `node tools/screenshots.mjs`.

## Change the desktop app

The code is in `app/`. `app\build.ps1` builds `WindowsToolbox.exe` with the C# compiler that ships with Windows. Local builds are marked `-dev` and do not update themselves.

## Pull requests

Keep them small and in one topic. Write commit messages in English, in the imperative ("Add Zen Browser"). The checks in `.github/workflows/ci.yml` must pass.

## Releasing (maintainers)

```powershell
git tag v1.3.1
git push origin v1.3.1
```

The tag builds `WindowsToolbox.exe`, signs it when the Azure secrets are set, publishes the release with the winget manifests, and refreshes `latest.json` on GitHub Pages, which installed apps read. The catalog itself is published on every push to `main` and every day.
