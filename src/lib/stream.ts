export function buildJellyfinStreamUrl(
  jellyfinUrl: string,
  itemId: string,
  token: string
): string {
  return `${jellyfinUrl}/Videos/${itemId}/stream?static=true&api_key=${token}`
}

export function buildJellyfinHlsUrl(
  jellyfinUrl: string,
  itemId: string,
  token: string
): string {
  return `${jellyfinUrl}/Videos/${itemId}/master.m3u8?api_key=${token}`
}

export function buildJellyfinImageUrl(
  jellyfinUrl: string,
  itemId: string,
  token: string,
  imageType = "Primary"
): string {
  return `${jellyfinUrl}/Items/${itemId}/Images/${imageType}?api_key=${token}`
}
