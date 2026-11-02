import { test, expect } from "bun:test"
import { testRender } from "@opentui/solid"
import { App } from "./app"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)) // lone ESC flushes via parser timer

async function mountHome(width = 90, height = 30) {
  const t = await testRender(() => <App />, { width, height })
  await t.waitForVisualIdle({ quietFrames: 2 })
  return t
}

test("home screen renders title art, search box and all quick access items", async () => {
  await using t = await mountHome()
  const frame = t.captureCharFrame()
  expect(frame).toContain("█") // ascii_font title art
  expect(frame).toContain("search youtube") // search box placeholder
  expect(frame).toContain("history")
  expect(frame).toContain("playlists")
  expect(frame).toContain("subscriptions")
  expect(frame).toContain("settings")
})
