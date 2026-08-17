import { chromium, Page } from "@playwright/test"
import { spawn } from "child_process"
import fs from "fs"
import path from "path"
import { PNG } from "pngjs"
import pixelmatch from "pixelmatch"

interface ManifestTarget {
  id: string
  name: string
  boardId: string
  route: string
  selector?: string
  interaction?: string
  baselineFile: string
  viewport: { width: number; height: number }
  threshold?: number
}

interface Manifest {
  version: string
  penpotProjectId: string
  targets: ManifestTarget[]
}

const MANIFEST_PATH = path.join(process.cwd(), "e2e/visual/penpot-manifest.json")
const BASELINES_DIR = path.join(process.cwd(), "e2e/visual/baselines")
const DIFFS_DIR = path.join(process.cwd(), "e2e/visual/diffs")
const AUTH_FILE = path.join(process.cwd(), "e2e/.auth/user.json")

function parseArgs() {
  const args = process.argv.slice(2)
  let target: string | null = null
  let all = false
  let updateBaselines = false
  let baseUrl = process.env.PLAYWRIGHT_TEST_BASE_URL || "http://localhost:3000"

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--target" && args[i + 1]) {
      target = args[++i]
    } else if (args[i] === "--all") {
      all = true
    } else if (args[i] === "--update-baselines" || args[i] === "-u") {
      updateBaselines = true
    } else if (args[i] === "--url" && args[i + 1]) {
      baseUrl = args[++i]
    }
  }

  return { target, all, updateBaselines, baseUrl }
}

async function ensureServerRunning(baseUrl: string): Promise<(() => void) | null> {
  try {
    const res = await fetch(baseUrl, { signal: AbortSignal.timeout(2000) })
    if (res.status >= 200 && res.status < 500) {
      return null // Already running
    }
  } catch {
    // Not running
  }

  console.log(`🚀 Starting live Next.js server on ${baseUrl}...`)
  const isWindows = process.platform === "win32"
  const proc = spawn(isWindows ? "npm.cmd" : "npm", ["run", "dev"], {
    shell: true,
    stdio: "pipe",
    env: { ...process.env, PORT: "3000" },
  })

  // Poll until ready
  const startTime = Date.now()
  while (Date.now() - startTime < 60000) {
    try {
      const res = await fetch(baseUrl, { signal: AbortSignal.timeout(1500) })
      if (res.status >= 200 && res.status < 500) {
        console.log(`✓ Live server is ready!`)
        break
      }
    } catch {
      await new Promise((r) => setTimeout(r, 1000))
    }
  }

  return () => {
    try {
      if (isWindows && proc.pid) {
        spawn("taskkill", ["/pid", proc.pid.toString(), "/f", "/t"])
      } else {
        proc.kill()
      }
    } catch {}
  }
}

