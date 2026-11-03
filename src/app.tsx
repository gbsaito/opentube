/** @jsxImportSource @opentui/solid */
import { createSignal, createMemo, For, Show, type Component } from "solid-js"
import { useKeyboard, useRenderer, render } from "@opentui/solid"
import { appendFileSync } from "fs"
import { format } from "util"
import type { CliRenderer } from "@opentui/core"
import { theme } from "./theme"
import {
  loadSettings,
  saveConf,
  setSettings,
  settings,
  quickAccess,
  playlists,
  subscriptions,
  history,
  queries,
  type Store,
  type Video,
  type Settings,
  TITLE_FONTS,
  ACCENT_COLORS,
  QUALITY_ORDER,
} from "./config"
import { searchVideos, searchVideosWithFallback, searchMoreVideos, videoMeta, videoMetaFull, cachedMeta, ERR_MSG, type BackendKey, type VideoMeta } from "./backends"
import { play, npTime, npDur, npLoop, npPaused, npMuted, prewarm, urlCacheClear, stopPlayback, onPlaybackEnd, togglePause, toggleLoop, toggleMute, seekTo } from "./player"
import { settle } from "./spawn"

// span styling props are runtime-supported but not in SpanProps typings; cast wrapper
const Span: Component<any> = (props) => <span {...props} />
// link mouse events are runtime-supported but not in LinkProps typings; cast wrapper
const A: Component<any> = (props) => <a {...props} />

type Screen = "home" | "results" | "history" | "playlists" | "subscriptions" | "settings" | "nowplaying" | "desc"

// 1234567 -> "1,234,567"; non-numeric strings pass through
const fmtViews = (s: string) => (/^\d+$/.test(s) ? Number(s).toLocaleString("en-US") : s)

const QUICK: string[] = ["history", "playlists", "subscriptions", "settings", "quit"]
// nerd-font glyphs (FontAwesome subset present in nerd fonts)
const QUICK_ICON: Record<string, string> = {
  history: "\uf1da",
  playlists: "\uf03a",
  subscriptions: "\uf0f3",
  settings: "\uf013",
  quit: "\uf011",
}
const QUICK_LABEL: Record<string, string> = {
  history: "History",
  playlists: "Playlists (WIP)",
  subscriptions: "Subscriptions (WIP)",
  settings: "Settings",
  quit: "Quit",
}
const SETTINGS_KEYS: readonly string[] = ["backend", "invidious_instance", "results_count", "page_count", "prompt_history", "history_limit", "previews", "image_previews", "title_font", "accent", "fullscreen", "quality"]
const EDITABLE_NUMBERS: readonly string[] = ["results_count", "page_count", "history_limit"]
const INVIDIOUS_INSTANCES: string[] = [
  "https://yt.chocolatemoo53.com",
  "https://inv.nadeko.net",
  "https://invidious.nerdvpn.de",
  "https://invidious.tiekoetter.com",
  "http://invidious-nerdvpn.i2p",
  "http://nerdvpneaggggfdiurknszkbmhvjndks5z5k3g5yp4nhphflh3n3boad.onion",
  "http://nadekoohummkxncchcsylr3eku36ze4waq4kdrhcqupckc3pe5qq.b32.i2p",
  "https://inv-ygg.nadeko.net",
  "https://inv.nadeko.ygg",
]
const BACKEND_ORDER: BackendKey[] = ["yt-dlp", "invidious"]
const RENDERER_LIST: readonly Settings["image_renderer"][] = ["auto", "icat", "sixel", "chafa"]
const HINTS = "↑↓/jk move · ←→ page · enter play · p play · P audio · s subscribe · q quit · esc back"

// --- app state -----------------------------------------------------------------
const [screen, setScreen] = createSignal<Screen>("home")
const [query, setQuery] = createSignal("")
const [inputMode, setInputMode] = createSignal(true) // search box focused on home?
const [quickIndex, setQuickIndex] = createSignal(0)
const [videos, setVideos] = createSignal<Video[]>([])
const [sel, setSel] = createSignal(0)
const [loading, setLoading] = createSignal(false)
const [error, setError] = createSignal("")
const [store, setStore] = createSignal<Store | null>(null)
const [storeIndex, setStoreIndex] = createSignal(0)

// pagination: one window size for every list screen; results fetch extra pages on demand
const [page, setPage] = createSignal(0)
const [loadingMore, setLoadingMore] = createSignal(false)
const [exhausted, setExhausted] = createSignal(false)

// settings screen state
const [sRow, setSRow] = createSignal(0)
const [editing, setEditing] = createSignal<string | null>(null)
const [editBuf, setEditBuf] = createSignal("")

// prompt-history autosuggest (/ and @ prefix while typing)
const [suggestOpen, setSuggestOpen] = createSignal(false)
const [sugIdx, setSugIdx] = createSignal(0)
function suggestFor(buf: string): Video[] {
  if (!settings().prompt_history) return []
  if (!(buf.startsWith("/") || buf.startsWith("@"))) return []
  const term = buf.slice(1).trim().toLowerCase()
  if (term.length < 1) return []
  return queries.items.filter((e) => e.title.toLowerCase().includes(term)).slice(0, 8)
}
const sugList = createMemo<Video[]>(() => suggestFor(query()))
const isSuggesting = () => sugList().length > 0

function commitEdit() {
  const key = editing()
  if (!key) return setEditing(null)
  const s = { ...settings() } as any
  if (key === "results_count") s.results_count = Math.min(Math.max(parseInt(editBuf(), 10) || 25, 1), 50)
  else if (key === "page_count") s.page_count = Math.min(Math.max(parseInt(editBuf(), 10) || 2, 1), 20) // ponytail: no-op setting yet; range guessed until wired
  else if (key === "history_limit") s.history_limit = Math.min(Math.max(parseInt(editBuf(), 10) || 50, 5), 500)
  else s[key] = editBuf()
  setSettings(s)
  if (key === "history_limit") queries.setCap(s.history_limit)
  saveConf()
  setEditing(null)
}

/** submit the top-bar query edit ("/") — re-searches without leaving the results screen */
function submitQuery() {
  setEditing(null)
  const q = editBuf().trim()
  if (q) void doSearch(q)
}

