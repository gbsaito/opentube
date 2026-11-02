import type { Video } from "./config"
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

export function play(v: Video, mode: "video" | "audio") {
  stopCurrent()
  paused = false
  setNpPaused(false)
  setNpLoop(false)
  setNpMuted(false)
  resetProgress()
  socketPath = `/tmp/opentube-mpv-${Date.now()}.sock`
  const args = mode === "audio" ? ["--no-video"] : ["--ytdl-format=bestvideo+bestaudio/best"]
  current = Bun.spawn(["mpv", ...args, "--no-terminal", "--ytdl=yes", `--input-ipc-server=${socketPath}`, url(v)], {
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
