import { settings, type Video } from "./config"
import { limit } from "./spawn"

export type BackendKey = "yt-dlp" | "invidious"

// default instance pools: user setting first, then fallbacks for dead instances
const INVIDIOUS = ["https://yt.chocolatemoo53.com", "https://inv.nadeko.net", "https://invidious.nerdvpn.de"]

// --- yt-dlp ---------------------------------------------------------------------
// flat-playlist: fast rows (no per-video metadata crawl); missing date is filled
// lazily by updateMeta on selection
async function viaYtDlp(query: string, count?: number): Promise<Video[]> {
  const n = count ?? settings().results_count
  const proc = Bun.spawn(["yt-dlp", "--dump-json", "--flat-playlist", `ytsearch${n}:${query}`], {
    stdout: "pipe",
    stderr: "ignore",
  })
  const text = await new Response(proc.stdout).text()
  const rows = text
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
      views: "",
    }))
  // yt-dlp's flat search hands back auto-translated titles for videos with translation support;
  // invidious search serves the original ones — cross-fill title (+ views/date it has) by id
  try {
    const pages = Math.ceil(n / INVIDIOUS_API_PAGE)
    const settled = await Promise.allSettled(
      Array.from({ length: pages }, (_, k) => viaInvidious(query, 1 + k)),
    )
    const byId = new Map<string, Video>()
    for (const r of settled) if (r.status === "fulfilled") for (const v of r.value) byId.set(v.id, v)
    if (byId.size > 0)
      return rows.map((v) => {
        const iv = byId.get(v.id)
        return iv ? { ...v, title: iv.title || v.title, views: v.views || iv.views, date: v.date || iv.date } : v
      })
  } catch {}
  return rows
}

// --- invidious ---------------------------------------------------------------------
async function viaInvidious(query: string, apiPage = 1): Promise<Video[]> {
  const q = encodeURIComponent(query)
  const arr = await getJsonAny<any[]>(candidate(INVIDIOUS, settings().invidious_instance).map((i) => `${i}/api/v1/search?type=video&q=${q}&page=${apiPage}`))
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

// --- pagination ---------------------------------------------------------------------
// ponytail: invidious pages are fixed at ~20 rows; windows (results_count) may mix API page boundaries
const INVIDIOUS_API_PAGE = 20

/** rows so that the caller holds exactly `target` rows (fewer when results ran out) */
export async function searchMoreVideos(query: string, offset: number, target: number): Promise<Video[]> {
  const s = settings()
  if (s.backend === "yt-dlp") {
    const rows = await viaYtDlp(query, target)
    return rows.slice(offset, target)
  }
  // fetch every needed api page CONCURRENTLY (50 results = 3 round trips; sequential took 3x the row latency)
  const first = Math.max(1, Math.floor(offset / INVIDIOUS_API_PAGE) + 1)
  const needed = Math.ceil((target - offset) / INVIDIOUS_API_PAGE)
  const pages = await Promise.allSettled(
    Array.from({ length: needed }, (_, k) => viaInvidious(query, first + k)),
  )
  const out: Video[] = []
  for (const r of pages) if (r.status === "fulfilled") out.push(...r.value)
  return out
}

/** strip html tags + entities, keep line breaks + inner spacing (descriptions need them) */
function clean(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ") // collapse spaces/tabs but KEEP line breaks
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
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "Mozilla/5.0" } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

/** try each candidate IN PARALLEL, first success wins (sequential fallback took ~5s per dead instance) */
async function getJsonAny<T>(urls: string[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let pending = urls.length
    let last: unknown
    for (const u of urls) {
      getJson<T>(u)
        .then(resolve)
        .catch((e) => {
          last = e
          if (--pending === 0) reject(last)
        })
    }
  })
}

/** normalize user setting + pool fallbacks, deduped */
function candidate(pool: string[], user: string): string[] {
  return [...new Set([user, ...pool].filter(Boolean).map((u) => u.replace(/\/$/, "")))]
}

const BACKENDS: Record<BackendKey, (query: string) => Promise<Video[]>> = {
  "yt-dlp": viaYtDlp,
  invidious: viaInvidious,
}

/** raw /api/v1/videos JSON; races all instances, first success wins */
function invidiousVideoRaw(id: string): Promise<any | null> {
  const urls = candidate(INVIDIOUS, settings().invidious_instance).map((i) => `${i}/api/v1/videos/${id}`)
  return new Promise((resolve, reject) => {
    let pending = urls.length
    let lastErr: unknown
    for (const u of urls) {
      fetch(u, { signal: AbortSignal.timeout(4000), headers: { "User-Agent": "Mozilla/5.0" } })
        .then(async (res: Response) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          resolve(await res.json())
        })
        .catch((e) => {
          lastErr = e
          if (--pending === 0) reject(lastErr)
        })
    }
  })
}

// ponytail: memoized raced fetch with a 120s TTL — one network hit shared by meta + URL resolver
const RAW_TTL = 120_000
const rawCache = new Map<string, { at: number; j: Promise<any> }>()
/** memoized per id: the meta phases and the player's URL resolver share ONE raced fetch */
export function invidiousVideoJson(id: string): Promise<any | null> {
  const hit = rawCache.get(id)
  if (hit && Date.now() - hit.at < RAW_TTL) return hit.j
  const j = invidiousVideoRaw(id).catch(() => null) // consumers treat failures as "no data", never reject
  rawCache.set(id, { at: Date.now(), j })
  if (rawCache.size > 64) {
    const first = rawCache.keys().next().value
    if (first) rawCache.delete(first)
  }
  return j
}

