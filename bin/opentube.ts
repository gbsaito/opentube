#!/usr/bin/env bun
import { appendFileSync, readlinkSync } from "fs"

// kick stdin into flowing mode before opentui mounts; without this, kitty 0.49
// delivers no keyboard events to the TUI (keys parse fine in plain ptys).
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk: string) => {
  if (process.env.OTUI_DEBUG) {
    try { appendFileSync("/tmp/opentube-raw.log", `${Date.now()} ${Buffer.from(chunk).toString("hex")}\n`) } catch {}
  }
})

// orphan guard: kitty can close its pty master without the process dying (pane
// kill / terminal restart) — the app then keeps running with stdin gone, leaves
// background processes behind after "closing", and a fresh instance appears
// frozen. poll the fds; Bun does not allow open fd to retain a deleted pts.
setInterval(() => {
  try {
    const fd0 = readlinkSync("/proc/self/fd/0")
    const fd1 = readlinkSync("/proc/self/fd/1")
    if (process.env.OTUI_DEBUG) { try { appendFileSync("/tmp/orphan-watch.log", `${Date.now()} fd0=${fd0} fd1=${fd1}\n`) } catch {} }
    if (fd0.includes("deleted") || fd1.includes("deleted")) process.exit(0)
  } catch {
    process.exit(0) // fd vanished entirely (ENOENT): pty master closed
  }
}, 2000).unref()
process.stdin.on("end", () => process.exit(0))
// opentui's renderer may install its own SIGHUP handler whose cleanup hangs on
// a dead pty; default behaviour (terminate) is what we want on teardown
process.removeAllListeners?.("SIGHUP")
process.on("SIGHUP", () => process.exit(0))

import { mountApp } from "../src/app"

mountApp()