// lazy per-selection metadata fill: invidious rows lack description, yt-dlp flat rows lack views;
// two phases so the sidebar fills fast (invidious ~1s) and completes (yt-dlp dump) right after
const [sidebarMeta, setSidebarMeta] = createSignal<VideoMeta | null>(null)
let metaId = ""
async function updateMeta(v: Video | undefined) {
  const id = v?.id
  if (!id) {
    metaId = ""
    return setSidebarMeta(null)
  }
  if (metaId === id) return // already filling/shown this row
  metaId = id
  const show = (m: VideoMeta) => {
    if (metaId === id) setSidebarMeta(m) // ignore stale responses
    setOriginalTitle(id, m) // original-language title (search rows may be translated)
  }
  // no early skip when the row "looks complete": its stored description may be the translated one
  show(await videoMeta(id))
  show(await videoMetaFull(id))
}

/** swap the translated search-row title for the original-language one (results list + now playing) */
function setOriginalTitle(id: string, m: VideoMeta) {
  const t = m.title
  if (!t) return
  if (npVideo?.id === id && npVideo.title !== t) npVideo = { ...npVideo, title: t }
  if (screen() === "results") {
    setVideos((vs) => (vs.some((v) => v.id === id && v.title !== t) ? vs.map((v) => (v.id === id ? { ...v, title: t } : v)) : vs))
  }
}

// background pass: original titles only exist on the per-video watch page (search rows ship translated
// ones) — fan out over all rows; spawn count stays bounded by ytdlpMeta's own inner limiter
// (ponytail: no outer limit() here — nesting it would deadlock: outer slots held while inner
// waits on the same queue)
let titleFillSeq = 0
const originalTitleDone = new Set<string>()
async function fillOriginalTitles(body: Video[], visibleIds: string[]) {
  const seq = ++titleFillSeq
  const vis = new Set(visibleIds)
  const list = [...body.filter((v) => vis.has(v.id)), ...body.filter((v) => !vis.has(v.id))]
  await Promise.allSettled(
    list.map((v) =>
      videoMetaFull(v.id)
        .then((m) => {
          if (seq === titleFillSeq && m.title) {
            originalTitleDone.add(v.id)
            setOriginalTitle(v.id, m)
          }
        })
        .catch(() => {}),
    ),
  )
}

// description modal (d on a list row): full text, links clickable
const [descFrom, setDescFrom] = createSignal<Screen | null>(null)
const [descText, setDescText] = createSignal("")
let descId = ""
/** fast snapshot first (invidious ~1-2s), then the yt-dlp phase replaces it when it lands */
async function loadDesc(id: string) {
  descId = id
  setDescText("")
  // fast phase: fill only with real text (an invidious blip shouldn't flash "no description")
  void videoMeta(id).then((m) => {
    if (descId === id && m.description.trim()) setDescText(m.description)
  }).catch(() => {})
  // full phase: final word, even when it is truly empty; front=true so it never queues
  // behind the background title-fill backlog (that starvation = "modal never shows text")
  if (descId === id) {
    const m = await videoMetaFull(id, true)
    if (descId === id) setDescText(m.description.trim() || "(no description)")
  }
}

// sidebar thumbnail
const [thumb, setThumb] = createSignal<Uint8Array | null>(null)
let thumbUrl = ""
const thumbCache = new Map<string, Uint8Array>()

function thumbUrlOf(v: Video | undefined): string {
  // mqdefault is 16:9 no-letterbox; hqdefault ships youtube's black bars
  return v ? `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg` : ""
}

async function updateThumb(v: Video | undefined) {
  const url = thumbUrlOf(v)
  thumbUrl = url
  if (!url) return setThumb(null)
  const hit = thumbCache.get(url)
  if (hit) return setThumb(hit)
  try {
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
    thumbCache.set(url, bytes)
    if (thumbUrl === url) setThumb(bytes) // ignore stale responses
  } catch {
    if (thumbUrl === url) setThumb(null)
  }
}

// --- derived helpers ---------------------------------------------------------------
// o cycles the sort field (natural/title/views/date); O (shift+o) flips asc/desc
const [sortKey, setSortKey] = createSignal<"natural" | "title" | "views" | "date">("natural")
const [sortAsc, setSortAsc] = createSignal(false)
const SORT_FIELDS = ["natural", "title", "views", "date"] as const
function viewVal(s: string | undefined): number {
  return parseInt(String(s ?? "").replace(/[^\d]/g, ""), 10) || 0
}
function dateVal(v: Video): number {
  if (v.watchedAt) return v.watchedAt
  // results rows only know "11 months ago"-style relative dates: approximate
  const m = String(v.date || "").match(/(\d+)\s+(second|minute|hour|day|week|month|year)/)
  if (!m) return 0
  const mult: Record<string, number> = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000 }
  return (parseInt(m[1]!, 10) || 0) * mult[m[2]!]! * 1000
}
function currentList(): Video[] {
  const base = screen() === "results" ? videos() : store()?.items ?? []
  const k = sortKey()
  if (k === "natural") return base
  const key = { title: (v: Video) => v.title.toLowerCase(), views: (v: Video) => viewVal(v.views), date: dateVal }[k]
  const dir = sortAsc() ? 1 : -1
  const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0)
  return base.slice().sort((a, b) => cmp(key(a), key(b)) * dir)
}
function currentIndex(): number {
  return screen() === "results" ? sel() : storeIndex()
}
function currentVideo(): Video | undefined {
  return currentList()[currentIndex()]
}

// pagination helpers (shared by every list screen)
function pageSize(): number {
  return Math.max(1, Math.round(settings().results_count))
}
function pageCount(): number {
  return Math.max(1, Math.ceil(currentList().length / pageSize()))
}
function visibleList(): Video[] {
  const size = pageSize()
  return currentList().slice(page() * size, (page() + 1) * size)
}
function localFocus(): number {
  return currentIndex() - page() * pageSize()
}

// UI zoom (0.5–2), ctrl+wheel steps 0.25; scales the sidebar layout
const [zoomLevel, setZoomLevel] = createSignal(1)

