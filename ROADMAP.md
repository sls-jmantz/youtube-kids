# Production Roadmap

This tracks the work needed to make the app reliable for daily family use. Escape/kiosk prevention is intentionally out of scope for now.

## In Progress

- UI tests for PIN, approval, blacklist, review, and backup flows.

## Next

- Manual release packaging checklist.

## Later

- Installer smoke testing on Windows and Linux.

## Done

- Approved-channel-only watch mode.
- Parent Admin mode.
- Manual and bulk channel approval.
- Discovery with English-focused filtering.
- One-click discovery blacklist.
- Discovery review panel with recent uploads.
- Parent PIN gate for Admin mode.
- Versioned settings schema and migration support.
- Richer approved-channel records with metadata and enable/disable state.
- Parent backup/import/export controls.
- Channel categories and Watch mode category filters.
- Channel tiles for the child home screen.
- Feed caching and offline-friendly startup behavior.
- Improved Watch mode empty state for filtered results.
- Per-video hide/unhide controls.
- Local app log for troubleshooting feed/API failures.
- API quota and invalid-key diagnostics.
- Settings backup history before destructive changes.
- Import validation with readable error messages.
- Export/import UI for choosing and restoring from automatic backup snapshots.
- Better hidden-video details when a video is not in the current feed cache.
- Favorites and recently watched.
- Optional daily time windows and simple viewing limits.
- Individual video allowlist support.
- Clear loading, empty, and error states across network actions.
- App icons and release metadata.
- Unit tests for parsers, settings migrations, and allowlist behavior.
