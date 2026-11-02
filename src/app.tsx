/** @jsxImportSource @opentui/solid */
import { createSignal, For, Show, type Component } from "solid-js"
import { useKeyboard, useRenderer, render } from "@opentui/solid"
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
  type Store,
  type Video,
} from "./config"
import { searchVideos, searchMoreVideos, videoMeta, cachedMeta, ERR_MSG, type BackendKey, type VideoMeta } from "./backends"
import { play } from "./player"

// span styling props are runtime-supported but not in SpanProps typings; cast wrapper
const Span: Component<any> = (props) => <span {...props} />

type Screen = "home" | "results" | "history" | "playlists" | "subscriptions" | "settings"

// 1234567 -> "1,234,567"; non-numeric strings pass through
const fmtViews = (s: string) => (/^\d+$/.test(s) ? Number(s).toLocaleString("en-US") : s)

const QUICK: string[] = ["history", "playlists", "subscriptions", "settings", "quit"]
const SETTINGS_KEYS: readonly string[] = ["backend", "invidious_instance", "results_count"]
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
const HINTS = "↑↓/jk move · ←→ page · enter play · p audio · s subscribe · l add playlist · d delete · q quit · esc back"

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

function commitEdit() {
  const key = editing()
  if (!key) return setEditing(null)
  const s = { ...settings() } as any
  if (key === "results_count") s.results_count = Math.min(Math.max(parseInt(editBuf(), 10) || 25, 1), 50)
  else s[key] = editBuf()
  setSettings(s)
  saveConf()
  setEditing(null)
}

// lazy per-selection metadata fill: invidious rows lack description, yt-dlp flat rows lack date/views
const [sidebarMeta, setSidebarMeta] = createSignal<VideoMeta | null>(null)
let metaId = ""
async function updateMeta(v: Video | undefined) {
  const id = v?.id
  if (!id) {
    metaId = ""
    return setSidebarMeta(null)
  }
  if (metaId === id || (v.description && v.date && v.views)) return // nothing to fill
  metaId = id
  setSidebarMeta(null)
  const m = await videoMeta(id)
  if (metaId === id) setSidebarMeta(m) // ignore stale responses
}

// sidebar thumbnail
const [thumb, setThumb] = createSignal<Uint8Array | null>(null)
let thumbUrl = ""
const thumbCache = new Map<string, Uint8Array>()

