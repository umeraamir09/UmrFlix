import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { maskUrl } from "../url-utils"

describe("URL Utilities Security & Token Masking", () => {
  it("masks api_key in standard absolute URLs", () => {
    const url = "https://jellyfin.example.com/Videos/123/stream.m3u8?api_key=secret_token_12345"
    assert.strictEqual(maskUrl(url), "https://jellyfin.example.com/Videos/123/stream.m3u8?api_key=***")
  })

  it("masks X-Emby-Token, token, and apikey parameters", () => {
    const url1 = "https://example.com/Items/abc?X-Emby-Token=sensitive123&width=320"
    assert.strictEqual(maskUrl(url1), "https://example.com/Items/abc?X-Emby-Token=***&width=320")

    const url2 = "https://example.com/Items/abc?token=my_secret_token"
    assert.strictEqual(maskUrl(url2), "https://example.com/Items/abc?token=***")

    const url3 = "https://example.com/Items/abc?apikey=legacy_api_key"
    assert.strictEqual(maskUrl(url3), "https://example.com/Items/abc?apikey=***")
  })

  it("masks accessToken and access_token parameters", () => {
    const url1 = "https://example.com/auth?accessToken=xyz987"
    assert.strictEqual(maskUrl(url1), "https://example.com/auth?accessToken=***")

    const url2 = "https://example.com/auth?access_token=xyz987"
    assert.strictEqual(maskUrl(url2), "https://example.com/auth?access_token=***")
  })

  it("masks sensitive params in relative URLs", () => {
    const rel = "/api/jellyfin/proxy/stream.m3u8?api_key=token123&MediaSourceId=ms1"
    assert.strictEqual(maskUrl(rel), "/api/jellyfin/proxy/stream.m3u8?api_key=***&MediaSourceId=ms1")
  })

  it("masks multiple sensitive params in a single URL", () => {
    const url = "https://example.com/api?api_key=key1&token=key2&foo=bar"
    const masked = maskUrl(url)
    assert.strictEqual(masked.includes("key1"), false)
    assert.strictEqual(masked.includes("key2"), false)
    assert.strictEqual(masked.includes("foo=bar"), true)
  })

  it("masks tokens in log message fragments", () => {
    const msg = "Failed request to /proxy?token=verysecret123 at line 45"
    assert.strictEqual(maskUrl(msg), "Failed request to /proxy?token=*** at line 45")
  })

  it("handles empty or safe URLs without alteration", () => {
    assert.strictEqual(maskUrl(""), "")
    assert.strictEqual(maskUrl("https://example.com/safe/path?page=1&limit=20"), "https://example.com/safe/path?page=1&limit=20")
  })
})
