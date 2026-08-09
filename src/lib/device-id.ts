/**
 * Retrieves or initializes a stable device identifier stored in localStorage.
 * Prevents Jellyfin multi-browser session revocation caused by static DeviceIds.
 */
export function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") {
    return "umrflix-web-server-fallback"
  }

  const STORAGE_KEY = "umrflix_device_id"
  try {
    let deviceId = localStorage.getItem(STORAGE_KEY)
    if (!deviceId || deviceId.trim().length === 0) {
      deviceId = `umrflix-${crypto.randomUUID()}`
      localStorage.setItem(STORAGE_KEY, deviceId)
    }
    return deviceId
  } catch {
    return "umrflix-web-client-fallback"
  }
}