function thumbUrlOf(v: Video | undefined): string {
  return v ? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg` : ""
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
function currentList(): Video[] {
  return screen() === "results" ? videos() : store()?.items ?? []
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

let rendererRef: CliRenderer | null = null

async function quitApp() {
  rendererRef?.destroy()
  await rendererRef?.closed
  process.exit(0)
}

async function doSearch(q: string) {
  if (!q.trim()) return
  setQuery(q)
  setScreen("results")
  setPage(0)
  setExhausted(false)
  setLoading(true)
  setError("")
  setSel(0)
  try {
    setVideos(await searchVideos(q))
    void updateThumb(videos()[0])
    void updateMeta(videos()[0])
  } catch (e) {
    setVideos([])
    setError(ERR_MSG(e))
  } finally {
    setLoading(false)
  }
}

function refreshSidebar(v: Video | undefined) {
  if (screen() === "results") void updateThumb(v)
  void updateMeta(v)
}

function moveSelection(delta: number) {
  const list = visibleList()
  if (list.length === 0) return
  const local = Math.min(localFocus(), list.length - 1)
  const base = page() * pageSize()
  const nextLocal = (local + delta + list.length) % list.length
  ;(screen() === "results" ? setSel : setStoreIndex)(base + nextLocal)
  const picked = list[nextLocal]!
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
    setVideos([...videos(), ...more.filter((v) => v.id && !seen.has(v.id))])
    if (videos().length < target) setExhausted(true)
  } catch {
    setExhausted(true) // continuation failure: no more pages, keep current rows
  } finally {
    setLoadingMore(false)
  }
}

function playCurrent(mode: "video" | "audio") {
  const v = currentVideo()
  if (!v) return
  play(v, mode)
  history.add(withMeta(v))
}

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

function likeCurrent() {
  const v = currentVideo()
  if (v) playlists.add(withMeta(v))
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
export const App: Component = () => {
  const renderer = useRenderer()
  rendererRef = renderer
  useKeyboard((e) => {
    if (process.env.APP_DBG) console.log("[app-keys]", e.name, screen(), editing()?.slice(0,0) ?? "")
    if (e.eventType === "release") return

    // instance/count editing swallows all keys first
    if (editing()) {
      if (e.name === "return") return commitEdit()
      if (e.name === "escape") return setEditing(null)
      const cp = e.sequence?.length === 1 ? e.sequence.charCodeAt(0) : 0
      if (cp >= 32 && cp !== 127) setEditBuf(editBuf() + e.sequence)
      else if (e.name === "backspace") setEditBuf(editBuf().slice(0, -1))
      return
    }

    // q quits unless the user is typing inside the search input
    if (e.name === "q" && !(screen() === "home" && inputMode())) return void quitApp()

    if (screen() === "home") return homeKeys(e)

    if (screen() === "settings") {
      if (e.name === "escape") return setScreen("home")
      const rows = SETTINGS_KEYS
      if (e.name === "up" || e.name === "k") return setSRow((r) => (r + rows.length - 1) % rows.length)
      if (e.name === "down" || e.name === "j") return setSRow((r) => (r + 1) % rows.length)
      const row = rows[sRow()]!
      const cycle = (dir: number) => {
        if (row === "backend") {
          setSettings({ ...settings(), backend: BACKEND_ORDER[(BACKEND_ORDER.indexOf(settings().backend) + dir + 2) % 2]! } as any)
        } else {
          // unknown/off-list entry sits on a virtual first slot: left -> pool end, right -> pool start
          const idx = INVIDIOUS_INSTANCES.indexOf(settings().invidious_instance)
          const next = idx < 0 ? (dir < 0 ? INVIDIOUS_INSTANCES.length - 1 : 0) : INVIDIOUS_INSTANCES[(idx + dir + INVIDIOUS_INSTANCES.length) % INVIDIOUS_INSTANCES.length]!
          setSettings({ ...settings(), invidious_instance: next } as any)
        }
        saveConf()
      }
      if (e.name === "left") return cycle(-1)
      if (e.name === "right") return cycle(1)
      if (e.name === "return" || e.name === "space") {
        if (row === "results_count") {
          setEditing("results_count")
          setEditBuf(String(settings().results_count))
        } else {
          return cycle(1)
        }
      }
      return
    }

    // results / history / playlists / subscriptions
    switch (e.name) {
      case "escape":
        setScreen("home")
        setInputMode(true)
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
        return playCurrent("audio")
      case "s":
        return subscribeCurrent()
      case "l":
        return likeCurrent()
      case "d":
        return deleteCurrent()
    }
  })

  return (
    <Show when={screen() !== "home"} fallback={() => <Home />}>
      {() => <NonHomeScreens />}
    </Show>
  )
}

const NonHomeScreens: Component = () => (
  <box flexGrow={1} flexDirection="column" backgroundColor={theme.bg}>
    <Chrome title={screen() === "results" ? `search › ${query()}` : (screen() as string)} />
    {screen() === "settings" ? <Settings /> : screen() === "results" ? <Results /> : screen() === "history" ? <StoreScreen /> : <box flexGrow={1} />}
    <box height={1} paddingLeft={2} backgroundColor={theme.bg}>
      <text fg={theme.faint}>{HINTS}</text>
    </box>
  </box>
)

const Chrome: Component<{ title: string }> = (props) => (
  <box height={1} paddingLeft={2} backgroundColor={theme.bg}>
    <text>
      <Span fg={theme.accent}>opentube</Span>
      <Span fg={theme.faint}> › </Span>
      <Span fg={theme.muted}>{props.title}</Span>
      <Show when={pageCount() > 1}>
        {() => <Span fg={theme.faint}> · page {page() + 1}/{pageCount()}{exhausted() ? "" : "+"}</Span>}
      </Show>
    </text>
  </box>
)

function homeKeys(e: { name: string; preventDefault(): void }) {
  if (inputMode()) {
    if (e.name === "return") return void doSearch(query())
    if (e.name === "/") {
      e.preventDefault() // toggle key must not land in the search field
      return setInputMode(false)
    }
    return // input owns the other keys; its onKeyDown handles escape
  }
  if (e.name === "up" || e.name === "k") return setQuickIndex((i) => (i + QUICK.length - 1) % QUICK.length)
  if (e.name === "down" || e.name === "j") return setQuickIndex((i) => (i + 1) % QUICK.length)
  if (e.name === "/") {
    e.preventDefault() // focus change key must not be inserted into the input
    return setInputMode(true)
  }
  if (e.name === "return" || e.name === "space") {
    const item = QUICK[quickIndex()]!
    // playlists/subscriptions are visual-only for now: no navigation either
    if (item === "quit") return void quitApp()
    if (item === "settings") return setScreen("settings")
    if (item === "history") {
      setStore(history)
      setStoreIndex(0)
      setPage(0)
      void updateMeta(history.items[0])
      return setScreen("history")
    }
  }
}

// --- screens ------------------------------------------------------------------------
function Home() {
  return (
    <box flexGrow={1} backgroundColor={theme.bg} justifyContent="center" alignItems="center">
      <box height={1} />
      <ascii_font text="opentube" font="block" color={theme.accent} />
      <box height={2} />
      <box width="62%" maxWidth={72} padding={1} border={["left"]} borderStyle="single" borderColor={theme.accentDim} backgroundColor={theme.inputBg}>
        <input
          placeholder=" search youtube…"
          placeholderColor={theme.faint}
          focused={inputMode()}
          flexGrow={1}
          textColor={theme.fg}
          focusedTextColor={theme.fg}
          backgroundColor={theme.inputBg}
          focusedBackgroundColor={theme.inputBg}
          onInput={(value: string) => setQuery(value)}
          onKeyDown={(e: any) => {
            if (e.name === "escape" || e.name === "down") setInputMode(false)
          }}
        />
      </box>
      <box height={2} />
      <box width="62%" maxWidth={72} alignSelf="center" paddingLeft={2}>
        <For each={QUICK}>
          {(item, i) => {
            const active = () => i() === quickIndex() && !inputMode()
            return (
              <box height={1} backgroundColor={active() ? theme.selectionBg : undefined}>
                <text fg={active() ? theme.selectionFg : theme.muted}>
                  <Span fg={active() ? theme.selectionFg : theme.selectionBg}>{active() ? " ▸ " : "   "}</Span>
                  {item}
                </text>
              </box>
            )
          }}
        </For>
      </box>
    </box>
  )
}

const ListRow: Component<{ v: Video; selected: boolean }> = (props) => {
  const mark = () => (props.selected ? " ▸ " : "   ")
  return (
    <box id={`row-${props.v.id}`} height={1} backgroundColor={props.selected ? theme.selectionBg : undefined}>
      <text fg={props.selected ? theme.selectionFg : theme.fg}>
        <Span fg={props.selected ? theme.selectionFg : theme.selectionBg}>{mark()}</Span>
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
        <For each={visibleList()}>{(v, i) => <ListRow v={v} selected={i() === localFocus()} />}</For>
        <Show when={loadingMore()}>
          {() => <ListHint text="loading more…" />}
        </Show>
      </scrollbox>
      <Sidebar />
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
        <For each={visibleList()}>{(v, i) => <ListRow v={v} selected={i() === localFocus()} />}</For>
      </scrollbox>
      <Sidebar />
    </box>
  )
}

const ListHint: Component<{ text: string; color?: string }> = (props) => (
  <box paddingLeft={1}>
    <text fg={props.color ?? theme.faint}>{props.text}</text>
  </box>
)

const Sidebar: Component = () => {
  const v = currentVideo
  return (
    <box width={44} flexDirection="column" paddingLeft={1} paddingTop={1}>
      <box height={13} justifyContent="center" alignItems="center">
        <Show when={thumb()} fallback={<text fg={theme.faint}>...</text>}>
          {() => <image source={thumb()!} fit="fit" width={42} height={12} protocol="kitty" />}
        </Show>
      </box>
      <Show when={v()}>
        {() => (
          <>
            <text fg={theme.fg}>{v()!.title}</text>
            <text>
              <Span fg={theme.muted}>Channel: </Span>
              <Span fg={theme.fg}>{v()!.channel}</Span>
            </text>
            <text>
              <Span fg={theme.muted}>Upload Date: </Span>
              <Span fg={theme.fg}>{v()!.date || sidebarMeta()?.date || ""}</Span>
            </text>
            <text>
              <Span fg={theme.muted}>Views: </Span>
              <Span fg={theme.fg}>{fmtViews(v()!.views || sidebarMeta()?.views || "")}</Span>
            </text>
            <Show when={v()!.description || sidebarMeta()?.description}>
              {() => <text fg={theme.faint}>{(v()!.description || sidebarMeta()?.description || "").slice(0, 200)}</text>}
            </Show>
          </>
        )}
      </Show>
    </box>
  )
}

function Settings() {
  const rows = SETTINGS_KEYS
  return (
    <box flexGrow={1} paddingLeft={2} paddingTop={1}>
      <For each={rows}>
        {(row, i) => {
          const focused = () => i() === sRow()
          return (
            <box height={1}>
              <text>
                <Span fg={focused() ? theme.accent : theme.selectionBg}>{focused() ? " ▸ " : "   "}</Span>
                <Span fg={focused() ? theme.selectionFg : theme.muted}>{row} = </Span>
                <Show when={editing() !== row} fallback={<Span fg={theme.accent}>{editBuf()}█</Span>}>
                  <Span fg={focused() ? theme.selectionFg : theme.fg}>{String((settings() as any)[row])}</Span>
                </Show>
              </text>
            </box>
          )
        }}
      </For>
      <box height={1} />
      <text fg={theme.faint}>↑↓ move · ↔ cycle · enter edit · esc back</text>
    </box>
  )
}

export function mountApp() {
  loadSettings()
  render(() => <App />)
}
