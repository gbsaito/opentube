import { test, expect } from "bun:test"
import { videoMeta, videoMetaFull, cachedMeta } from "./backends"
import { settings, setSettings } from "./config"

test("videoMeta: fast phase fills from invidious, full phase merges, cleans html, caches", async () => {
  const real = globalThis.fetch
  const realSpawn = Bun.spawn
  ;(globalThis as any).fetch = async (u: any) => {
    const url = String(u)
    if (url.includes("/api/v1/videos/abc")) return new Response(JSON.stringify({ title: "original title", descriptionHtml: "<b>HTML<i>desc</i></b>  here", publishedText: "13 years ago", viewCount: 12345, lengthSeconds: 3723 }))
    return new Response("nope", { status: 500 })
  }
  // stub yt-dlp fallback (hermetic): unparseable stdout -> empty meta
  ;(Bun as any).spawn = () => ({ stdout: new Response("").body })
  const before = settings()
  setSettings({ ...before, invidious_instance: "http://stub.inv" } as any)
  try {
    expect(await videoMeta("abc")).toEqual({ title: "original title", description: "HTMLdesc here", date: "13 years ago", views: "12345", duration: "1:02:03" })
    const full = await videoMetaFull("abc")
    expect(full.date).toBe("13 years ago")
    expect(cachedMeta("abc")?.views).toBe("12345") // session cache
    expect(await videoMeta("missing")).toEqual({ title: "", description: "", date: "", views: "", duration: "" }) // all candidates failed
  } finally {
    setSettings(before)
    ;(globalThis as any).fetch = real
    ;(Bun as any).spawn = realSpawn
  }
})
