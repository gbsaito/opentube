import { settings, type Video } from "./config"

export type BackendKey = "yt-dlp" | "invidious" | "piped"

// default instance pools: user setting first, then fallbacks for dead instances
const INVIDIOUS = ["https://inv.nadeko.net", "https://invidious.nerdvpn.de", "https://iv.datura.network"]
const PIPED = ["https://pipedapi.kavin.rocks", "https://pipedapi.adminforge.de", "https://api.piped.private.coffee"]

// --- yt-dlp ---------------------------------------------------------------------
async function viaYtDlp(query: string): Promise<Video[]> {
  const proc = Bun.spawn(["yt-dlp", "--dump-json", `ytsearch${settings().results_count}:${query}`], {
    stdout: "pipe",
    stderr: "ignore",
  })
  const text = await new Response(proc.stdout).text()
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as any)
    .map((e) => ({
      id: e.id,
      title: e.title,
      channel: e.uploader ?? "",
      date: e.upload_date ? `${e.upload_date.slice(0, 4)}-${e.upload_date.slice(4, 6)}-${e.upload_date.slice(6, 8)}` : "",
      description: clean(e.description ?? e.full_description ?? ""),
      duration: e.duration ? fmtDuration(e.duration) : "",
    }))
}

// --- invidious ---------------------------------------------------------------------
async function viaInvidious(query: string): Promise<Video[]> {
  const q = encodeURIComponent(query)
  const arr = await getJsonAny<any[]>(candidate(INVIDIOUS, settings().invidious_instance).map((i) => `${i}/api/v1/search?type=video&q=${q}`))
  return arr.map((v) => ({
    id: v.videoId,
    title: v.title,
    channel: v.author ?? "",
    date: v.publishedText ?? "",
    description: clean(v.description),
    duration: v.lengthSeconds > 0 ? fmtDuration(v.lengthSeconds) : "",
  }))
}

// --- piped ---------------------------------------------------------------------------
async function viaPiped(query: string): Promise<Video[]> {
  const q = encodeURIComponent(query)
  const json = await getJsonAny<any>(candidate(PIPED, settings().piped_instance).map((i) => `${i}/api/v1/search?q=${q}&filter=videos`))
  return (json.items ?? []).map((v: any) => ({
    id: (v.url ?? "").split("v=")[1] ?? "",
    title: v.title,
    channel: v.uploaderName ?? "",
    date: v.uploadedDate ?? "",
    description: clean(String(v.description ?? "")),
    duration: v.duration > 0 ? fmtDuration(v.duration) : "",
  }))
}

/** strip html tags + entities, collapse whitespace, cap length */
function clean(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
}

function fmtDuration(chs: number): string {
  const s = Math.round(chs)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const two = (n: number) => String(n).padStart(2, "0")
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

/** try each candidate in order, first success wins */
async function getJsonAny<T>(urls: string[]): Promise<T> {
  let last: unknown
  for (const u of urls) {
    try {
      return await getJson<T>(u)
    } catch (e) {
      last = e
    }
  }
  throw last
}

/** normalize user setting + pool fallbacks, deduped */
function candidate(pool: string[], user: string): string[] {
  return [...new Set([user, ...pool].filter(Boolean).map((u) => u.replace(/\/$/, "")))]
}

const BACKENDS: Record<BackendKey, (query: string) => Promise<Video[]>> = {
  "yt-dlp": viaYtDlp,
  invidious: viaInvidious,
  piped: viaPiped,
}

export function searchVideos(query: string): Promise<Video[]> {
  return BACKENDS[settings().backend](query)
}

export const ERR_MSG = (e: unknown) => (e instanceof Error ? e.message : String(e))
