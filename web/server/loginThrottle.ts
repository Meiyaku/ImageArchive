/**
 * Slows down password guessing per username without letting anyone lock a user out.
 *
 * Why not a lockout: behind k3s's load balancer every client may share one source IP,
 * so an IP+username lockout would let anyone lock a victim out by failing on purpose.
 * Instead, after a few failures each further attempt for that username waits longer
 * (up to maxDelayMs), and attempts for the same username are handled one at a time so
 * parallel requests can't skip the wait. The real user can still sign in — at worst a
 * few seconds slower while an attack is in progress.
 *
 * Memory is bounded: idle entries expire after windowMs and at most maxKeys are kept.
 */
export interface LoginThrottleOptions {
  /** Failures allowed before delays start. */
  freeFailures?: number
  baseDelayMs?: number
  maxDelayMs?: number
  /** Concurrent attempts queued per username before rejecting with 429. */
  maxPending?: number
  windowMs?: number
  maxKeys?: number
  /**
   * Whether a success clears the failure count. True for usernames (the real user
   * signing in ends the delays). False for client IPs, so an attacker with an account
   * of their own can't sign into it between guesses to reset their IP's count.
   */
  resetOnSuccess?: boolean
}

interface Entry {
  failures: number
  lastFailure: number
  pending: number
  tail: Promise<void>
}

export class TooManyAttemptsError extends Error {}

export class LoginThrottle {
  private entries = new Map<string, Entry>()
  private opts: Required<LoginThrottleOptions>

  constructor(opts: LoginThrottleOptions = {}) {
    this.opts = {
      freeFailures: 3,
      baseDelayMs: 250,
      maxDelayMs: 3000,
      maxPending: 5,
      windowMs: 15 * 60_000,
      maxKeys: 10_000,
      resetOnSuccess: true,
      ...opts,
    }
  }

  delayFor(failures: number): number {
    const { freeFailures, baseDelayMs, maxDelayMs } = this.opts
    if (failures < freeFailures) return 0
    return Math.min(maxDelayMs, baseDelayMs * 2 ** (failures - freeFailures))
  }

  /**
   * Runs one login attempt for `key` (the lowercased username). `attempt` resolves to
   * true on success. Throws TooManyAttemptsError if too many attempts are already queued.
   */
  async run(key: string, attempt: () => Promise<boolean>): Promise<boolean> {
    const entry = this.entry(key)
    if (entry.pending >= this.opts.maxPending) throw new TooManyAttemptsError()
    entry.pending++

    let release!: () => void
    const done = new Promise<void>((resolve) => (release = resolve))
    const previous = entry.tail
    entry.tail = previous.then(() => done)

    try {
      await previous
      const wait = this.delayFor(entry.failures)
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
      const ok = await attempt()
      if (ok) {
        if (this.opts.resetOnSuccess) entry.failures = 0
      } else {
        entry.failures++
        entry.lastFailure = Date.now()
      }
      return ok
    } finally {
      entry.pending--
      release()
      if (entry.pending === 0 && entry.failures === 0) this.entries.delete(key)
    }
  }

  get size(): number {
    return this.entries.size
  }

  private entry(key: string): Entry {
    const now = Date.now()
    let entry = this.entries.get(key)
    if (entry && entry.pending === 0 && now - entry.lastFailure > this.opts.windowMs) {
      this.entries.delete(key)
      entry = undefined
    }
    if (!entry) {
      this.evict(now)
      entry = { failures: 0, lastFailure: now, pending: 0, tail: Promise.resolve() }
      this.entries.set(key, entry)
    }
    return entry
  }

  /** Drops expired idle entries, then the oldest idle ones, to stay under maxKeys. */
  private evict(now: number): void {
    if (this.entries.size < this.opts.maxKeys) return
    for (const [key, e] of this.entries) {
      if (e.pending === 0 && now - e.lastFailure > this.opts.windowMs) this.entries.delete(key)
    }
    for (const [key, e] of this.entries) {
      if (this.entries.size < this.opts.maxKeys) break
      if (e.pending === 0) this.entries.delete(key)
    }
  }
}

/**
 * Caps how many password hashes run at once across all sign-in requests. Each scrypt
 * check takes ~16 MB and tens of milliseconds of CPU, so a flood of attempts with
 * made-up usernames (which no per-username throttle sees twice) could otherwise
 * exhaust the pod. Excess callers wait in a bounded queue; beyond it they get
 * TooManyAttemptsError (a 429).
 */
export class ConcurrencyLimit {
  private active = 0
  private queue: (() => void)[] = []
  private readonly max: number
  private readonly maxQueue: number

  constructor(max = 4, maxQueue = 64) {
    this.max = max
    this.maxQueue = maxQueue
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      if (this.queue.length >= this.maxQueue) throw new TooManyAttemptsError()
      await new Promise<void>((resolve) => this.queue.push(resolve))
    } else {
      this.active++
    }
    try {
      return await task()
    } finally {
      // Hand the slot straight to the next waiter, or free it.
      const next = this.queue.shift()
      if (next) next()
      else this.active--
    }
  }

  get running(): number {
    return this.active
  }

  get waiting(): number {
    return this.queue.length
  }
}
