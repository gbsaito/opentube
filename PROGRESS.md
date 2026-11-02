# progress

## current task
- [ ] Build OpenTube TUI app per PLAN.md (phases 1-3 done; phase 4 auth optional)

## status
- Mouse/zoom features back in (45edaaa): wheel navigates (home quick menu w/o click keys; lists move selection), ctrl+wheel zooms 0.5–2 in 0.25 steps, hover/drag over list rows selects (mouse over/move), double-click on a row plays the video, click searchbox focuses it, click quick-menu row activates it. Sidebar scaled by zoom: width/pads/image scale; image centered; texts padded left/right.
- No drag anywhere (hover-select only, user request); comment updated (1569114).
- TAB toggles focus quick-access <-> searchbox (replaces old / toggle); esc/down unfocus; hint on home: "tab switch focus · ↑↓ move · enter open · type to search"; hint sits below searchbox / above quick menu (user fix, e542fa0, re-verified via pty probe).
- Quick menu rows now start at same left edge as hint (removed paddingLeft); rows carry nerd-font icons (history uf1da, playlists uf03a, subscriptions uf0f3, settings uf013, quit uf011) + capitalized labels (User: quick access not aligned with search bar like hints; add nerd icons).
- Settings: title_font row (tiny|block|shade|slick|huge|grid|pallet) cycles via down/up + enter/left/right (0c05ed9); persisted to opentube.conf; applied to Home ascii title + NowPlaying.
- NowPlaying: title below "Now Playing" label in white (fg); progress bar 30-wide, aligned, filled/empty block chars; syncs via mpv JSON IPC (get_property playback-time/duration, 500ms poll, socket /tmp/opentube-mpv-<ts>.sock); shows m:ss / h:mm:ss time + total instead of % (0c05ed9).
- Searchbox fixes (85e5088): image preview only when BOTH previews && image_previews; new search clears old rows immediately.
- Playlists feature (7dc83d0, current task): quick-access Playlists row navigates to `playlists` screen (store-bound list like history); view via list rows, add via `l` (likeCurrent), remove via `d` (deleteCurrent); esc home; keyboard/pager/mouse/hover shared.
- NowPlaying fix (84b1818, user report): root box now flexGrow={1} in column flex container → justifyContent center works; was not centered / broke with zoom.
- Opencode custom title font investigated: NOT an @opentui ASCIIFont font — hand-drawn block-letter art (█/_/^/~/,) strings in packages/tui/src/logo.ts + per-char <text> render with tinted shadow bg; bold via TextAttributes.BOLD; width-based layout (go / go.right / split / side-by-side).
- KEYBOARD ROOT CAUSE FOUND: kitty 0.49.2 delivered ZERO keyboard events to the app (empty keys log while running the instrumented build). Fix: launcher (bin/opentube.ts) attaches a flowing-mode stdin data listener BEFORE opentui mounts — keys now flow; raw/key logging kept opt-in via OTUI_DEBUG=1 to /tmp/opentube-raw.log and /tmp/opentube-keys.log (capped by user's bisect confirmation at commit f02170b in opentube-test).
- Searchbox focus semantics (user request): enter submits search (any Enter key-name variant: return/kpenter/enter/linefeed, deduped against double delivery), esc (any screen) returns home focused on quick-access menu, / (from menu) returns focus to searchbox. InputRenderable natively submits on "return"; `onKeyDown` is not a real prop of @opentui/solid input.
- opentube-test copy exists at ~/Projects/opentube-test (bisect sandbox owned by saito, launcher symlink opentube-test); delete when no longer needed.
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
- `src/player.ts` — mpv spawn + JSON IPC progress sync (npTime/npDur)
- `src/theme.ts` — colors
- `scripts/live_smoke.py` — pty TUI smoke
- `scripts/probe_home.py`, `scripts/probe_settings.py`, `scripts/probe_playlists.py` — pty probes
- `scripts/probe_home.py`, `scripts/probe_settings.py` — pty probes
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
