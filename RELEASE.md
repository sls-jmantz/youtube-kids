# Manual Release Checklist

Use this checklist when creating a local release package. Do not add GitHub Actions or workflow files.

## Before Packaging

1. Confirm the working tree is clean with `git status --short`.
2. Confirm the version in `package.json` is correct.
3. Run `node scripts/check-linux-deps.cjs` on Linux.
4. Regenerate icons with `npm run icons` if `scripts/generate-icons.cjs` changed.
5. Run `npm test`.
6. Run `npm run build`.
7. Run `node --check electron/main.cjs`.
8. Run `node --check electron/preload.cjs`.
9. Run `node --check scripts/generate-icons.cjs`.
10. Run `node --check scripts/check-linux-deps.cjs`.
11. Run `node --check scripts/check-built-app.cjs`.
12. Run `npx electron-builder --linux dir` on Linux to validate packaging metadata quickly.

## Linux Packages

1. Run `npm run package:linux` on Linux.
2. Confirm `release/` contains an AppImage.
3. Launch the AppImage locally and confirm Watch mode opens.
4. If a Debian package is needed, install `binutils`, run `npm run package:linux:deb`, and confirm `release/` contains a deb package.
5. Install the deb package on a disposable/test machine if possible.
6. Confirm app data persists across app restart.

## Windows Package

1. Run `npm run package:windows` on Windows.
2. Confirm `release/` contains an NSIS installer.
3. Install on a disposable/test Windows user profile.
4. Confirm the Start Menu entry, app icon, and uninstall entry appear.
5. Confirm Parent Admin, settings persistence, and video playback work.

## Release Notes

Include these in release notes:

1. App version.
2. Supported platforms and package types.
3. Notable new features.
4. Known limitations.
5. Manual verification performed.
