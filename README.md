# Approved Tube Kids

A Windows/Linux Electron app for watching only manually approved YouTube channels.

## MVP Plan

1. Watch mode only lists videos from approved channel RSS feeds.
2. Parent Admin mode manages the local channel allowlist.
3. Discovery mode is parent-only and uses YouTube Data API search with `relevanceLanguage=en`, `regionCode=US`, and `safeSearch=strict`.
4. Playback uses `youtube-nocookie.com` embeds, not open YouTube browsing.
5. Discovery results can be reviewed with recent uploads before approval, or blacklisted with the `X` button so low-quality channels stop appearing.
6. Parent Admin can be protected with a local 4-8 digit PIN.

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

Manual approval works without an API key if you paste a YouTube channel ID that starts with `UC`. If you add a YouTube Data API key, manual approval can also resolve `@handles` and handle URLs.

Discovery requires a YouTube Data API key. Add it in Parent Admin, then search for English channel candidates. Click `Review` to inspect recent uploads before approving the channel. Click `X` or `Blacklist` on a discovery result to hide it from future discovery searches.

## Parent PIN

Open Parent Admin and set a 4-8 digit PIN in the Parent PIN section. After that, Parent Admin requires the PIN until it is unlocked. Use `Lock Admin` before handing the app back to a child.

## Safety Notes

This app avoids general browsing and only builds video lists from approved channel IDs. The Electron shell blocks top-level navigation away from the app, denies browser permission prompts, and limits iframe navigation to YouTube embed domains. The embedded YouTube player is still a YouTube-controlled iframe, so future hardening should continue reducing player escape paths.
