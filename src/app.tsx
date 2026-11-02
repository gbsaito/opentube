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
import { searchVideos, ERR_MSG, type BackendKey } from "./backends"
import { play } from "./player"

// span styling props are runtime-supported but not in SpanProps typings; cast wrapper
const Span: Component<any> = (props) => <span {...props} />

type Screen = "home" | "results" | "history" | "playlists" | "subscriptions" | "settings"

const QUICK: string[] = ["history", "playlists", "subscriptions", "settings", "quit"]
const SETTINGS_KEYS = ["backend", "results_count", "invidious_instance", "piped_instance"] as const
const BACKEND_ORDER: BackendKey[] = ["yt-dlp", "invidious", "piped"]
const HINTS = "↑↓/jk move · enter play · p audio · s subscribe · l add playlist · d delete · esc back"

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

// settings screen state
const [sRow, setSRow] = createSignal(0)
const [editing, setEditing] = createSignal<string | null>(null)
const [editBuf, setEditBuf] = createSignal("")

function commitEdit() {
  const key = editing()
  if (!key || key === "backend") return setEditing(null)
  const s = { ...settings() } as any
  if (key === "results_count") s.results_count = Math.min(Math.max(parseInt(editBuf(), 10) || 25, 1), 50)
  else s[key] = editBuf()
  setSettings(s)
  saveConf()
  setEditing(null)
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
  setLoading(true)
  setError("")
  setSel(0)
  try {
    setVideos(await searchVideos(q))
    void updateThumb(videos()[0])
  } catch (e) {
    setVideos([])
    setError(ERR_MSG(e))
  } finally {
    setLoading(false)
  }
}

function moveSelection(delta: number) {
  const list = currentList()
  if (list.length === 0) return
  const next = (currentIndex() + delta + list.length) % list.length
  ;(screen() === "results" ? setSel : setStoreIndex)(next)
  const picked = list[next]
  if (picked) listScrollRef?.scrollChildIntoView(`row-${picked.id}`, { align: "nearest" })
  if (screen() === "results") void updateThumb(picked)
}

function playCurrent(mode: "video" | "audio") {
  const v = currentVideo()
  if (!v) return
  play(v, mode)
  history.add(v)
}

function subscribeCurrent() {
  const v = currentVideo()
  if (!v?.channel) return
  subscriptions.add({ ...v, id: v.channel, title: v.channel, description: "" })
}
function likeCurrent() {
  const v = currentVideo()
  if (v) playlists.add(v)
}
function deleteCurrent() {
  const v = currentVideo()
  if (store() && v && screen() !== "results") store()!.remove(v.id)
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
      if (editing() !== "backend") {
        if (e.sequence && e.sequence.length === 1 && e.sequence.charCodeAt(0) >= 32) setEditBuf(editBuf() + e.sequence)
        else if (e.name === "backspace") setEditBuf(editBuf().slice(0, -1))
      }
      return
    }

    if (screen() === "home") return homeKeys(e)

    if (screen() === "settings") {
      if (e.name === "escape") return setScreen("home")
      if (e.name === "up" || e.name === "k") return setSRow((r) => (r + SETTINGS_KEYS.length - 1) % SETTINGS_KEYS.length)
      if (e.name === "down" || e.name === "j") return setSRow((r) => (r + 1) % SETTINGS_KEYS.length)
      if (e.name === "return" || e.name === "space") {
        const key = SETTINGS_KEYS[sRow()]!
        if (key === "backend") {
          setSettings({ ...settings(), backend: BACKEND_ORDER[(BACKEND_ORDER.indexOf(settings().backend) + 1) % 3]! })
          saveConf()
          return
        }
        setEditing(key)
        setEditBuf(String((settings() as any)[key]))
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
    </text>
  </box>
)

function homeKeys(e: { name: string }) {
  if (inputMode()) {
    if (e.name === "return") return void doSearch(query())
    if (e.name === "slash") return setInputMode(false) // / from focused input -> quick access
    return // input owns the other keys; its onKeyDown handles escape
  }
  if (e.name === "up" || e.name === "k") return setQuickIndex((i) => (i + QUICK.length - 1) % QUICK.length)
  if (e.name === "down" || e.name === "j") return setQuickIndex((i) => (i + 1) % QUICK.length)
  if (e.name === "slash") return setInputMode(true)
  if (e.name === "return" || e.name === "space") {
    const item = QUICK[quickIndex()]!
    // playlists/subscriptions are visual-only for now: no navigation either
    if (item === "quit") return void quitApp()
    if (item === "settings") return setScreen("settings")
    if (item === "history") {
      setStore(history)
      setStoreIndex(0)
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
        <For each={videos()}>{(v, i) => <ListRow v={v} selected={i() === sel()} />}</For>
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
        <For each={items()}>{(v, i) => <ListRow v={v} selected={i() === storeIndex()} />}</For>
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
    <box width={44} flexDirection="column" paddingLeft={1} paddingTop={1} gap={1}>
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
              <Span fg={theme.muted}>{v()!.channel}</Span>
              <Span fg={theme.faint}> · {v()!.date}</Span>
            </text>
            <Show when={v()!.description}>
              {() => <text fg={theme.faint}>{v()!.description.slice(0, 200)}</text>}
            </Show>
          </>
        )}
      </Show>
    </box>
  )
}

function Settings() {
  return (
    <box flexGrow={1} paddingLeft={2} paddingTop={1}>
      <For each={SETTINGS_KEYS}>
        {(key, i) => {
          const focused = () => i() === sRow()
          return (
            <box height={1}>
              <text>
                <Span fg={focused() ? theme.accent : theme.selectionBg}>{focused() ? " ▸ " : "   "}</Span>
                <Show when={editing() !== key}>
                  {() => (
                    <>
                      <Span fg={focused() ? theme.selectionFg : theme.muted}>{key} = </Span>
                      <Span fg={focused() ? theme.selectionFg : theme.fg}>{String((settings() as any)[key])}</Span>
                    </>
                  )}
                </Show>
                <Show when={editing() === key}>
                  {() => (
                    <>
                      <Span fg={theme.selectionFg}>editing: </Span>
                      <Span fg={theme.fg}>{editBuf()}</Span>
                    </>
                  )}
                </Show>
              </text>
            </box>
          )
        }}
      </For>
      <box height={1} />
      <text fg={theme.faint}>↑↓ move · enter: cycle backend / edit · esc back</text>
    </box>
  )
}

export function mountApp() {
  loadSettings()
  render(() => <App />)
}