// mouse: hovering a row selects it, double-click interacts (plays)
let lastClick = { id: "", at: 0 }
function hoverSelect(local: number, v: Video | undefined) {
  if (!v || screen() === "home" || screen() === "settings" || screen() === "nowplaying") return
  const list = visibleList()
  if (local >= list.length) return
  if (currentVideo()?.id === v.id) return
  setSel(page() * pageSize() + local)
  refreshSidebar(v)
}
function rowMouseDown(local: number, v: Video) {
  const now = Date.now()
  if (lastClick.id === v.id && now - lastClick.at < 400) {
    lastClick = { id: "", at: 0 }
    hoverSelect(local, v)
    return playCurrent("video") // double click interacts
  }
  lastClick = { id: v.id, at: now }
  hoverSelect(local, v)
}

let rendererRef: CliRenderer | null = null

async function quitApp() {
  stopPlayback() // kill any running mpv before tearing the render down / exiting
  rendererRef?.destroy()
  await rendererRef?.closed
  process.exit(0)
}

let lastSearch = { q: "", at: 0 }

// session search cache: repeat/edited-return queries resolve instantly, typeahead prewarms the promise
const SEARCH_TTL = 10 * 60_000 // ponytail: stale rows are fine for browsing repeat searches; drop to 60s if results feel old
const searchCache = new Map<string, { at: number; rows: Promise<Video[]> }>()
/** prewarm a search in the background (typeahead); doSearch finds it already resolved */
function prewarmSearch(q: string) {
  const key = q.trim()
  if (key.length < 3) return
  const hit = searchCache.get(key)
  if (hit && Date.now() - hit.at < SEARCH_TTL) return
  const rows = searchVideosWithFallback(key)
  searchCache.set(key, { at: Date.now(), rows })
  void rows.catch(() => {}) // abandoned prewarm must not surface as an unhandled [ERROR] in the console overlay
  if (searchCache.size > 12) {
    const first = searchCache.keys().next().value
    if (first) searchCache.delete(first)
  }
}

let typeaheadTimer: ReturnType<typeof setTimeout> | null = null
/** debounced typeahead: ~400ms after the query settles, fetch rows before enter is even pressed.
 *  reads whichever buffer is live: the home searchbox or the top-bar query editor */
function scheduleTypeahead() {
  if (typeaheadTimer) clearTimeout(typeaheadTimer)
  const q = editing() === "query" ? editBuf() : query()
  if (q.trim().length < 3) return
  typeaheadTimer = setTimeout(() => {
    typeaheadTimer = null
    prewarmSearch(q)
  }, 400)
}

async function doSearch(q: string) {
  if (!q.trim()) return
  if (q === lastSearch.q && Date.now() - lastSearch.at < 400) return // double delivery (input submit + global keyhook)
  lastSearch = { q, at: Date.now() }
  if (settings().prompt_history) {
    queries.setCap(settings().history_limit)
    queries.add({ id: q, title: q, channel: "", date: "", description: "" }) // record prompt history
  }
  setQuery(q)
  setScreen("results")
  setPage(0)
  setExhausted(false)
  setLoading(true)
  setError("")
  setSel(0)
  setVideos([]) // drop stale rows from previous searches immediately
  try {
    const cached = searchCache.get(q)
    const rows = cached && Date.now() - cached.at < SEARCH_TTL ? cached.rows : searchVideosWithFallback(q)
    searchCache.set(q, { at: Date.now(), rows })
    setVideos(await rows)
    void Promise.all([updateThumb(videos()[0]), updateMeta(videos()[0])])
    // background: replace translated search titles with original-language ones (visible page first)
    const body = videos()
    const size = pageSize()
    void fillOriginalTitles(body, body.slice(page() * size, (page() + 1) * size).map((v) => v.id))
    void ensurePageLoaded() // background-prefetch the next window so paging at 50 results is instant
  } catch (e) {
    searchCache.delete(q) // don't replay a poisoned cached promise on the next enter
    setVideos([])
    setError(ERR_MSG(e))
  } finally {
    setLoading(false)
  }
}

function moveSelection(delta: number) {
  const list = visibleList()
  if (list.length === 0) return
  const local = Math.min(localFocus(), list.length - 1)
  const base = page() * pageSize()
  const nextLocal = (local + delta + list.length) % list.length
  ;(screen() === "results" ? setSel : setStoreIndex)(base + nextLocal)
  const picked = list[nextLocal]
  if (!picked) return // row vanished between the length check and here (e.g. results replaced mid-tick)
  listScrollRef?.scrollChildIntoView(`row-${picked.id}`, { align: "nearest" })
  refreshSidebar(picked)
}

/** one shared pager: history/playlists window the stored rows; results lazily fetch more rows behind the window */
async function goPage(dir: 1 | -1) {
  const next = page() + dir
  if (next < 0) return
  if (next >= pageCount() && (screen() !== "results" || exhausted())) return
  setPage(next)
  // keep the cursor inside the new window
  const start = next * pageSize()
  const list = visibleList()
  if (list.length > 0) {
    const focus = Math.min(localFocus(), list.length - 1)
    ;(screen() === "results" ? setSel : setStoreIndex)(start + focus)
  }
  refreshSidebar(currentVideo())
  listScrollRef?.scrollChildIntoView(`row-${currentVideo()?.id}`, { align: "start" })
  await ensurePageLoaded()
}

/** fetch behind-the-window rows when paging forward in results */
async function ensurePageLoaded() {
  if (screen() !== "results" || exhausted() || loadingMore()) return
  const size = pageSize()
  const target = (page() + 1) * size
  const before = videos().length
  if (before >= target) return
  setLoadingMore(true)
  try {
    const more = await searchMoreVideos(query(), before, target)
    const seen = new Set(videos().map((v) => v.id))
    const fresh = more.filter((v) => v.id && !seen.has(v.id))
    setVideos([...videos(), ...fresh])
    if (videos().length < target) setExhausted(true)
    void fillOriginalTitles(fresh, []) // continuation rows need their original titles too
  } catch {
    setExhausted(true) // continuation failure: no more pages, keep current rows
  } finally {
    setLoadingMore(false)
  }
}

