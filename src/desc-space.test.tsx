import { test, expect } from "bun:test"
import { testRender } from "@opentui/solid"
import { descPieces } from "./app"

// real line from https://youtu.be/S7PSi2h3cuQ — fold at 92 lands between "your" and "energy";
// the old flat-pieces + join("") rendering merged them into "Where yourenergy"
const LINE =
  "This is your inner compass built for sharp intuition, soul-aligned choices, and unstoppable self-trust. This is where intuition meets boldness. Where clarity feels loud. Where your energy walks into the room before you do."

test("descPieces: folded rows keep word boundaries (no merged words)", () => {
  const rendered = descPieces(LINE, 92).map((r) => r.map((p) => p.t).join("")).join("\n")
  expect(rendered).toContain("Where your\nenergy walks") // fold boundary = real line break
  expect(rendered).not.toContain("yourenergy")
  expect(rendered).not.toContain("unstoppableself-trust")
})

test("descPieces: url shares the trailing-words row; text after starts a fresh row", () => {
  const rows = descPieces(
    "leading words keep going and going so that this first plain segment definitely exceeds the fold width of ninety-two characters and folds https://example.com/x and then plenty of trailing words that surely overflow the fold width and wrap onto more rows",
    92,
  )
  const i = rows.findIndex((r) => r.some((p) => p.url))
  expect(i).toBeGreaterThan(0) // leading text folded first
  expect(rows[i]!.some((p) => p.url)).toBe(true)
  expect(rows[i + 1]!.every((p) => !p.url)).toBe(true) // post-url text on its own rows
})

test("desc text keeps spaces (static render, modal-shaped nesting)", async () => {
  await using t = await testRender(() => (
    <box width="90%" height="96%" border={["top", "bottom", "left", "right"]} paddingTop={1}>
      <scrollbox scrollY flexGrow={1} scrollbarOptions={{ visible: false }}>
        <box paddingLeft={2}>
          <text fg="#ffffff" selectable={false}>{"Where your energy walks into the room before you do."}</text>
        </box>
      </scrollbox>
    </box>
  ), { width: 110, height: 20 })
  await t.waitForVisualIdle({ quietFrames: 2 })
  expect(t.captureCharFrame()).toContain("Where your energy walks")
})
