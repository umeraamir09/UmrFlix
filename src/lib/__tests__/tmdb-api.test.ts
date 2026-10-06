import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { tmdbApiFetch } from "../tmdb-api"
import { CircuitBreaker } from "../circuit-breaker"

const originalFetch = globalThis.fetch
const originalKey = process.env.TMDB_API_KEY

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalKey === undefined) delete process.env.TMDB_API_KEY
  else process.env.TMDB_API_KEY = originalKey
})

for (const [name, key] of [["API key", "test-api-key"], ["Read Access Token", "header.payload.signature"]]) {
  test(`authenticates directly with a ${name} and caches responses`, async () => {
    process.env.TMDB_API_KEY = key
    let calls = 0
    globalThis.fetch = async (input, init) => {
      calls++
      const url = new URL(String(input))
      const headers = new Headers(init?.headers)
      assert.equal(url.origin, "https://api.themoviedb.org")
      assert.equal(url.pathname, "/3/search/movie")
      assert.equal(url.searchParams.get("query"), name)
      assert.equal(headers.has("X-Proxy-Secret"), false)
      assert.equal(url.searchParams.get("api_key"), key.includes(".") ? null : key)
      assert.equal(headers.get("Authorization"), key.includes(".") ? `Bearer ${key}` : null)
      return Response.json({ results: [] })
    }
    const path = `/3/search/movie?query=${encodeURIComponent(name)}&api_key=client-key`
    const options = { breaker: new CircuitBreaker(), headers: { Authorization: "client-token" } }
    assert.deepEqual(await (await tmdbApiFetch(path, options)).json(), { results: [] })
    assert.equal((await tmdbApiFetch(path, options)).headers.get("X-Cache"), "HIT")
    assert.equal(calls, 1)
  })
}

test("requires a configured API key", async () => {
  delete process.env.TMDB_API_KEY
  await assert.rejects(tmdbApiFetch("/3/configuration"), /TMDB_API_KEY is not set/)
})

test("rejects requests outside the TMDB API namespace before fetching", async () => {
  process.env.TMDB_API_KEY = "test-api-key"
  globalThis.fetch = async () => { throw new Error("Unexpected network request") }
  for (const path of ["https://example.com/3/movie/1", "/3/../account", "/4/account", "/3/%2e%2e/account"]) {
    await assert.rejects(tmdbApiFetch(path), /Refusing to request/)
  }
})

test("retries transient upstream failures", async () => {
  process.env.TMDB_API_KEY = "retry-key"
  let calls = 0
  globalThis.fetch = async () => ++calls === 1
    ? new Response("Unavailable", { status: 503 })
    : Response.json({ images: {} })
  const response = await tmdbApiFetch("/3/configuration", { breaker: new CircuitBreaker(), retries: 1 })
  assert.equal(response.status, 200)
  assert.equal(calls, 2)
})
