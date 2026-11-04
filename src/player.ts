import type { Video, Settings } from "./config"
import { settings } from "./config"
import { limit } from "./spawn"
import { invidiousVideoJson } from "./backends"
import { createSignal } from "solid-js"
import { appendFileSync } from "fs"

const url = (v: Video) => `https://youtube.com/watch?v=${v.id}`

let current: Bun.Subprocess | null = null
let socketPath = ""
let conn: Bun.Socket | null = null
let pending: Array<"time" | "dur"> = []
let buf = ""
let poller: ReturnType<typeof setInterval> | null = null
let firstPlayAt = 0
let paused = false

// live playback position/total reported to the now-playing screen
export const [npTime, setNpTime] = createSignal(0)
export const [npDur, setNpDur] = createSignal(0)
export const [npLoop, setNpLoop] = createSignal(false)
export const [npPaused, setNpPaused] = createSignal(false)
export const [npMuted, setNpMuted] = createSignal(false)

export function isPaused() {
  return paused
}
export function togglePause() {
  paused = !paused
  setNpPaused(paused)
  void sendCommand(["set_property", "pause", paused])
}
export function toggleLoop() {
  const on = !npLoop()
  setNpLoop(on)
  void sendCommand(["set_property", "loop", on ? "inf" : "no"])
}
export function toggleMute() {
  const on = !npMuted()
  setNpMuted(on)
  void sendCommand(["set_property", "mute", on ? "yes" : "no"])
}
export function seekTo(sec: number) {
  void sendCommand(["seek", sec, "absolute"])
}
export function stopPlayback() {
  stopCurrent()
}
let playbackEndCb: (() => void) | null = null
/** UI hook: fires once when the active mpv exits on its own (ended/killed) */
export function onPlaybackEnd(cb: () => void) {
  playbackEndCb = cb
}
function sendCommand(cmd: unknown[]) {
  if (!conn) return
  try {
    conn.write(`${JSON.stringify({ command: cmd })}\n`)
  } catch {
    conn = null
  }
}

function resetProgress() {
  setNpTime(0)
  setNpDur(0)
}

/** kills any mpv still running so only one playback is active */
function stopCurrent() {
  current?.kill("SIGTERM")
  current = null
  if (poller) clearInterval(poller)
  poller = null
  try {
    conn?.close()
  } catch {}
  conn = null
  buf = ""
}

async function ensureConn(): Promise<boolean> {
  if (conn) return true
  try {
    conn = await Bun.connect({
      unix: socketPath,
      socket: {
        data(_s, chunk) {
          buf += new TextDecoder().decode(chunk)
          let nl: number
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl)
            buf = buf.slice(nl + 1)
            const kind = pending.shift() // reply order = request order
            try {
              const o = JSON.parse(line)
              if (o.error !== "success" || o.data == null) continue
              if (kind === "time") setNpTime(o.data)
              else if (kind === "dur") setNpDur(o.data)
            } catch {}
          }
        },
        error() {
          conn = null
        },
        close() {
          conn = null
        },
      },
    })
    return true
  } catch {
    return false // socket not up yet
  }
}

/** query playback-time/duration over the mpv JSON IPC socket */
async function poll() {
  if (!current) {
    if (poller) clearInterval(poller)
    poller = null
    return
  }
  // give up retrying if mpv never opened the IPC socket (weird build)
  if (!conn && Date.now() - firstPlayAt > 10000) return
  if (!(await ensureConn()) || !conn) return
  try {
    const c = conn // tsc: conn can be nulled by async close during the await
    pending.push("time", "dur")
    c.write(`${JSON.stringify({ command: ["get_property", "playback-time"], request_id: 1 })}\n`)
    c.write(`${JSON.stringify({ command: ["get_property", "duration"], request_id: 2 })}\n`)
  } catch {
    conn = null
  }
}

// --- prefetch: resolve media URLs on hover/selection so play() skips the ~4s mpv/ytdl hop ---
type MediaUrls = { videoUrl?: string; audioUrl?: string }
const urlCache = new Map<string, Promise<MediaUrls>>()

/** map the settings `quality` value to a yt-dlp format selector */
function ytdlFormat(mode: "video" | "audio"): string {
  const q = settings().quality
  if (mode === "audio") return "ba"
  switch (q) {
    case "lowest": return "wv*+wa/w"
    case "480p": return "bv*[height<=480]+ba/b[height<=480]"
    case "720p": return "bv*[height<=720]+ba/b[height<=720]"
    case "1080p": return "bv*[height<=1080]+ba/b[height<=1080]"
    case "2160p": return "bv*[height<=2160]+ba/b[height<=2160]"
    // best/auto: highest quality muxed stream
    default: return "bv*+ba/b"
  }
}

