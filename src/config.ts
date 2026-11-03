import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createSignal, type Signal } from "solid-js"

export const CONFIG_DIR = `${process.env.HOME}/.config/opentube`

export interface Video {
  id: string
  title: string
  channel: string
  date: string
  description: string
  duration?: string
  views?: string
  channelId?: string // yt channel id (UC…) when the backend row knows it — subscriptions key on this
  watchedAt?: number // history entries only
}

// --- settings (.conf) -------------------------------------------------------
export type Quality = "auto" | "best" | "lowest" | "480p" | "720p" | "1080p" | "2160p"

// YT-USER: mouse is always on; the old on/off toggle is gone (kitty maps wheel→arrows natively when off)
export interface Settings {
  backend: "yt-dlp" | "invidious"
  results_count: number
  page_count: number
  prompt_history: boolean
  history_limit: number
  invidious_instance: string
  previews: boolean // info sidebar
  image_previews: boolean // thumbnail
  image_renderer: "auto" | "icat" | "sixel" | "chafa"
  title_font: "tiny" | "block" | "shade" | "slick" | "huge" | "grid" | "pallet"
  accent: string
  fullscreen: boolean
  quality: Quality
}

const QUALITIES: readonly Quality[] = ["auto", "best", "lowest", "480p", "720p", "1080p", "2160p"]
export const QUALITY_ORDER = QUALITIES

const DEFAULTS: Settings = {
  backend: "yt-dlp",
  results_count: 25,
  page_count: 2,
  prompt_history: true,
  history_limit: 50,
  invidious_instance: "https://yt.chocolatemoo53.com",
  previews: true,
  image_previews: true,
  image_renderer: "auto",
  title_font: "block",
  accent: "#c084fc",
  fullscreen: false,
  quality: "auto",
}

const RENDERERS: readonly Settings["image_renderer"][] = ["auto", "icat", "sixel", "chafa"]
const FONTS: readonly Settings["title_font"][] = ["tiny", "block"] // user asked: maintain only tiny/block
export const TITLE_FONTS = FONTS
export const ACCENT_COLORS: readonly string[] = ["#c084fc", "#58a6ff", "#3fb950", "#f2cc60", "#f47067"]

export const [settings, setSettings] = createSignal<Settings>(DEFAULTS)

/** parse simple `key = value` lines; `#` comments are skipped */
function parseConf(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq < 1) continue
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }
  return out
}

export function loadSettings() {
  try {
    const conf = parseConf(readFileSync(`${CONFIG_DIR}/opentube.conf`, "utf-8"))
    const backend = conf.backend === "invidious" ? "invidious" : "yt-dlp"
    const previews = conf.previews !== undefined ? conf.previews === "true" : DEFAULTS.previews
    const imagePreviews = conf["image_previews"] !== undefined ? conf["image_previews"] === "true" : DEFAULTS.image_previews
    const imageRenderer = RENDERERS.includes(conf["image_renderer"] as Settings["image_renderer"]) ? (conf["image_renderer"] as Settings["image_renderer"]) : DEFAULTS.image_renderer
    const titleFont = FONTS.includes(conf["title_font"] as Settings["title_font"]) ? (conf["title_font"] as Settings["title_font"]) : DEFAULTS.title_font
    const accent = conf.accent && ACCENT_COLORS.includes(conf.accent) ? conf.accent : DEFAULTS.accent
    const fullscreen = conf["fullscreen"] !== undefined ? conf["fullscreen"] === "true" : DEFAULTS.fullscreen
    const quality = QUALITIES.includes(conf.quality as Quality) ? (conf.quality as Quality) : DEFAULTS.quality
    const historyLimit = Math.min(Math.max(Number(conf["history_limit"] ?? DEFAULTS.history_limit) || DEFAULTS.history_limit, 5), 500)
    setSettings({
      ...DEFAULTS,
      backend,
      invidious_instance: conf.invidious_instance ?? DEFAULTS.invidious_instance,
      results_count: Number(conf.results_count ?? DEFAULTS.results_count),
      page_count: Number(conf.page_count ?? DEFAULTS.page_count),
      prompt_history: conf["prompt_history"] !== undefined ? conf["prompt_history"] === "true" : DEFAULTS.prompt_history,
      history_limit: historyLimit,
      previews,
      image_previews: imagePreviews,
      image_renderer: imageRenderer,
      title_font: titleFont,
      accent,
      fullscreen,
      quality,
    } as Settings)
  } catch {
    // no conf yet -> defaults
  }
}

export function saveConf() {
  mkdirSync(CONFIG_DIR, { recursive: true })
  const s = settings()
  writeFileSync(
    `${CONFIG_DIR}/opentube.conf`,
    [
      "# opentube settings",
      `backend = ${s.backend}`,
      `results_count = ${s.results_count}`,
      `page_count = ${s.page_count}`,
      `prompt_history = ${s.prompt_history}`,
      `history_limit = ${s.history_limit}`,
      `invidious_instance = ${s.invidious_instance}`,
      `previews = ${s.previews}`,
      `image_previews = ${s.image_previews}`,
      `image_renderer = ${s.image_renderer}`,
      `title_font = ${s.title_font}`,
      `accent = ${s.accent}`,
      `fullscreen = ${s.fullscreen}`,
      `quality = ${s.quality}`,
    ].join("\n") + "\n",
  )
}

// --- local stores (JSON, per-store file) --------------------------------------
function saveStore(name: string, items: Video[]) {
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(`${CONFIG_DIR}/${name}.json`, JSON.stringify(items, null, "\t") + "\n")
}

export class Store {
  sig: Signal<Video[]>
  cap = 500
  constructor(
    readonly name: string,
  ) {
    const [get, set] = createSignal<Video[]>([])
    this.sig = [get, set]
    this.reload()
  }
  get items(): Video[] {
    return this.sig[0]()
  }
  reload() {
    this.sig[1](this.read())
  }
  private read(): Video[] {
    try {
      return JSON.parse(readFileSync(`${CONFIG_DIR}/${this.name}.json`, "utf-8")) as Video[]
    } catch {
      return []
    }
  }
  add(v: Video) {
    const items = [{ ...v, watchedAt: Date.now() }, ...this.items.filter((e) => e.id !== v.id)].slice(0, this.cap)
    this.sig[1](items)
    saveStore(this.name, items)
  }
  remove(id: string) {
    const items = this.items.filter((e) => e.id !== id)
    this.sig[1](items)
    saveStore(this.name, items)
  }
  setCap(n: number) {
    this.cap = n
    const items = this.items.slice(0, Math.max(0, Math.floor(n)))
    this.sig[1](items)
  }
}

export const history = new Store("history")
export const playlists = new Store("playlists")
export const subscriptions = new Store("subscriptions")
/** past search prompts (id = the query string itself); feeds the / and @ autosuggest dropdown */
export const queries = new Store("queries")

/** name -> Store map used by the quick access menu */
export const quickAccess: [string, Store][] = [
  ["history", history],
  ["playlists", playlists],
  ["subscriptions", subscriptions],
]
