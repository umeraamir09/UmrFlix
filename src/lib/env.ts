export function env(key: string): string {
  const value = process.env[key]
  if (!value) {
    if (typeof window === "undefined" && process.env.NODE_ENV === "development") {
      console.warn(`[env] Warning: Environment variable "${key}" is not set.`)
    }
    return ""
  }
  return value
}
