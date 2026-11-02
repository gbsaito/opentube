import { settings, type Video } from "./config"

export type BackendKey = "yt-dlp" | "invidious"

// default instance pools: user setting first, then fallbacks for dead instances
const INVIDIOUS = ["https://yt.chocolatemoo53.com", "https://inv.nadeko.net", "https://invidious.nerdvpn.de"]

// --- yt-dlp ---------------------------------------------------------------------
// flat-playlist: fast rows (no per-video metadata crawl); missing date is filled
// lazily by updateMeta on selection
async function viaYtDlp(query: string): Promise<Video[]> {
  const proc = Bun.spawn(["yt-dlp", "--dump-json", "--flat-playlist", `ytsearch${settings().results_count}:${query}`], {
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
      channel: e.channel ?? e.uploader ?? "",
      date: e.upload_date ? `${e.upload_date.slice(0, 4)}-${e.upload_date.slice(4, 6)}-${e.upload_date.slice(6, 8)}` : "",
      description: clean(e.description ?? ""),
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
    views: String(v.viewCount ?? ""),
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
}

export function searchVideos(query: string): Promise<Video[]> {
  return BACKENDS[settings().backend](query)
}

// ponytail: ceiling is one request per selected video; upgrade to prefetch of neighbors when scroll feels sluggish
export interface VideoMeta {
  description: string
  date: string
  views: string
}

const metaCache = new Map<string, VideoMeta>()
/** meta already fetched this session (no network) */
export function cachedMeta(id: string): VideoMeta | undefined {
  return metaCache.get(id)
}

/** race all candidates, first success wins — dead instances no longer stall the response */
async function firstJson<T>(urls: string[]): Promise<T | null> {
  try {
    return await Promise.any(
      urls.map(async (u) => {
        const res = await fetch(u, { signal: AbortSignal.timeout(5000) })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return (await res.json()) as T
      }),
    )
  } catch {
    return null
  }
}

/** lazy per-video metadata: invidious search rows ship no description, yt-dlp flat rows no date/views */
export async function videoMeta(id: string): Promise<VideoMeta> {
  const hit = metaCache.get(id)
  if (hit) return hit
  const empty: VideoMeta = { description: "", date: "", views: "" }
  const urls = candidate(INVIDIOUS, settings().invidious_instance).map((i) => `${i}/api/v1/videos/${id}`)
  const j = await firstJson<any>(urls)
  const meta: VideoMeta = j
    ? { description: clean(String(j.description ?? j.descriptionHtml ?? "")), date: j.publishedText ?? "", views: String(j.viewCount ?? "") }
    : empty
  metaCache.set(id, meta)
  return meta
}

export const ERR_MSG = (e: unknown) => (e instanceof Error ? e.message : String(e))
