# progress

## current task
- [ ] Build OpenTube TUI app per PLAN.md (phases 1-3 first, visual-first)

## status
- Phase 1 (scaffold, homescreen): DONE — ascii title, search box, quick access menu.
- Phase 2 (search + list + sidebar + playback wiring): DONE & verified live — yt-dlp search → results frame; mpv wired.
- Phase 3 (quick access): PARTIAL — history + settings work; playlists/subscriptions visual-only (user decision).

## next moves
- Phase 3 polish (history works) then ask user feedback before phase 4 (auth).
- Sidebar now mirrors yt-x: image via kitty protocol + fit, no dividers, tight rows, `Channel:` / `Upload Date:` rows, plain description.

## key files
- `src/app.tsx` — screens, keyboard routing, sidebar
- `src/config.ts` — settings `.conf`, local stores
- `src/backends.ts` — yt-dlp / invidious / piped
- `src/player.ts` — mpv spawn
- `src/theme.ts` — colors
- `scripts/live_smoke.py` — pty TUI smoke
- `src/smoke.test.tsx` — render smoke (bun test)

## decisions
- Playlists/subscriptions quick-access rows click NOTHING for now (visual only).
- History + settings only functional; playback + history writes still wired.
- yt-x sidebar parity: drop `--flat-playlist` (strips upload_date), map `description`.