function refreshSidebar(v: Video | undefined) {
  if (v) npVideo = v
  const row = v
  if (screen() === "home" || screen() === "settings") return // no sidebar there
  if (sidebarRow === row?.id) return // same row: nothing new to fetch
  sidebarRow = row?.id
  // defer prewarm + meta fetches ~350ms past cursor settling: scrolling across rows
  // doesn't fire one yt-dlp/meta spawn per row (was freezing the whole PC at 50 results)
  sidebarDeferrer(() => {
    prewarm(row)
    void updateMeta(row)
  })
  // thumbnails are a ~50ms CDN fetch: straight away, not debounced
  void updateThumb(row)
}
let sidebarRow: string | undefined
const sidebarDeferrer = settle(350, (fn: () => void) => fn())

let npVideo: Video | null = null
let npStart = 0

function playCurrent(mode: "video" | "audio") {
  const v = currentVideo()
  if (!v) return
  play(v, mode)
  history.add(withMeta(v))
  npVideo = v
  npStart = Date.now()
  setScreen("nowplaying")
}

// active mpv exited on its own (ended / killed externally): don't sit on a frozen now-playing screen
onPlaybackEnd(() => {
  if (screen() === "nowplaying") {
    setScreen("results")
    setInputMode(false)
  }
})

function subscribeCurrent() {
  const v = currentVideo()
  if (!v?.channel) return
  subscriptions.add({ ...withMeta(v), id: v.channel, title: v.channel, description: "" })
}
/** fill missing fields (date/description/views) from already-fetched session cache, so history rows render instantly */
function withMeta(v: Video): Video {
  const m = cachedMeta(v.id)
  return m ? { ...v, description: v.description || m.description, date: v.date || m.date, views: v.views || m.views } : v
}
function deleteCurrent() {
  const v = currentVideo()
  if (store() && v && screen() !== "results") {
    store()!.remove(v.id)
    if (page() >= pageCount()) setPage(pageCount() - 1) // page may have emptied
    const focus = Math.min(localFocus(), Math.max(0, visibleList().length - 1))
    setStoreIndex(page() * pageSize() + focus)
    refreshSidebar(currentVideo())
  }
}

