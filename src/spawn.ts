// tiny concurrency limiter so scroll bursts can't spawn dozens of yt-dlp processes
const MAX = 2
let running = 0
const queue: Array<() => void> = []

export function limit<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      running++
      fn().then(resolve, reject).finally(() => {
        running--
        queue.shift()?.()
      })
    }
    if (running < MAX) run()
    else queue.push(run)
  })
}

/** debounced caller: only fires with the latest args after `ms` quiet (each call postpones) */
export function settle<Args extends unknown[]>(ms: number, fn: (...args: Args) => void): (...args: Args) => void {
  let t: ReturnType<typeof setTimeout> | null = null
  return (...args: Args) => {
    if (t) clearTimeout(t)
    t = setTimeout(() => {
      t = null
      fn(...args)
    }, ms)
  }
}
