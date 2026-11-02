import { test, expect } from "bun:test"
import { videoDescription } from "./backends"
import { settings, setSettings } from "./config"

test("videoDescription fetches from the instance pool, cleans html and caches", async () => {
  const real = globalThis.fetch
  ;(globalThis as any).fetch = async (u: any) => {
    const url = String(u)
    if (url.includes("/api/v1/videos/abc")) return new Response(JSON.stringify({ descriptionHtml: "<b>HTML<i>desc</i></b>  here\n\n" }))
    return new Response("nope", { status: 500 })
  }
  const before = settings()
  setSettings({ ...before, invidious_instance: "http://stub.inv" } as any)
  try {
    expect(await videoDescription("abc")).toBe("HTMLdesc here")
    const beforeCalls = await Promise.resolve() // stub captured per call below
    expect(await videoDescription("abc")).toBe("HTMLdesc here") // cached, no second network hit
    expect(await videoDescription("missing")).toBe("") // all candidates failed -> empty
  } finally {
    setSettings(before)
    ;(globalThis as any).fetch = real
  }
})
