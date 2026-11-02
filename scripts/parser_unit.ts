// parser unit test: feed the exact wedge chunk to @opentui/core StdinParser2 (bun runtime)
import { StdinParser } from "@opentui/core"

const events: any[] = []

const parser = new (StdinParser as any)({
  timeoutMs: 20,
  armTimeouts: false,
  onTimeoutFlush: () => {},
  useKittyKeyboard: true,
  protocolContext: { kittyKeyboardEnabled: true },
})
// tap event emission: replace key handler dispatch if needed via exported API
;// try public-ish APIs first
const anyParser = parser as any
const origEmit = anyParser.emit?.bind(anyParser)
function report(tag: string) {
  console.log(tag, JSON.stringify(events))
}

function lookEvents() {
  // the parser likely exposes either `events` array or emits via callback
  if (anyParser.events) { events.push(...anyParser.events); anyParser.events.length = 0 }
  return events
}

const push = (chunk: Buffer | string) => {
  const data = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk
  anyParser.push(data)
  for (const fn of hooks) fn()
  lookEvents()
}
const hooks: Array<() => void> = []

// hook: intercept emitKeyOrResponse / emitMouse response if present
const hookNames = ["emitKeyOrResponse", "emitMouse", "emitOpaqueResponse", "emitPaste"]
hookNames.forEach((n) => {
  const f = anyParser[n]
  if (f) {
    anyParser[n] = function (...args: any[]) {
      events.push({ hook: n, args })
      // @ts-ignore
      return f.apply(this, args)
    }
  }
})
parser.setDispatch?.((e: any) => events.push(e))

push("hi\r")
push("\x1b[27u\x1b[B\x09")
push("\x1b[<35;55;37M", )
console.log("flush wait...")
setTimeout(() => { console.log("events:"), console.log(events) }, 40)
