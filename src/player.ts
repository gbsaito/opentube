import type { Video, Settings } from "./config"
import { settings } from "./config"
import { createSignal } from "solid-js"

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

function resolveUrls(id: string, mode: "video" | "audio"):
 Promise<MediaUrls> {
  return (async () => {
    try {
      const fmt = ytdlFormat(mode)
      const proc = Bun.spawn(["yt-dlp", "--no-warnings", "--socket-timeout", "5", "-f", fmt, "--print", "urls", `https://youtube.com/watch?v=${id}`], {
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
  })()
}

export function urlCacheClear() {
  urlCache.clear()
}

/** start resolving play URLs in the background (call on row selection/hover) */
export function prewarm(v: Video | undefined, mode: "video" | "audio" = "video") {  const id = v?.id
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

async function doPlay(v: Video, mode: "video" | "audio") {
  prewarm(v, mode)
  const u = await urlCache.get(`${settings().quality}:${mode}:${v.id}`)
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
    mediaUrl = u?.audioUrl ?? u?.videoUrl
    if (mediaUrl) args.push("--no-video", "--no-ytdl")
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
  current = Bun.spawn(["mpv", ...base, ...args, mediaUrl], {
    stdout: "ignore",
    stderr: "ignore",
  })
  current.unref()
  current.exited.then(() => {
    current = null
    try {
      conn?.close()
    } catch {}
    conn = null
    if (poller) clearInterval(poller)
    poller = null
  })
  firstPlayAt = Date.now()
  poller = setInterval(() => void poll(), 500)
}
