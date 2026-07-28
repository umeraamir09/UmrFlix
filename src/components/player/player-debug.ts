/** Central diagnostics log for the cinema player. */

export type DebugEntry = {
  t: number // epoch ms
  level: "info" | "warn" | "error"
  tag: string
  message: string
}

const MAX_ENTRIES = 120
const entries: DebugEntry[] = []
const listeners = new Set<() => void>()

function emit(level: DebugEntry["level"], tag: string, args: unknown[]) {
  const message = args
    .map((a) => {
      if (a instanceof Error) return `${a.name}: ${a.message}`
      if (typeof a === "object") {
        try {
          return JSON.stringify(a)
        } catch {
          return String(a)
        }
      }
      return String(a)
    })
    .join(" ")

  const entry: DebugEntry = { t: Date.now(), level, tag, message }
  entries.push(entry)
  if (entries.length > MAX_ENTRIES) entries.shift()
  listeners.forEach((l) => l())

  // Always mirror to the devtools console
  const prefix = `[CinemaPlayer:${tag}]`
  if (level === "error") console.error(prefix, ...args)
  else if (level === "warn") console.warn(prefix, ...args)
  else console.log(prefix, ...args)
}

export const playerLog = {
  info: (tag: string, ...args: unknown[]) => emit("info", tag, args),
  warn: (tag: string, ...args: unknown[]) => emit("warn", tag, args),
  error: (tag: string, ...args: unknown[]) => emit("error", tag, args),
}

export function getDebugEntries(): DebugEntry[] {
  return entries
}

export function subscribeDebugEntries(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
