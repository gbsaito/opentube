# progress

## current task
- [ ] Build OpenTube TUI app per PLAN.md (phases 1-3 first, visual-first)

## status
- Phase 1 (scaffold + homescreen): DONE — ascii title, search box, quick access menu all render.
- Phase 2 (search + list + sidebar + playback wiring): DONE & verified live — yt-dlp search → results frame with thumbnails; mpv playback spawn wired.
- Phase 3 (quick access): PARTIAL — history + settings screens work; playlists/subscriptions visual-only (user decision).

## next moves
- Confirm phase 2-3 UX with user before building phase 4 (auth).

## key files
- `src/app.tsx` — screens, keyboard routing, sidebar
- `src/config.ts` — settings `.conf`, local stores
- `src/backends.ts` — yt-dlp / invidious / piped
- `src/player.ts` — mpv spawn
- `src/theme.ts` — colors
- `scripts/live_smoke.py` — pty TUI live smoke
- `src/smoke.test.tsx` — render smoke (bun test)

## decisions
- Playlists/subscriptions quick-access rows click NOTHING for now (visual only).
- History + settings only functional; playback + history writes still wired.
