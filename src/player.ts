import type { Video } from "./config"

const url = (v: Video) => `https://youtube.com/watch?v=${v.id}`

let current: Bun.Subprocess | null = null

/** kills any mpv still running so only one playback is active */
function stopCurrent() {
  current?.kill("SIGTERM")
  current = null
}

export function play(v: Video, mode: "video" | "audio") {
  stopCurrent()
  const args = mode === "audio" ? ["--no-video"] : ["--ytdl-format=bestvideo+bestaudio/best"]
  current = Bun.spawn(["mpv", ...args, "--no-terminal", "--ytdl=yes", url(v)], { stdout: "ignore", stderr: "ignore" })
  current.unref()
  current.exited.then(() => (current = null))
}