/** quality cap in px, or 0 for unlimited */
function qualityCap(q: string): number {
  return ({ "480p": 480, "720p": 720, "1080p": 1080, "2160p": 2160 } as Record<string, number>)[q] ?? 0
}

/** fast path: invidious serves direct googlevideo URLs in ~2s (yt-dlp resolve takes ~7s); shares
 *  the memoized raced fetch with the meta pipeline, so selecting a row pays for it exactly once */
async function invidiousUrls(id: string, mode: "video" | "audio"): Promise<MediaUrls> {
  const j = await invidiousVideoJson(id)
  if (!j) return {}
  const af: any[] = (j.adaptiveFormats ?? []).filter((f: any) => f?.url)
  const res = (f: any) => parseInt(String(f.resolution ?? ""), 10) || 0
  const aud = af
    .filter((f) => String(f.type ?? "").startsWith("audio"))
    .sort((a, b) => Number(b.language_preference ?? -1) - Number(a.language_preference ?? -1) || (b.bitrate ?? 0) - (a.bitrate ?? 0))
  // invidious marks tracks in the URL xtags: acont=original vs acont=dubbed-auto; prefer the original
  // (xtags value is percent-encoded: acont%3Ddubbed-auto%3Alang%3Duk — decode before parsing)
  const acont = (f: any): string => {
    const m = String(f.url ?? "").match(/xtags=([^&]*)/)
    if (!m) return "unknown"
    const raw = m[1]!.replace(/%3A/gi, ":").replace(/%3D/gi, "=")
    const ac = raw.split(":").map((s) => s.split("=")).find((kv) => kv[0] === "acont")
    return ac ? String(ac[1] ?? "") : "unknown"
  }
  const p = (s: any) => String(s ?? "").toLowerCase().split(/[-_]/)[0]!
  const orig = String(j.original_language ?? j.language ?? "").trim().toLowerCase()
  // prefer original: first by acont==original, then skip all dubbed tracks, then any
  const audio = aud.find((f) => orig && p(f.language) === p(orig))
    || aud.find((f) => acont(f) === "original")
    || aud.find((f) => acont(f) !== "dubbed-auto")
    || aud[0]
  if (mode === "audio") return audio ? { audioUrl: audio.url, videoUrl: undefined } : {}
  let vid = af.filter((f) => String(f.type ?? "").startsWith("video"))
  if (vid.length === 0) return {}
  if (settings().quality === "lowest") {
    vid.sort((a, b) => res(a) - res(b) || (a.bitrate ?? 0) - (b.bitrate ?? 0))
  } else {
    vid.sort((a, b) => res(b) - res(a) || (b.bitrate ?? 0) - (a.bitrate ?? 0))
    const cap = qualityCap(settings().quality)
    if (cap) {
      const capped = vid.filter((f) => res(f) > 0 && res(f) <= cap)
      vid = capped.length > 0 ? capped : [vid[vid.length - 1]!] // fall back to the smallest stream
    }
  }
  return { videoUrl: vid[0].url, audioUrl: audio?.url }
}

/** slow fallback: full yt-dlp format-selector resolve */
async function ytdlpUrls(id: string, mode: "video" | "audio"): Promise<MediaUrls> {
  try {
    const fmt = ytdlFormat(mode)
    // player_client bypasses the YouTube bot-check that blocks default clients today; android =
    // the autodub-free client yt-dlp resolves against here (mweb,tv was picking the dubbed stream)
    const proc = Bun.spawn(["yt-dlp", "--no-warnings", "--socket-timeout", "5", "--extractor-args", "youtube:player_client=android", "-f", fmt, "--print", "urls", `https://youtube.com/watch?v=${id}`], {
      stdout: "pipe",
      stderr: "ignore",
    })
    const text = await new Response(proc.stdout).text()
    const urls = text.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("http"))
    if (urls.length === 0) return {}
    if (urls.length === 1) return { videoUrl: urls[0]!, audioUrl: mode === "audio" ? urls[0]! : undefined }
    return { videoUrl: urls[0]!, audioUrl: urls[1]! } // bv*+ba: first = video, second = audio
  } catch {
    return {}
  }
}

function resolveUrls(id: string, mode: "video" | "audio"):
 Promise<MediaUrls> {
  return limit(() =>
    invidiousUrls(id, mode).then((u) => (u.videoUrl || u.audioUrl ? u : ytdlpUrls(id, mode))),
  )
}

export function urlCacheClear() {
  urlCache.clear()
}

