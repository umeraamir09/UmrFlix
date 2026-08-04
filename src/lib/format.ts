export function formatSpeed(bytesPerSec?: number): string {
  if (bytesPerSec == null || bytesPerSec <= 0) return ""
  const units = ["B/s", "KB/s", "MB/s", "GB/s"]
  let val = bytesPerSec
  let i = 0
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024
    i++
  }
  return `${val >= 100 ? Math.round(val) : val.toFixed(1)} ${units[i]}`
}

export function formatEta(seconds?: number): string {
  if (seconds == null) return ""
  if (seconds < 0 || seconds >= 86400 * 365) return "∞"
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const remMins = mins % 60
  if (hours < 48) return `${hours}h ${remMins}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}
