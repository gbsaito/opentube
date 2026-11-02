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
  watchedAt?: number // history entries only
}

// --- settings (.conf) -------------------------------------------------------
export interface Settings {
  backend: "yt-dlp" | "invidious" | "piped"
  results_count: number
  invidious_instance: string
  piped_instance: string
}

const DEFAULTS: Settings = {
  backend: "yt-dlp",
  results_count: 25,
  invidious_instance: "https://inv.nadeko.net",
  piped_instance: "https://pipedapi.kavin.rocks",
}

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
    setSettings({ ...DEFAULTS, ...conf, results_count: Number(conf.results_count ?? DEFAULTS.results_count) } as Settings)
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
      `invidious_instance = ${s.invidious_instance}`,
      `piped_instance = ${s.piped_instance}`,
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
  constructor(
    readonly name: string,
    private cap = 500,
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
}

export const history = new Store("history")
export const playlists = new Store("playlists")
export const subscriptions = new Store("subscriptions")

/** name -> Store map used by the quick access menu */
export const quickAccess: [string, Store][] = [
  ["history", history],
  ["playlists", playlists],
  ["subscriptions", subscriptions],
]
