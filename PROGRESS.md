# progress

## current task
- [ ] Build OpenTube TUI app per PLAN.md (phases 1-3 first, visual-first)

## status
- Phase 1 (scaffold, homescreen): DONE in `src/` — ascii title, search box, quick access menu.
- Phase 2 (search + list + sidebar): IN PROGRESS — backend, player, list/sidebar wiring done; live check pending.
- Phase 3 (quick access working screens): PARTIAL — history + settings work; playlists/subscriptions visual-only (as decided).

## next moves
- Live pty smoke for results screen + playback triggers.
- Add user feedback step after phase 3 done.

## key files
- `src/app.tsx` — screens, keyboard routing, sidebar
- `src/config.ts` — settings `.conf`, local stores
- `src/backends.ts` — yt-dlp / invidious / piped
- `src/player.ts` — mpv spawn
- `src/theme.ts` — colors
- `scripts/live_smoke.py` — pty TUI smoke
- `src/smoke.test.tsx` — render smoke
