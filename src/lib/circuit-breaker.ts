export type CircuitState = "CLOSED" | "OPEN" | "HALF-OPEN"

export interface CircuitBreakerOptions {
  failureThreshold?: number
  resetTimeoutMs?: number
  name?: string
}

export class CircuitBreaker {
  public state: CircuitState = "CLOSED"
  private failureCount = 0
  private lastFailureTime = 0
  private failureThreshold: number
  private resetTimeoutMs: number
  public name: string

  constructor(options?: CircuitBreakerOptions) {
    this.failureThreshold = options?.failureThreshold ?? 3
    this.resetTimeoutMs = options?.resetTimeoutMs ?? 30_000
    this.name = options?.name ?? "DefaultService"
  }

  public canExecute(): boolean {
    if (this.state === "CLOSED") return true

    if (this.state === "OPEN") {
      const now = Date.now()
      if (now - this.lastFailureTime > this.resetTimeoutMs) {
        this.state = "HALF-OPEN"
        return true
      }
      return false
    }

    // HALF-OPEN state: allows a trial execution
    return true
  }

  public recordSuccess(): void {
    this.failureCount = 0
    this.state = "CLOSED"
  }

  public recordFailure(): void {
    this.failureCount++
    this.lastFailureTime = Date.now()

    if (this.failureCount >= this.failureThreshold) {
      this.state = "OPEN"
      if (process.env.NODE_ENV === "development") {
        console.warn(`[CircuitBreaker] Service '${this.name}' tripped to OPEN state after ${this.failureCount} failures.`)
      }
    }
  }

  public getState(): { state: CircuitState; failureCount: number; name: string } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      name: this.name,
    }
  }
}

// Attach singletons to globalThis for process safety across HMR and Next.js route handlers
const globalForBreakers = globalThis as unknown as {
  radarrBreaker?: CircuitBreaker
  sonarrBreaker?: CircuitBreaker
  jellyfinBreaker?: CircuitBreaker
  tmdbBreaker?: CircuitBreaker
  convexBreaker?: CircuitBreaker
}

export const radarrBreaker =
  globalForBreakers.radarrBreaker ??
  (globalForBreakers.radarrBreaker = new CircuitBreaker({ name: "Radarr", failureThreshold: 3, resetTimeoutMs: 30_000 }))

export const sonarrBreaker =
  globalForBreakers.sonarrBreaker ??
  (globalForBreakers.sonarrBreaker = new CircuitBreaker({ name: "Sonarr", failureThreshold: 3, resetTimeoutMs: 30_000 }))

export const jellyfinBreaker =
  globalForBreakers.jellyfinBreaker ??
  (globalForBreakers.jellyfinBreaker = new CircuitBreaker({ name: "Jellyfin", failureThreshold: 3, resetTimeoutMs: 30_000 }))

export const tmdbBreaker =
  globalForBreakers.tmdbBreaker ??
  (globalForBreakers.tmdbBreaker = new CircuitBreaker({ name: "TMDB", failureThreshold: 4, resetTimeoutMs: 20_000 }))

export const convexBreaker =
  globalForBreakers.convexBreaker ??
  (globalForBreakers.convexBreaker = new CircuitBreaker({ name: "Convex", failureThreshold: 5, resetTimeoutMs: 45_000 }))

// ── Single-Flight Request Coalescer ──
export class SingleFlight {
  private static inFlight = new Map<string, Promise<unknown>>()

  public static async execute<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key)
    if (existing) {
      return existing as Promise<T>
    }

    const promise = fn().finally(() => {
      this.inFlight.delete(key)
    })

    this.inFlight.set(key, promise)
    return promise
  }
}
