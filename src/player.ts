import type { Video } from "./config"
import { settings } from "./config"
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

// --- format selection ---------------------------------------------------------------

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

export function play(v: Video, mode: "video" | "audio") {
  void doPlay(v, mode)
}

let playSeq = 0 // guards against interleaved doPlay awaits: only the newest call may spawn
async function doPlay(v: Video, mode: "video" | "audio", bypass = false) {
  const seq = ++playSeq
  if (!bypass && seq !== playSeq) return // a newer play/selection superseded this one
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
  // BOTH modes stream via mpv's own yt-dlp shim (watch URL, fresh tokens per connection).
  // invidious direct URLs are unusable: googlevideo serves exactly ONE 1MiB range GET per
  // audio URL and 403s every follow-up — video mode's --audio-file hit that wall at ~65s
  // (a 1-min trailer froze every time); the shim's URLs answer repeated range GETs, so the
  // demuxer cache fills normally (readahead 120s) in every mode.
  if (mode === "audio") args.push("--no-video")
  args.push(`--ytdl-format=${ytdlFormat(mode)}`, "--ytdl=yes")
  mediaUrl = url(v)
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
    // mpv died without ever playing (the ytdl shim's client probes passed a poison URL in a
    // bad server mood): retry ONCE via a fresh shim run before giving up to the UI
    const neverPlayed = t <= 0 && d <= 0 && Date.now() - firstPlayAt < 10000
    if (!bypass && neverPlayed) {
      void doPlay(v, mode, true)
      return
    }
    playbackEndCb?.() // UI returns from now-playing when playback really ends
  })
  firstPlayAt = Date.now()
  poller = setInterval(() => void poll(), 500)
}
