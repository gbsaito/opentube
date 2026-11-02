# progress

## current task
- [ ] Build OpenTube TUI app per PLAN.md (phases 1-3 done; phase 4 auth optional)

## status
- Phase 1 (scaffold, homescreen): DONE — ascii title, search box, quick access menu.
- Phase 2 (search + list + sidebar + playback wiring): DONE & verified live.
- Phase 3 (quick access): DONE — history + settings functional; playlists/subscriptions visual-only (user decision).
- Piped backend removed; settings now two backends (yt-dlp / invidious), instance + count rows.

## next moves
- Ask user feedback on pagination implementation before phase 4 (auth).

## key files
- `src/app.tsx` — screens, keyboard routing, sidebar, settings cycle, shared pager
- `src/config.ts` — settings `.conf`, local stores
- `src/backends.ts` — yt-dlp (fast flat rows) / invidious + lazy per-video metadata + continuation paging
- `src/player.ts` — mpv spawn
- `src/theme.ts` — colors
- `scripts/live_smoke.py` — pty TUI smoke
- `src/smoke.test.tsx` — render smoke (bun test)
- `src/videometa.test.ts` — lazy metadata fetch check (bun test)

## decisions
- Playlists/subscriptions quick-access rows click NOTHING for now (visual only).
- Backend pools: invidious instance pool cycled with left/right in settings; piped gone.
- yt-dlp search uses `--flat-playlist`: 25 rows in ~3s (old full-metadata crawl took ~90s).
- Rows missing date (yt-dlp flat) / description (invidious) get filled lazily for the selected video via invidious `/api/v1/videos/{id}` (instance pool raced in parallel), cached per session; history/playlists/subscriptions entries store filled meta at add-time.
- Pagination is one shared pager (page size = results_count): every list screen windows its rows with ←/→; results additionally fetch continuation rows behind the window (invidious API pages of 20 chained to fill result_count windows; yt-dlp re-crawls ytsearch to `target` and slices). Header shows `page x/y+` — `+` means more pages may exist.

## bugs fixed
- `/` toggles search <-> quick access without appending `/` to the search field (preventDefault).
- Settings editor: backspace worked (DEL char passed the printable check and got appended); added block cursor.
- Sidebar description now shows: fetched lazily per selection.
- yt-dlp "infinite" search: was full-metadata crawl (~90s); now fast flat rows + lazy date fill.

## pending user test
- Settings: left/right cycles backend / invidious instance; enter edits results_count (cursor + backspace).
- yt-dlp search returns rows in seconds; sidebar date fills after selection.
- Piped gone from settings and search.