// --- keyboard routing -----------------------------------------------------------------
let lastScrollStep = 0
export const App: Component = () => {
  const renderer = useRenderer()
  rendererRef = renderer
  // global mouse: scroll navigates, ctrl+scroll zooms
  renderer.root.onMouse = (e) => {
    if (e.type !== "scroll") return
    if (screen() === "desc") return // description modal: keep it still, don't steer the list underneath
    // kitty fires several scroll events per notch; without throttling the cursor skips rows
    const now = Date.now()
    if (now - lastScrollStep < 70) return
    lastScrollStep = now
    const dir = e.scroll?.direction === "up" ? -1 : 1
    if (e.modifiers.ctrl) {
      setZoomLevel((z) => Math.min(2, Math.max(0.5, z + dir * 0.25)))
      return
    }
    if (screen() === "home") {
      setInputMode(false)
      setQuickIndex((i) => (i + dir + QUICK.length) % QUICK.length)
      return
    }
    moveSelection(dir)
  }
  useKeyboard((e) => {
    try { if (process.env.OTUI_DEBUG) appendFileSync("/tmp/opentube-keys.log", `${Date.now()} name=${e.name} seq=${JSON.stringify(e.sequence)} type=${e.eventType}\n`) } catch {}
    if (e.eventType === "release") return

    // instance/count editing swallows all keys first
    if (editing()) {
      // top-bar query edit: the focused input owns typing; here we only submit
      if (editing() === "query") {
        const name = e.name === "kpenter" || e.name === "enter" || e.name === "linefeed" ? "return" : e.name
        if (name === "return") return void submitQuery()
        return // typing + escape go to the input (input onKeyDown cancels)
      }
      if (e.name === "return") return commitEdit()
      if (e.name === "escape") return setEditing(null)
      const cp = e.sequence?.length === 1 ? e.sequence.charCodeAt(0) : 0
      if (cp >= 32 && cp !== 127) setEditBuf(editBuf() + e.sequence)
      else if (e.name === "backspace") setEditBuf(editBuf().slice(0, -1))
      return
    }

    // prompt-history autosuggest (/ or @ typed while the home searchbox is focused): nav before homeKeys
    if (screen() === "home" && inputMode() && isSuggesting()) {
      const name = e.name === "kpenter" || e.name === "enter" || e.name === "linefeed" ? "return" : e.name
      if (name === "up" || name === "k") {
        e.stopPropagation()
        setSugIdx((i) => (i - 1 + sugList().length) % sugList().length)
        return
      }
      if (name === "down" || name === "j") {
        e.stopPropagation()
        setSugIdx((i) => (i + 1) % sugList().length)
        return
      }
      if (name === "return") {
        e.stopPropagation()
        const pick = sugList()[sugIdx()]
        setSuggestOpen(false)
        if (pick) void doSearch(pick.title) // enter runs the highlighted history search
        return
      }
      if (name === "escape") {
        e.stopPropagation()
        setSuggestOpen(false)
        return
      }
    }

    // q quits unless the user is typing inside the search input
    if (e.name === "q" && !(screen() === "home" && inputMode())) return void quitApp()

    if (screen() === "home") return homeKeys(e)

    if (screen() === "settings") {
      if (e.name === "escape") return setScreen("home")
      const rows = settingsRows()
      if (e.name === "up" || e.name === "k") return setSRow((r) => (r + rows.length - 1) % rows.length)
      if (e.name === "down" || e.name === "j") return setSRow((r) => (r + 1) % rows.length)
      const row = rows[sRow()]!
      const cycle = (dir: number) => {
        const s = settings() as any
        if (row === "backend") {
          setSettings({ ...settings(), backend: BACKEND_ORDER[(BACKEND_ORDER.indexOf(settings().backend) + dir + 2) % 2]! } as any)
        } else if (row === "image_renderer") {
          const idx = RENDERER_LIST.indexOf(s.image_renderer)
          const next = RENDERER_LIST[(idx + dir + RENDERER_LIST.length) % RENDERER_LIST.length]!
          setSettings({ ...settings(), image_renderer: next } as any)
        } else if (row === "title_font") {
          const idx = TITLE_FONTS.indexOf(s.title_font)
          const next = TITLE_FONTS[(idx + dir + TITLE_FONTS.length) % TITLE_FONTS.length]!
          setSettings({ ...settings(), title_font: next } as any)
        } else if (row === "accent") {
          const idx = ACCENT_COLORS.indexOf(s.accent)
          const next = ACCENT_COLORS[(idx + dir + ACCENT_COLORS.length) % ACCENT_COLORS.length]!
          setSettings({ ...settings(), accent: next } as any)
        } else if (row === "invidious_instance") {
          const idx = INVIDIOUS_INSTANCES.indexOf(settings().invidious_instance)
          const next = idx < 0 ? (dir < 0 ? INVIDIOUS_INSTANCES.length - 1 : 0) : INVIDIOUS_INSTANCES[(idx + dir + INVIDIOUS_INSTANCES.length) % INVIDIOUS_INSTANCES.length]!
          setSettings({ ...settings(), invidious_instance: next } as any)
        } else if (row === "previews" || row === "image_previews" || row === "fullscreen" || row === "prompt_history") {
          setSettings({ ...settings(), [row]: !settings()[row] } as any)
        } else if (row === "quality") {
          const idx = QUALITY_ORDER.indexOf(s.quality)
          const next = QUALITY_ORDER[(idx + dir + QUALITY_ORDER.length) % QUALITY_ORDER.length]!
          setSettings({ ...settings(), quality: next } as any)
          // invalidate prefetched URLs resolved under the old quality
          urlCacheClear()
        } else if (EDITABLE_NUMBERS.includes(row)) {
          setEditing(row)
          setEditBuf(String((settings() as any)[row]))
          return
        }
        saveConf()
      }
      if (e.name === "left") return cycle(-1)
      if (e.name === "right") return cycle(1)
      if (e.name === "return" || e.name === "space") {
        if (EDITABLE_NUMBERS.includes(row)) {
          setEditing(row)
          setEditBuf(String((settings() as any)[row]))
        } else {
          return cycle(1)
        }
      }
      return
    }

    // now playing: esc quits mpv and goes back to the last search query; p toggles pause; left/right seek
    if (screen() === "nowplaying") {
      if (e.name === "escape") {
        void stopPlayback() // quit mpv (video+audio)
        setScreen("results")
        setQuery(lastSearch.q) // back to the query searched last
        setLoading(false)
        return
      }
      if (e.name === "p" || e.name === "P") {
        togglePause()
        return
      }
      if (e.name === "r" || e.name === "R") {
        void toggleLoop()
        return
      }
      if (e.name === "m" || e.name === "M") {
        void toggleMute()
        return
      }
      if (e.name === "left" || e.name === "right") {
        seekTo(npTime() + (e.name === "right" ? 10 : -10))
        return
      }
    }

    // description modal: esc returns to where it opened from, nothing else gets keystrokes
    if (screen() === "desc") {
      if (e.name === "escape") return setScreen(descFrom() ?? "results")
      return
    }

    // results / history / playlists / subscriptions
    switch (e.name) {
      case "escape":
        setScreen("home")
        setInputMode(false) // esc focuses the quick access menu; / returns focus to the searchbox
        return
      case "o":
      case "O": {
        if (e.shift || e.name === "O") setSortAsc((a) => !a)
        else setSortKey((k) => k === "natural" ? "title" : k === "title" ? "views" : k === "views" ? "date" : "natural")
        setStoreIndex(0)
        setSel(0)
        setPage(0)
        return
      }
      case "/":
        // edit the current query inline in the top bar (no home round-trip)
        if (screen() === "results") {
          e.preventDefault() // stop the opening keypress landing inside the just-focused input as text
          setEditBuf(query())
          setEditing("query")
          return
        }
        return
      case "up":
      case "k":
        return moveSelection(-1)
      case "down":
      case "j":
        return moveSelection(1)
      case "left":
        return void goPage(-1)
      case "right":
        return void goPage(1)
      case "return":
        return playCurrent("video")
      case "p":
        // kitty reports shifted letters as lowercase name + shift flag, so shift+P == "p"+shift
        return playCurrent(e.shift ? "audio" : "video")
      case "P":
        return playCurrent("audio")
      case "s":
        return subscribeCurrent()
      case "x":
        return deleteCurrent()
      case "d":
        // full description modal for the current row
        const v = currentVideo()
        if (!v) return
        npVideo = v
        setDescText("")
        setDescFrom(screen())
        setScreen("desc")
        void loadDesc(v.id)
        return
    }
  })

  return (
    <Show when={screen() !== "home"} fallback={() => <Home />}>
      {() => <NonHomeScreens />}
    </Show>
  )
}

