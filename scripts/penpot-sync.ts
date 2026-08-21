import fs from "fs"
import path from "path"

const MANIFEST_PATH = path.join(process.cwd(), "e2e/visual/penpot-manifest.json")
const BASELINES_DIR = path.join(process.cwd(), "e2e/visual/baselines")

interface ManifestTarget {
  id: string
  name: string
  boardId: string
  baselineFile: string
  viewport: { width: number; height: number }
}

async function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`Manifest file not found: ${MANIFEST_PATH}`)
    process.exit(1)
  }

  fs.mkdirSync(BASELINES_DIR, { recursive: true })

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"))
  console.log(`\n🎨 Penpot Baseline Synchronizer`)
  console.log(`   Project ID: ${manifest.penpotProjectId}`)
  console.log(`   Total Targets: ${manifest.targets.length}`)
  console.log(`===============================================================\n`)

  for (const target of manifest.targets as ManifestTarget[]) {
    const baselinePath = path.join(BASELINES_DIR, target.baselineFile)
    const exists = fs.existsSync(baselinePath)
    console.log(`📌 ${target.name} [${target.id}]`)
    console.log(`   - Board ID: ${target.boardId}`)
    console.log(`   - Baseline File: ${target.baselineFile} (${exists ? "✅ Present" : "⚠️ Missing"})`)
  }

  console.log(`\nTip: To update live baseline renders from your current UI, run:`)
  console.log(`     npm run penpot:verify -- --all --update-baselines\n`)
}

main().catch(console.error)
