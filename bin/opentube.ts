#!/usr/bin/env bun
import { appendFileSync } from "fs"

// kick stdin into flowing mode before opentui mounts; without this, kitty 0.49
// delivers no keyboard events to the TUI (keys parse fine in plain ptys).
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk: string) => {
  if (process.env.OTUI_DEBUG) {
    try { appendFileSync("/tmp/opentube-raw.log", `${Date.now()} ${Buffer.from(chunk).toString("hex")}\n`) } catch {}
  }
})

import { mountApp } from "../src/app"

mountApp()