const NowPlaying: Component = () => {
  const v = npVideo
  const fmt = (s: number) => {
    if (!isFinite(s) || s < 0) s = 0
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = Math.floor(s % 60)
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`
  }
  const bar = () => {
    const dur = Math.max(0, npDur())
    const f = dur > 0 ? Math.min(1, npTime() / dur) : 0
    const filled = Math.round(f * 30)
    return `${"█".repeat(filled)}${"░".repeat(30 - filled)}`
  }
  return (
    <box flexGrow={1} backgroundColor={theme.bg} flexDirection="column" justifyContent="center" alignItems="center">
      <text fg={settings().accent} textAlign="center">Now Playing</text>
      <text fg={theme.fg} textAlign="center">{v?.title ?? ""}</text>
      <box height={2} />
      <box width={30} height={1}>
        <text fg={theme.fg}>{bar()}</text>
      </box>
      <box height={1} />
      <text fg={theme.faint}>{fmt(npTime())} / {fmt(npDur())}</text>
      <box height={1} />
      <Show when={npLoop() || npPaused() || npMuted()}>
        {() => (
          <text fg={theme.accent}>
            {[npLoop() ? "⟳ loop" : "", npPaused() ? "⏸ paused" : "", npMuted() ? "🔇 muted" : ""].filter(Boolean).join(" · ")}
          </text>
        )}
      </Show>
      <box height={2} />
    </box>
  )
}

const NonHomeScreens: Component = () => (
  <box flexGrow={1} flexDirection="column" backgroundColor={theme.bg}>
    <Chrome title={
      screen() === "results" ? `search › ${query()}` :
      screen() === "nowplaying" ? `now playing › ${npVideo?.title ?? ""}` :
      screen() === "desc" ? `description › ${npVideo?.title?.slice(0, 40) ?? ""}` :
      (screen() as string)
    } />
    {screen() === "settings" ? <Settings /> : screen() === "results" ? <Results /> : screen() === "history" || screen() === "playlists" ? <StoreScreen /> : screen() === "nowplaying" ? <NowPlaying /> : screen() === "desc" ? <DescScreen /> : <box flexGrow={1} />}
    <box height={1} paddingLeft={2} backgroundColor={theme.bg}>
      <text fg={theme.faint}>{
        screen() === "desc" ? "esc back" :
        screen() === "nowplaying" ? `${HINTS} · r loop · m mute` :
        `${HINTS.replace(" · esc back", "")}${screen() === "history" ? " · x delete" : ""} · d desc · o sort ${sortKey()} · O ${sortAsc() ? "asc" : "desc"}${screen() === "results" ? " · / edit query" : ""} · esc back`
      }</text>
    </box>
  </box>
)

const Chrome: Component<{ title: string }> = (props) => (
  <box height={1} paddingLeft={2} backgroundColor={theme.bg}>
    {/* top-bar query edit ("/" on results): input in place of the title */}
    <Show when={screen() === "results" && editing() === "query"} fallback={
      <text>
        <Span fg={settings().accent}>opentube</Span>
        <Span fg={theme.faint}> › </Span>
        <Span fg={theme.muted}>{props.title}</Span>
        <Show when={pageCount() > 1}>
          {() => <Span fg={theme.faint}> · page {page() + 1}/{pageCount()}{exhausted() ? "" : "+"}</Span>}
        </Show>
      </text>
    }>
      <box flexDirection="row" height={1}>
        <text fg={theme.muted}>opentube › search › </text>
        <input
          flexGrow={1}
          value={editBuf()}
          focused
          textColor={theme.fg}
          focusedTextColor={theme.fg}
          backgroundColor={theme.inputBg}
          focusedBackgroundColor={theme.inputBg}
          onInput={(value: string) => {
            setEditBuf(value)
            scheduleTypeahead() // fetch the edited query while it's being typed, same as the home searchbox
          }}
          onKeyDown={(e: any) => {
            if (e.name === "escape" || e.name === "down") setEditing(null) // cancel, keep the old query
          }}
        />
      </box>
    </Show>
  </box>
)

function activateQuick(item: string | undefined) {
  if (!item) return
  if (item === "quit") return void quitApp()
  if (item === "settings") return setScreen("settings")
  if (item === "playlists") {
    setStore(playlists)
    setStoreIndex(0)
    setPage(0)
    setExhausted(false)
    return setScreen("playlists")
  }
  if (item === "subscriptions") {
    setStore(subscriptions)
    setStoreIndex(0)
    setPage(0)
    setExhausted(false)
    return setScreen("subscriptions")
  }
  if (item === "history") {
    setStore(history)
    setStoreIndex(0)
    setPage(0)
    // fill missing meta for every history row (first-only fetch left the rest blank)
    for (const v of history.items) if (v.id) void updateMeta(v)
    void updateThumb(history.items[0])
    return setScreen("history")
  }
}

function homeKeys(e: { name: string; preventDefault(): void }) {
  // terminal key-name variants for Enter all mean submit
  const name = e.name === "kpenter" || e.name === "enter" || e.name === "linefeed" ? "return" : e.name
  if (inputMode()) {
    if (name === "escape" || name === "down") return setInputMode(false)
    if (name === "return") return void doSearch(query())
    if (e.name === "tab") {
      e.preventDefault() // tab switches focus without landing a literal tab in the query
      return setInputMode(false) // searchbox -> quick access
    }
    return // input owns the other keys; its own handler already blurs on escape
  }
  if (e.name === "up" || e.name === "k") return setQuickIndex((i) => (i + QUICK.length - 1) % QUICK.length)
  if (e.name === "down" || e.name === "j") return setQuickIndex((i) => (i + 1) % QUICK.length)
  if (e.name === "tab") return setInputMode(true) // tab switches focus: quick access -> searchbox
  if (name === "return" || e.name === "space") {
    return activateQuick(QUICK[quickIndex()]!)
  }
}

// --- screens ------------------------------------------------------------------------
function settingsRows(): string[] {
  const rows = [...SETTINGS_KEYS]
  if (settings().image_previews) rows.push("image_renderer")
  return rows
}

function Home() {
  return (
    <box flexGrow={1} backgroundColor={theme.bg} justifyContent="center" alignItems="center">
      <box height={1} />
      <ascii_font text="opentube" font={settings().title_font} color={settings().accent} />
      <box height={2} />
      <box
        width="62%"
        maxWidth={72}
        padding={1}
        border={["left"]}
        borderStyle="single"
        borderColor={settings().accent}
        backgroundColor={theme.inputBg}
        onMouseDown={(e: any) => {
          if (e.button === 0) setInputMode(true)
        }}
      >
        <input
          placeholder=" search youtube…"
          placeholderColor={theme.faint}
          focused={inputMode()}
          flexGrow={1}
          textColor={theme.fg}
          focusedTextColor={theme.fg}
          backgroundColor={theme.inputBg}
          focusedBackgroundColor={theme.inputBg}
          onInput={(value: string) => {
            setQuery(value)
            setSugIdx(0)
            setSuggestOpen(suggestFor(value).length > 0) // dropdown opens on / or @ prefix with history matches
            scheduleTypeahead() // rows start fetching before enter is pressed
          }}
          onKeyDown={(e: any) => {
            if (e.name === "escape" || e.name === "down") setInputMode(false)
          }}
        />
      </box>
      <box height={1} />
      {!suggestOpen() && (
        <>
          <box width="62%" maxWidth={72} alignSelf="center">
            <text fg={theme.faint}>{`tab switch · ↑↓ move · enter open${settings().prompt_history ? " · / history" : ""}`}</text>
          </box>
          <box height={1} />
          <box width="62%" maxWidth={72} alignSelf="center">
            <For each={QUICK}>
              {(item, i) => {
                const active = () => i() === quickIndex() && !inputMode()
                return (
                  <box
                    height={1}
                    backgroundColor={active() ? `#${settings().accent.slice(1)}4d` : undefined}
                    onMouseDown={(e: any) => {
                      if (e.button !== 0) return
                      setQuickIndex(i())
                      setInputMode(false)
                      activateQuick(item)
                    }}
                  >
                    <text fg={active() ? theme.fg : theme.muted}>
                      {QUICK_ICON[item] ?? "•"} {QUICK_LABEL[item] ?? item}
                    </text>
                  </box>
                )
              }}
            </For>
          </box>
        </>
      )}
      {suggestOpen() && (
        <box width="62%" maxWidth={72} alignSelf="center" border={["left"]} borderStyle="single" borderColor={theme.muted}>
          <For each={sugList()}>
            {(s, i) => {
              const active = () => i() === sugIdx()
              return (
                <box height={1} backgroundColor={active() ? `#${settings().accent.slice(1)}4d` : undefined}>
                  <text fg={active() ? theme.fg : theme.muted}>{s.title.slice(0, 68)}</text>
                </box>
              )
            }}
          </For>
        </box>
      )}
    </box>
  )
}