export function searchVideos(query: string): Promise<Video[]> {
  return BACKENDS[settings().backend](query)
}

/** primary backend failed entirely (all instances down / no instance reachable): fall through to the other backend */
export async function searchVideosWithFallback(query: string): Promise<Video[]> {
  try {
    return await searchVideos(query)
  } catch (e) {
    const other: BackendKey = settings().backend === "invidious" ? "yt-dlp" : "invidious"
    void e // first failure noted; the fallback's own error (if any) is what the user sees
    return await BACKENDS[other](query)
  }
}

// ponytail: ceiling is one request per selected video; upgrade to prefetch of neighbors when scroll feels sluggish
export interface VideoMeta {
  title: string // original-language title (search rows may carry a translated one)
  description: string
  date: string
  views: string
  duration: string
}

const EMPTY_META: VideoMeta = { title: "", description: "", date: "", views: "", duration: "" }

const metaCache = new Map<string, VideoMeta>()
/** meta already fetched this session (no network) */
export function cachedMeta(id: string): VideoMeta | undefined {
  return metaCache.get(id)
}

function putCache(id: string, m: VideoMeta) {
  if (m.description || m.date || m.views || m.duration) metaCache.set(id, m) // failed/empty fetches stay uncached (retryable)
}

/** merge both sources field-by-field: first non-empty wins (invidious preferred: usually fastest);
 *  title prefers yt-dlp — the watch page serves the untranslated title, the APIs hand back translated ones */
function mergeMeta(iv: VideoMeta | null, yt: VideoMeta | null): VideoMeta {
  return {
    title: yt?.title || iv?.title || "",
    description: iv?.description || yt?.description || "",
    date: iv?.date || yt?.date || "",
    views: iv?.views || yt?.views || "",
    duration: iv?.duration || yt?.duration || "",
  }
}

// one fetch task per id: fast phase = invidious snapshot (~1s), slow phase = yt-dlp
// ONLY when invidious left a field empty (saves a ~2-8s CPU spawn per selection)
type MetaTask = { fast: Promise<VideoMeta>; full: Promise<VideoMeta> }
let inflight: { id: string; task: MetaTask } | null = null

const isFull = (m: VideoMeta) => !!(m.description && m.date && m.views && m.duration)

function metaTask(id: string): MetaTask {
  const ivP = invidiousMeta(id)
  const fast = ivP
    .then((m) => m ?? EMPTY_META)
    .then((meta) => {
      putCache(id, meta)
      return meta
    })
  // slow phase: merge in the yt-dlp source only for the fields invidious lacks
  const full = ivP.then(async (iv) => {
    let meta = mergeMeta(iv, null)
    if (isFull(meta)) {
      putCache(id, meta)
      return meta
    }
    const yt = await ytdlpMeta(id).catch(() => null)
    meta = mergeMeta(iv, yt)
    putCache(id, meta)
    return meta
  })
  return { fast, full }
}

/** lazy per-video metadata: invidious search rows ship no description, yt-dlp flat rows no views;
 *  returns the first available snapshot (usually ~1s from an invidious instance) */
export async function videoMeta(id: string): Promise<VideoMeta> {
  const hit = metaCache.get(id)
  if (hit) return hit
  if (inflight?.id !== id) inflight = { id, task: metaTask(id) }
  return inflight.task.fast
}

/** complete merged metadata: waits for both sources, merges every non-empty field */
export async function videoMetaFull(id: string): Promise<VideoMeta> {
  const cached = metaCache.get(id)
  if (cached && cached.description && cached.date && cached.views && cached.duration) return cached
  if (inflight?.id !== id) inflight = { id, task: metaTask(id) }
  return inflight.task.full
}

async function invidiousMeta(id: string): Promise<VideoMeta | null> {
  const j = await invidiousVideoJson(id)
  if (!j) return null
  return {
    title: String(j.title ?? ""),
    description: clean(String(j.description ?? j.descriptionHtml ?? "")),
    date: j.publishedText ?? "",
    views: String(j.viewCount ?? ""),
    duration: j.lengthSeconds > 0 ? fmtDuration(j.lengthSeconds) : "",
  }
}

async function ytdlpMeta(id: string): Promise<VideoMeta> {
  try {
    return await limit(() =>
      (async () => {
        const proc = Bun.spawn(
          // player_client bypasses the YouTube bot-check that blocks default clients today
      ["yt-dlp", "--no-warnings", "--socket-timeout", "5", "--extractor-args", "youtube:player_client=mweb,tv", "--dump-json", `https://www.youtube.com/watch?v=${id}`],
          { stdout: "pipe", stderr: "ignore" },
        )
        const text = await new Response(proc.stdout).text()
        const j = JSON.parse(text) as any
        return {
          title: j.title ?? "",
          description: clean(j.description ?? ""),
          date: j.upload_date ? `${j.upload_date.slice(0, 4)}-${j.upload_date.slice(4, 6)}-${j.upload_date.slice(6, 8)}` : "",
          views: String(j.view_count ?? ""),
          duration: j.duration ? fmtDuration(j.duration) : "",
        }
      })(),
    )
  } catch {
    return EMPTY_META
  }
}

export const ERR_MSG = (e: unknown) => (e instanceof Error ? e.message : String(e))