/** start resolving play URLs in the background (call on row selection/hover) */
export function prewarm(v: Video | undefined, mode: "video" | "audio" = "video") {
  const id = v?.id
  if (!id) return
  const key = `${settings().quality}:${mode}:${id}`
  if (!urlCache.has(key)) urlCache.set(key, resolveUrls(id, mode))
  // ponytail: LRU-less cap; drop oldest when oversized
  if (urlCache.size > 24) {
    const first = urlCache.keys().next().value
    if (first) urlCache.delete(first)
  }
}

export function play(v: Video, mode: "video" | "audio") {
  void doPlay(v, mode)
}

let playSeq = 0 // guards against interleaved doPlay awaits: only the newest call may spawn
async function doPlay(v: Video, mode: "video" | "audio", bypass = false) {
  const seq = ++playSeq
  const q = settings().quality
  let u: MediaUrls | undefined
  if (mode === "video") {
    // bypass: skip resolution entirely, let mpv/ytdl resolve the watch page itself (stale-URL retry)
    // fresh-resolve every play: backend/pick fixes don't invalidate the session urlCache (stale dubbed URL)
    if (!bypass) {
      urlCache.delete(`${q}:video:${v.id}`)
      urlCache.delete(`${q}:audio:${v.id}`)
    }
    u = bypass ? undefined : (prewarm(v), await urlCache.get(`${q}:video:${v.id}`))
    if (!bypass && seq !== playSeq) return // a newer play/selection superseded this one
  }
  const spawnedWithDirect = !bypass && mode === "video" && !!(u?.videoUrl ?? u?.audioUrl)
  stopCurrent()
  paused = false
  setNpPaused(false)
  setNpLoop(false)
  setNpMuted(false)
  resetProgress()
  socketPath = `/tmp/opentube-mpv-${Date.now()}.sock`
  const base = ["--no-terminal", `--input-ipc-server=${socketPath}`]
  if (settings().fullscreen) base.push("--fullscreen")
  let mediaUrl: string | undefined
  const args: string[] = []
  if (mode === "audio") {
    // googlevideo serves exactly ONE 1MiB range GET per invidious-issued URL and 403s every
    // follow-up — a direct audio stream hits a clean EOF once the 1MiB buffer runs dry (~65s of
    // audio; past the 10s neverPlayed retry window, so audio uniquely died mid-listen). mpv's own
    // yt-dlp shim streams whole tracks (fresh tokens per connection) — always use it for audio.
    args.push("--no-video", `--ytdl-format=${ytdlFormat(mode)}`, "--ytdl=yes")
    mediaUrl = url(v)
  } else {
    mediaUrl = u?.videoUrl
    if (mediaUrl) {
      args.push("--no-ytdl")
      if (u?.audioUrl) args.push(`--audio-file=${u.audioUrl}`)
    }
  }
  if (!mediaUrl) {
    args.push(`--ytdl-format=${ytdlFormat(mode)}`, "--ytdl=yes")
    mediaUrl = url(v)
  }
  // ponytail: mpv's log goes to /tmp/opentube-mpv-last.log (truncated per play) — mid-track deaths
  // were invisible before (--no-terminal silences stderr entirely, so use --log-file); drop the
  // capture once the death reason is known/handled
  args.push("--log-file=/tmp/opentube-mpv-last.log")
  const proc = Bun.spawn(["mpv", ...base, ...args, mediaUrl], {
    stdout: "ignore",
    stderr: "ignore",
  })
  proc.unref()
  current = proc
  proc.exited.then((code) => {
    if (current !== proc) return // superseded by a newer playback; its own exit handles teardown
    current = null
    try {
      conn?.close()
    } catch {}
    conn = null
    if (poller) clearInterval(poller)
    poller = null
    const t = npTime()
    const d = npDur()
    try {
      appendFileSync("/tmp/opentube-playback.log", `${new Date().toISOString()} exit=${code} played=${Math.floor(t)}/${Math.floor(d)}s mode=${mode} bypass=${bypass} ${v.id} (stderr: /tmp/opentube-mpv-last.log)\n`)
    } catch {}
    // mpv died without ever playing (expired/403'd resolved direct URL, or the
    // ytdl shim's client probes passed a poison URL in a bad server mood): retry
    // ONCE via a fresh resolve/ytdl run before giving up to the UI
    const neverPlayed = t <= 0 && d <= 0 && Date.now() - firstPlayAt < 10000
    if ((spawnedWithDirect || mode === "audio") && !bypass && neverPlayed) {
      urlCache.delete(`${q}:video:${v.id}`)
      urlCache.delete(`${q}:audio:${v.id}`) // poisoned resolve, don't hand it out again
      void doPlay(v, mode, true)
      return
    }
    playbackEndCb?.() // UI returns from now-playing when playback really ends
  })
  firstPlayAt = Date.now()
  poller = setInterval(() => void poll(), 500)
}