const ListRow: Component<{ v: Video; selected: boolean; local: number }> = (props) => {
  const mark = () => (props.selected ? " ▸ " : "   ")
  return (
    <box
      id={`row-${props.v.id}`}
      height={1}
      backgroundColor={props.selected ? `#${settings().accent.slice(1)}4d` : undefined}
      onMouseDrag={(e: any) => hoverSelect(props.local, props.v)} // drag = moved-cursor selection (hover was too trigger-happy)
      onMouseDown={(e: any) => {
        if (e.button === 0) rowMouseDown(props.local, props.v)
      }}
    >
      <text selectable={false} fg={theme.fg}>
        <Span fg={props.selected ? theme.fg : theme.selectionBg}>{mark()}</Span>
        {props.v.title.slice(0, 68)}
        <Show when={props.v.duration}>
          {() => <Span fg={theme.faint}> {props.v.duration}</Span>}
        </Show>
      </text>
    </box>
  )
}

let listScrollRef: any = null

function Results() {
  return (
    <box flexGrow={1} flexDirection="row">
      <scrollbox
        ref={(el: any) => (listScrollRef = el)}
        scrollY
        flexGrow={1}
        border={["right"]}
        borderStyle="single"
        borderColor={theme.surfaceBorder}
      >
        <Show when={loading()}>{() => <ListHint text={`searching via ${settings().backend}…`} />}</Show>
        <Show when={!!error()}>{() => <ListHint text={`error: ${error()}`} color={theme.accentDim} />}</Show>
        <Show when={!loading() && !error() && videos().length === 0}>{() => <ListHint text="no results" />}</Show>
        <For each={visibleList()}>{(v, i) => <ListRow v={v} selected={i() === localFocus()} local={i()} />}</For>
        <Show when={loadingMore()}>
          {() => <ListHint text="loading more…" />}
        </Show>
      </scrollbox>
      <Show when={settings().previews || settings().image_previews}>
        <Sidebar />
      </Show>
    </box>
  )
}

function StoreScreen() {
  const items = () => store()?.items ?? []
  return (
    <box flexGrow={1} flexDirection="row">
      <scrollbox ref={(el: any) => (listScrollRef = el)} scrollY flexGrow={1} border={["right"]} borderStyle="single" borderColor={theme.surfaceBorder}>
        <Show when={items().length === 0}>{() => <ListHint text="nothing here yet" />}
        </Show>
        <For each={visibleList()}>{(v, i) => <ListRow v={v} selected={i() === localFocus()} local={i()} />}</For>
      </scrollbox>
      <Show when={settings().previews || settings().image_previews}>
        <Sidebar />
      </Show>
    </box>
  )
}

const ListHint: Component<{ text: string; color?: string }> = (props) => (
  <box paddingLeft={1}>
    <text fg={props.color ?? theme.faint}>{props.text}</text>
  </box>
)

// --- description modal (d) ----------------------------------------------------------
const URL_SPLIT = /(https?:\/\/\S+)/g

function openUrl(u: string) {
  try {
    Bun.spawn(["xdg-open", u], { stdout: "ignore", stderr: "ignore" }).unref()
  } catch {}
}

/** fold one plain-text chunk at ~92 columns, word-boundary aware */
function foldPlain(s: string, w: number): string[] {
  const words = s.split(/\s+/).filter(Boolean)
  if (words.length === 0) return [""]
  const lines: string[] = []
  let cur = ""
  for (const word of words) {
    if (!cur) cur = word
    else if (cur.length + 1 + word.length <= w) cur += ` ${word}`
    else {
      lines.push(cur)
      cur = word
    }
  }
  if (cur) lines.push(cur)
  return lines
}

/** split a source line into clickable/visual pieces (urls kept whole as their own piece) */
function descPieces(line: string, w: number): Array<{ t: string; url?: string }> {
  const pieces: Array<{ t: string; url?: string }> = []
  let plain = ""
  for (const seg of line.split(/(https?:\/\/\S+)/)) {
    if (!seg) continue
    if (/^https?:\/\//.test(seg)) {
      if (plain) pieces.push({ t: foldPlain(plain, w).at(-1) ?? "" }) // trailing words share the url row
      plain = ""
      pieces.push({ t: seg, url: seg })
    } else {
      if (pieces.some((p) => p.url)) {
        // text after a url: flush as its own chunks
        for (const l of foldPlain(plain ? `${plain} ${seg}` : seg, w)) pieces.push({ t: l })
        plain = ""
      } else plain += seg
    }
  }
  if (plain.trim()) {
    if (pieces.some((p) => p.url)) for (const l of foldPlain(plain, w)) pieces.push({ t: l })
    else for (const l of foldPlain(plain, w)) pieces.push({ t: l })
  }
  return pieces.length ? pieces : [{ t: "" }]
}

const DescLine: Component<{ pieces: Array<{ t: string; url?: string }> }> = (props) => (
  <box paddingLeft={2}>
    <Show
      when={props.pieces.some((p) => p.url)}
      fallback={<text fg={theme.fg} selectable={false}>{props.pieces.map((p) => p.t).join("") || " "}</text>}
    >
      {() => (
        <text fg={theme.fg} selectable={false}>
          {props.pieces.map((p) =>
            p.url
              ? <A href={p.url} fg={theme.accent} onMouseDown={() => openUrl(p.url!)}>{p.t}</A>
              : p.t.trim() ? p.t : "",
          )}
        </text>
      )}
    </Show>
  </box>
)

