# Approved Tube Kids

A Windows/Linux Electron app for watching only manually approved YouTube channels.

## MVP Plan

1. Watch mode only lists videos from approved channel RSS feeds.
2. Parent Admin mode manages the local channel allowlist.
3. Discovery mode is parent-only and uses YouTube Data API search with `relevanceLanguage=en`, `regionCode=US`, and `safeSearch=strict`.
4. Playback uses `youtube-nocookie.com` embeds, not open YouTube browsing.
5. Discovery results can be reviewed with recent uploads before approval, or blacklisted with the `X` button so low-quality channels stop appearing.
6. Parent Admin can be protected with a local 4-8 digit PIN.
7. Approved channels have categories, notes, language, and enable/disable state.
8. Settings can be exported and imported for backup without including the PIN hash or YouTube API key.
9. Watch mode has large channel tiles and category filters for a simpler toddler-facing browsing flow.
10. Approved channel feeds are cached locally and reused if a later RSS refresh fails.
11. Parent Admin can hide individual videos and restore them later.
12. Feed and API failures are written to a local troubleshooting log.
13. Imports are validated before applying, and destructive settings changes create local backup snapshots.
14. YouTube API key/quota failures show parent-readable diagnostics.

## Run

```bash
npm install
npm run dev
```

## Package

```bash
npm run package:linux
npm run package:windows
```

Windows packaging is best run from Windows or a CI runner configured for Windows builds.

## Approving Channels

Manual approval works without an API key if you paste a YouTube channel ID that starts with `UC`. If you add a YouTube Data API key, manual approval can also resolve `@handles` and handle URLs. Bulk approval accepts one channel per line, including `Channel Name | UC...` or `Channel Name | @handle`.

Discovery requires a YouTube Data API key. Add it in Parent Admin, then search for English channel candidates. Click `Review` to inspect recent uploads before approving the channel. Click `X` or `Blacklist` on a discovery result to hide it from future discovery searches.

## Parent PIN

Open Parent Admin and set a 4-8 digit PIN in the Parent PIN section. After that, Parent Admin requires the PIN until it is unlocked. Use `Lock Admin` before handing the app back to a child.

## Backups

Use Parent Admin to export or import settings. Exports include approved channels, categories, notes, and the discovery blacklist. Exports do not include the parent PIN hash or YouTube API key.

The app keeps local backup snapshots before imports and destructive changes like removing channels or categories. These backups live in the app user-data directory under `settings-backups`.

## Offline Behavior

The app caches each approved channel RSS feed after a successful refresh. If YouTube RSS is temporarily unavailable later, Watch mode can fall back to the last cached feed for that channel.

## Hidden Videos And Logs

Unlock Parent Admin to reveal `Hide` buttons in Watch mode. Hidden videos disappear from Watch mode until restored in Parent Admin. The Troubleshooting Log section shows recent feed/API failures from the local app log.

YouTube API failures are translated into clearer parent-facing messages when possible, including invalid API key, denied API access, and quota exhaustion.

## Safety Notes

This app avoids general browsing and only builds video lists from approved channel IDs. The Electron shell blocks top-level navigation away from the app, denies browser permission prompts, and limits iframe navigation to YouTube embed domains. The embedded YouTube player is still a YouTube-controlled iframe, so future hardening should continue reducing player escape paths.
