import { test, expect } from "bun:test"
import { videoMeta, cachedMeta } from "./backends"
import { settings, setSettings } from "./config"

test("videoMeta races the instance pool, cleans html and caches", async () => {
  const real = globalThis.fetch
  ;(globalThis as any).fetch = async (u: any) => {
    const url = String(u)
    if (url.includes("/api/v1/videos/abc")) return new Response(JSON.stringify({ descriptionHtml: "<b>HTML<i>desc</i></b>  here", publishedText: "13 years ago", viewCount: 12345 }))
    return new Response("nope", { status: 500 })
  }
  const before = settings()
  setSettings({ ...before, invidious_instance: "http://stub.inv" } as any)
  try {
    expect(await videoMeta("abc")).toEqual({ description: "HTMLdesc here", date: "13 years ago", views: "12345" })
    expect(cachedMeta("abc")?.views).toBe("12345") // session cache
    expect(await videoMeta("missing")).toEqual({ description: "", date: "", views: "" }) // all candidates failed
  } finally {
    setSettings(before)
    ;(globalThis as any).fetch = real
  }
})