async function preparePage(page: Page, target: ManifestTarget, baseUrl: string) {
  await page.setViewportSize(target.viewport)
  
  const fullUrl = `${baseUrl.replace(/\/+$/, "")}${target.route}`
  await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: 30000 })

  // Suppress animations
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        scroll-behavior: auto !important;
      }
    `,
  })

  // Handle specific interaction triggers
  if (target.interaction === "expand-custom-url") {
    const toggle = page.getByRole("button", { name: /Custom Server Url/i })
    if (await toggle.isVisible().catch(() => false)) {
      await toggle.click()
      await page.waitForTimeout(300)
    }
  }

  await page.waitForTimeout(600)
}

function cropToCommonSize(imgA: PNG, imgB: PNG): { a: PNG; b: PNG; width: number; height: number } {
  const width = Math.min(imgA.width, imgB.width)
  const height = Math.min(imgA.height, imgB.height)

  const a = new PNG({ width, height })
  const b = new PNG({ width, height })

  PNG.bitblt(imgA, a, 0, 0, width, height, 0, 0)
  PNG.bitblt(imgB, b, 0, 0, width, height, 0, 0)

  return { a, b, width, height }
}

async function verifyTarget(
  page: Page,
  target: ManifestTarget,
  baseUrl: string,
  updateBaselines: boolean
) {
  console.log(`\n===============================================================`)
  console.log(`🔍 Verifying: ${target.name} [ID: ${target.id}]`)
  console.log(`   Route: ${target.route} | Viewport: ${target.viewport.width}x${target.viewport.height}`)
  console.log(`===============================================================`)

  await preparePage(page, target, baseUrl)

  const baselinePath = path.join(BASELINES_DIR, target.baselineFile)
  const actualPath = path.join(DIFFS_DIR, `${target.id}.actual.png`)
  const diffPath = path.join(DIFFS_DIR, `${target.id}.diff.png`)

  // Capture screenshot
  let actualBuffer: Buffer
  if (target.selector) {
    const element = page.locator(target.selector).first()
    if (await element.isVisible().catch(() => false)) {
      actualBuffer = await element.screenshot({ type: "png" })
    } else {
      actualBuffer = await page.screenshot({ type: "png", fullPage: false })
    }
  } else {
    actualBuffer = await page.screenshot({ type: "png", fullPage: false })
  }

  fs.writeFileSync(actualPath, actualBuffer)

  if (updateBaselines || !fs.existsSync(baselinePath)) {
    fs.writeFileSync(baselinePath, actualBuffer)
    console.log(`📸 Baseline saved/updated at: ${baselinePath}`)
    return { status: "updated", diffPercent: 0, target }
  }

  // Pixel comparison with pixelmatch
  const rawActual = PNG.sync.read(actualBuffer)
  const rawBaseline = PNG.sync.read(fs.readFileSync(baselinePath))

  const { a: imgActual, b: imgBaseline, width, height } = cropToCommonSize(rawActual, rawBaseline)

  const diff = new PNG({ width, height })
  const mismatchedPixels = pixelmatch(
    imgActual.data,
    imgBaseline.data,
    diff.data,
    width,
    height,
    { threshold: target.threshold || 0.1 }
  )

  const totalPixels = width * height
  const diffPercent = (mismatchedPixels / totalPixels) * 100

  fs.writeFileSync(diffPath, PNG.sync.write(diff))

  // Design Token Inspections
  const tokenChecks = await page.evaluate(() => {
    const body = document.body
    const computed = window.getComputedStyle(body)
    return {
      fontFamily: computed.fontFamily,
      backgroundColor: computed.backgroundColor,
      color: computed.color,
    }
  })

  console.log(`📊 Comparison Metrics:`)
  console.log(`   - Dimensions: ${width}x${height}px`)
  console.log(`   - Diff Pixels: ${mismatchedPixels.toLocaleString()} / ${totalPixels.toLocaleString()}`)
  console.log(`   - Mismatch Ratio: ${diffPercent.toFixed(2)}% (Threshold: ${(target.threshold || 0.08) * 100}%)`)
  console.log(`🎨 Computed Design Tokens:`)
  console.log(`   - Font Family: ${tokenChecks.fontFamily}`)
  console.log(`   - Body BG:     ${tokenChecks.backgroundColor}`)
  console.log(`📁 Artifacts:`)
  console.log(`   - Actual:   ${actualPath}`)
  console.log(`   - Baseline: ${baselinePath}`)
  console.log(`   - Diff:     ${diffPath}`)

  const passed = diffPercent <= (target.threshold || 0.08) * 100
  if (passed) {
    console.log(`\n✅ RESULT: PASS (Visual rendering adheres to design specifications)`)
  } else {
    console.log(`\n⚠️  RESULT: MISMATCH DETECTED (Exceeds tolerance threshold)`)
  }

  return { status: passed ? "pass" : "fail", diffPercent, target }
}

async function main() {
  const { target, all, updateBaselines, baseUrl } = parseArgs()

  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`Error: Manifest file not found at ${MANIFEST_PATH}`)
    process.exit(1)
  }

  fs.mkdirSync(BASELINES_DIR, { recursive: true })
  fs.mkdirSync(DIFFS_DIR, { recursive: true })

  const manifest: Manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"))

  let selectedTargets: ManifestTarget[] = manifest.targets
  if (!all && target) {
    selectedTargets = manifest.targets.filter((t) => t.id === target || t.id.includes(target))
    if (selectedTargets.length === 0) {
      console.error(`Target "${target}" not found in manifest. Available targets:`)
      manifest.targets.forEach((t) => console.log(` - ${t.id} (${t.name})`))
      process.exit(1)
    }
  } else if (!all && !target) {
    console.log(`No specific target specified. Defaulting to first target: ${manifest.targets[0].id}`)
    console.log(`Use 'npm run penpot:verify -- --target <name>' or 'npm run penpot:verify -- --all'`)
    selectedTargets = [manifest.targets[0]]
  }

  const cleanup = await ensureServerRunning(baseUrl)

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext(
    fs.existsSync(AUTH_FILE) ? { storageState: AUTH_FILE } : {}
  )
  const page = await context.newPage()

  // Ensure authenticated session for protected routes
  try {
    const authRes = await page.request.post(`${baseUrl.replace(/\/+$/, "")}/api/auth/test-session`)
    if (authRes.ok()) {
      fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true })
      await context.storageState({ path: AUTH_FILE })
    }
  } catch (err) {
    console.warn("Could not auto-authenticate test session:", err)
  }

  const results: Array<{ status: string; diffPercent: number; target: ManifestTarget }> = []

  try {
    for (const t of selectedTargets) {
      const res = await verifyTarget(page, t, baseUrl, updateBaselines)
      results.push(res)
    }
  } finally {
    await browser.close()
    if (cleanup) cleanup()
  }

  console.log(`\n===============================================================`)
  console.log(`🏁 Verification Summary: ${results.filter((r) => r.status === "pass" || r.status === "updated").length}/${results.length} Passed/Updated`)
  console.log(`===============================================================`)
}

main().catch((err) => {
  console.error("Verification failed with error:", err)
  process.exit(1)
})