function DescScreen() {
  const lines = () => {
    const acc: Array<Array<{ t: string; url?: string }>> = []
    for (const l of descText().split(/\r\n|\r|\n/).map((s) => s.trim())) {
      if (l === "") acc.push([{ t: "" }])
      else acc.push(descPieces(l, 92))
    }
    return acc
  }
  return (
    <box flexGrow={1} justifyContent="center" alignItems="center" backgroundColor={theme.bg}>
      <box width="90%" height="96%" border={["top", "bottom", "left", "right"]} borderStyle="single" borderColor={settings().accent} backgroundColor={theme.inputBg} paddingTop={1}>
        <scrollbox scrollY flexGrow={1}>
          <For each={lines()}>{(pieces) => <DescLine pieces={pieces} />}</For>
        </scrollbox>
      </box>
    </box>
  )
}

const Sidebar: Component = () => {
  const v = currentVideo
  const infoOn = () => settings().previews
  const imageOn = () => settings().image_previews
  const renderProtocol = (): "auto" | "kitty" | "sixel" | "blocks" => {
    const r = settings().image_renderer
    if (r === "auto") return "auto"
    if (r === "icat") return "kitty" // icat = kitty graphics protocol
    if (r === "sixel") return "sixel"
    if (r === "chafa") return "blocks" // chafa-style: in-process unicode blocks fallback (dumb terminals)
    return "auto"
  }
  return (
    <box
      width={Math.round(44 * zoomLevel())}
      flexDirection="column"
      paddingLeft={Math.round(2 * zoomLevel())}
      paddingRight={Math.round(2 * zoomLevel())}
      paddingTop={1}
    >
      <Show when={infoOn() && imageOn()}>
        <box height={Math.round(13 * zoomLevel())} justifyContent="center" alignItems="center">
          <Show when={thumb()} fallback={<text fg={theme.faint}>...</text>}>
            {() => <image source={thumb()!} fit="fit" width={Math.round(40 * zoomLevel())} height={Math.round(12 * zoomLevel())} protocol={renderProtocol()} />}
          </Show>
        </box>
      </Show>
      <Show when={infoOn()}>
        <box height={1} />
        <Show when={v()}>
          {() => (
            <>
              {/* optional-chained: solid may re-run this closure one tick past Show's teardown while v() clears */}
              <text fg={theme.fg}>{v()?.title ?? ""}</text>
              <text>
                <Span fg={theme.muted}>Channel: </Span>
                <Span fg={theme.fg}>{v()?.channel}</Span>
              </text>
              <text>
                <Span fg={theme.muted}>Upload Date: </Span>
                <Span fg={theme.fg}>{v()?.date || sidebarMeta()?.date || ""}</Span>
              </text>
              <text>
                <Span fg={theme.muted}>Views: </Span>
                <Span fg={theme.fg}>{fmtViews(v()?.views || sidebarMeta()?.views || "")}</Span>
              </text>
              <text>
                <Span fg={theme.muted}>Duration: </Span>
                <Span fg={theme.fg}>{v()?.duration || sidebarMeta()?.duration || ""}</Span>
              </text>
              <Show when={v()?.description || sidebarMeta()?.description}>
                {() => {
                  // sidebar gets a snippet only: first lines, short cap (full text lives in the d-modal)
                  const desc = sidebarMeta()?.description || v()?.description || ""
                  const shown = desc
                    .split(/\r\n|\r|\n/)
                    .map((l) => l.trim())
                    .filter((l) => l.length > 0)
                    .slice(0, 6)
                    .map((l) => l.slice(0, 110))
                    .join("\n")
                  return <text fg={theme.faint}>{shown}</text>
                }}
              </Show>
            </>
          )}
        </Show>
      </Show>
    </box>
  )
}

function Settings() {
  const rows = () => settingsRows()
  return (
    <box flexGrow={1} paddingLeft={2} paddingTop={1}>
      <For each={rows()}>
        {(row, i) => {
          const focused = () => i() === sRow()
          const isBool = () => row === "previews" || row === "image_previews" || row === "prompt_history"
          const isEditing = () => editing() === row
          const value = () => {
            const s = settings() as any
            if (isBool()) return s[row] ? "on" : "off"
            if (row === "image_renderer") return s.image_renderer
            return String(s[row])
          }
          return (
            <box height={1}>
              <text>
                <Span fg={focused() ? settings().accent : theme.selectionBg}>{focused() ? " ▸ " : "   "}</Span>
                <Span fg={focused() ? theme.selectionFg : theme.muted}>{row} = </Span>
                <Show when={!isEditing()}>
                  <Span fg={focused() ? theme.selectionFg : theme.fg}>{value()}</Span>
                </Show>
                <Show when={isEditing()}>
                  {() => (
                    <>
                      <Span fg={theme.selectionFg}>editing: </Span>
                      <Span fg={theme.fg}>{editBuf()}</Span>
                      <Span fg={settings().accent}>█</Span>
                    </>
                  )}
                </Show>
              </text>
            </box>
          )
        }}
      </For>
      <box height={1} />
      <text fg={theme.faint}>↑↓ move · ←→ cycle · enter edit · esc back</text>
    </box>
  )
}

function dumpConsole() {
  for (const level of ["log", "info", "warn", "error"] as const) {
    const orig = console[level].bind(console)
    console[level] = (...a: unknown[]) => {
      try { appendFileSync("/tmp/opentube-console.log", `${new Date().toISOString()} [${level}] ${format(...a)}\n`) } catch {}
      orig(...a)
    }
  }
}

export function mountApp() {
  loadSettings()
  // debug: mirror the console overlay's entries to /tmp/opentube-console.log so they can be read later
  if (process.env.OTUI_DEBUG) setTimeout(dumpConsole, 1000) // console is replaced by opentui at renderer start
  render(() => <App />, { useMouse: true }) // always-on mouse: drag-select, scroll, two-clicks
}
