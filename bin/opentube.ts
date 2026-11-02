#!/usr/bin/env bun
import { appendFileSync } from "fs"

// diagnostic: record raw bytes kitty sends, exactly as received (temporary)
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk: string) => {
  try {
    appendFileSync("/tmp/opentube-raw.log", `${Date.now()} ${Buffer.from(chunk).toString("hex")}\n`)
  } catch {}
})

import { mountApp } from "../src/app"

mountApp()
