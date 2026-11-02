// parser unit test v2: exact app-like push/drain; single push of the wedge chunk
import { StdinParser } from "@opentui/core"

const events: any[] = []
const parser = new (StdinParser as any)({
  timeoutMs: 20,
  armTimeouts: true,
  onTimeoutFlush: () => {},
  useKittyKeyboard: true,
  protocolContext: { kittyKeyboardEnabled: true },
})
const anyParser = parser as any
const hookNames = ["emitKeyOrResponse", "emitMouse", "emitOpaqueResponse"]
hookNames.forEach((n) => {
  const f = anyParser[n]
  if (f) anyParser[n] = function (...args: any[]) { events.push({ hook: n, args }); return f.apply(this, args) }
})

const drain = () => anyParser.drain((event: any) => events.push(event))

// sequence 1: single push = whole LUMP like kitty delivered
process.stdout.write("single push drain: ")
anyParser.push(Buffer.from("hi\r\x1b[27u\x1b[B\x09"))
process.stdout.write(`events so far ${events.length}; `)
drain()
process.stdout.write(`after drain ${events.length}; `)
setTimeout(() => {
  drain()
  process.stdout.write(`after timeout drain ${events.length}\n`)
  for (const e of events) {
    const k = e.key ?? e
    console.log(k?.type, k?.name ?? k?.hook ?? "", JSON.stringify(k?.args ?? k?.sequence ?? k?.key?.name ?? "").slice(0, 60))
  }
}, 40)
