# Approved Tube Kids

A Windows/Linux Electron app for watching only manually approved YouTube channels and videos.

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
15. Parent Admin can list and restore automatic settings backup snapshots.
16. Hidden videos keep title/channel/thumbnail metadata for easier restoration.
17. Watch mode supports Favorites and Recently Watched quick filters.
18. Parent Admin can configure daily viewing minutes and quiet hours.
19. Parent Admin can approve individual videos without approving the whole channel.
20. Unit tests cover parser, settings migration, and allowlist behavior.
21. UI-flow tests cover PIN gating, approval, blacklist, review, and backup state decisions.

## Run

Node.js 22.12 or newer is required.

```bash
npm ci
npm run dev
```

On Linux, `npm run dev` checks Electron's runtime before starting. If the Electron runtime was not downloaded during install, the preflight will download it. If it reports missing system libraries, install the listed packages and rerun `npm run dev`.

## Test

```bash
npm test
```

## Package

```bash
npm run package:linux
npm run package:windows
```

`npm run package:linux` builds an AppImage. To build a Debian package, run `npm run package:linux:deb`; that requires `binutils` for the `ar` executable. Packaging regenerates icons and builds the renderer first. The app includes generated PNG/ICO icon assets under `build/`. Windows packaging is best run from Windows.

See `RELEASE.md` for the manual release checklist.

## Approving Channels

Manual approval works without an API key for `UC...` channel IDs, channel URLs containing an ID, exact `@handles`, and handle URLs. Handle resolution fetches the public YouTube channel page and extracts its canonical channel ID. An API key is only needed for channel-name search and Discover mode. Bulk approval accepts one channel per line, including `Channel Name | UC...` or `Channel Name | @handle`.

Discovery requires a YouTube Data API key. Add it in Parent Admin, then search for English channel candidates. Click `Review` to inspect recent uploads before approving the channel. Click `X` or `Blacklist` on a discovery result to hide it from future discovery searches.

## Approving Videos

Parent Admin can approve one specific video by YouTube URL or 11-character video ID. This adds the video to Watch mode without approving the rest of that video's channel.

## Parent PIN

Open Parent Admin and set a 4-8 digit PIN in the Parent PIN section. After that, Parent Admin requires the PIN until it is unlocked. Use `Lock Admin` before handing the app back to a child.

## Backups

Use Parent Admin to export or import settings. Exports include approved channels, categories, notes, and the discovery blacklist. Exports do not include the parent PIN hash or YouTube API key.

The app keeps local backup snapshots before imports and destructive changes like removing channels or categories. These backups live in the app user-data directory under `settings-backups`.

Use `Show Backups` in Parent Admin to list recent automatic snapshots and restore one. Restoring a backup preserves the current parent PIN and YouTube API key.

## Offline Behavior

The app caches each approved channel RSS feed after a successful refresh. If YouTube RSS is temporarily unavailable later, Watch mode can fall back to the last cached feed for that channel.

## Hidden Videos And Logs

Unlock Parent Admin to reveal `Hide` buttons in Watch mode. Hidden videos disappear from Watch mode until restored in Parent Admin. The Troubleshooting Log section shows recent feed/API failures from the local app log.

Hidden video entries keep their title, channel, thumbnail, and hidden date when available, even if the video later drops out of the current channel feed.

YouTube API failures are translated into clearer parent-facing messages when possible, including invalid API key, denied API access, and quota exhaustion.

## Favorites And Recent

Use the `Favorite` button on a video card to add it to the Favorites filter. Starting a video records it in Recently Watched, which appears under the `Recent` quick filter.

## Viewing Limits

Parent Admin includes simple viewing limits. When enabled, the app counts one minute while a video is selected in Watch mode, blocks playback after the daily minute limit, and can block playback during configured quiet hours.

## Safety Notes

This app avoids general browsing and only builds video lists from approved channel IDs and approved individual video IDs. The Electron shell blocks top-level navigation away from the app, denies browser permission prompts, and limits iframe navigation to YouTube embed domains. The embedded YouTube player is still a YouTube-controlled iframe, so future hardening should continue reducing player escape paths.
