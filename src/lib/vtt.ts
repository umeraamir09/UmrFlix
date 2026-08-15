/** Minimal WebVTT / SRT / ASS parser for the custom subtitle overlay. */

export type SubtitleAlignment =
  | "top-left"
  | "top-center"
  | "top-right"
  | "mid-left"
  | "mid-center"
  | "mid-right"
  | "bot-left"
  | "bot-center"
  | "bot-right"

export type SubtitlePosition = {
  xPct?: number // 0..100 (%)
  yPct?: number // 0..100 (%)
  alignment: SubtitleAlignment
}

export type VttCue = {
  id: string
  start: number // seconds
  end: number // seconds
  text: string // sanitized HTML markup (b/i/u/s/em/strong/font/span)
  position?: SubtitlePosition
}

function parseTimestamp(raw: string): number {
  // Parses "00:00:05.000", "00:05.000", or SRT style "00:00:05,000"
  const cleaned = raw.trim().replace(",", ".")
  const parts = cleaned.split(":")
  let seconds = 0
  for (const part of parts) {
    seconds = seconds * 60 + parseFloat(part)
  }
  return Number.isFinite(seconds) ? seconds : 0
}

function parseAlignmentTag(tag: string): SubtitleAlignment | null {
  // ASS \an1..\an9 (numpad alignment)
  const anMatch = tag.match(/\\an([1-9])/i)
  if (anMatch) {
    const val = parseInt(anMatch[1], 10)
    switch (val) {
      case 7:
        return "top-left"
      case 8:
        return "top-center"
      case 9:
        return "top-right"
      case 4:
        return "mid-left"
      case 5:
        return "mid-center"
      case 6:
        return "mid-right"
      case 1:
        return "bot-left"
      case 2:
        return "bot-center"
      case 3:
        return "bot-right"
    }
  }

  // Legacy SSA \a1..\a11
  const aMatch = tag.match(/\\a([1-9]|10|11)/i)
  if (aMatch) {
    const val = parseInt(aMatch[1], 10)
    switch (val) {
      case 5:
        return "top-left"
      case 6:
        return "top-center"
      case 7:
        return "top-right"
      case 9:
        return "mid-left"
      case 10:
        return "mid-center"
      case 11:
        return "mid-right"
      case 1:
        return "bot-left"
      case 2:
        return "bot-center"
      case 3:
        return "bot-right"
    }
  }
  return null
}

function extractCuePosition(
  rawText: string,
  timingSettings = "",
  playResX = 1920,
  playResY = 1080,
): { position?: SubtitlePosition } {
  let alignment: SubtitleAlignment | null = null
  let xPct: number | undefined
  let yPct: number | undefined

  // 1. Check ASS override tags inside {...}
  const braceMatches = rawText.match(/\{[^}]*\}/g)
  if (braceMatches) {
    for (const brace of braceMatches) {
      if (!alignment) {
        alignment = parseAlignmentTag(brace)
      }
      // Check \pos(x,y)
      const posMatch = brace.match(/\\pos\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/i)
      if (posMatch) {
        const x = parseFloat(posMatch[1])
        const y = parseFloat(posMatch[2])
        if (Number.isFinite(x) && Number.isFinite(y)) {
          xPct = Math.min(100, Math.max(0, (x / playResX) * 100))
          yPct = Math.min(100, Math.max(0, (y / playResY) * 100))
        }
      }
    }
  }

  // 2. Check WebVTT timing line settings (e.g. line:10% position:50% align:center)
  if (timingSettings) {
    const lineMatch = timingSettings.match(/line:(-?\d+(?:\.\d+)?%?)/i)
    if (lineMatch) {
      const val = lineMatch[1]
      if (val.endsWith("%")) {
        yPct = Math.min(100, Math.max(0, parseFloat(val)))
      }
    }
    const posMatch = timingSettings.match(/position:(-?\d+(?:\.\d+)?%?)/i)
    if (posMatch) {
      const val = posMatch[1]
      if (val.endsWith("%")) {
        xPct = Math.min(100, Math.max(0, parseFloat(val)))
      }
    }
    if (!alignment) {
      const alignMatch = timingSettings.match(/align:(start|left|center|right|end)/i)
      if (alignMatch) {
        const a = alignMatch[1].toLowerCase()
        if (a === "left" || a === "start") alignment = "top-left"
        else if (a === "right" || a === "end") alignment = "top-right"
        else if (a === "center") alignment = "top-center"
      }
    }
  }

  if (alignment && (alignment.startsWith("top-") || alignment.startsWith("mid-"))) {
    if (xPct === undefined) xPct = 50
    if (yPct === undefined) {
      if (alignment.startsWith("top-")) yPct = 5
      if (alignment.startsWith("mid-")) yPct = 50
    }
  }

  if (xPct !== undefined || yPct !== undefined || (alignment && alignment !== "bot-center")) {
    return {
      position: {
        xPct,
        yPct,
        alignment: alignment ?? (xPct !== undefined && yPct !== undefined ? "mid-center" : "bot-center"),
      },
    }
  }

  return {}
}

const ALLOWED_TAGS = new Set(["b", "i", "u", "s", "em", "strong", "font", "span"])

// Validate safe color value (hex #rgb, #rrggbb, #rrggbbaa, rgb/rgba, or standard color name)
const SAFE_COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\)|[a-zA-Z]+)$/

// Inline style allowlist. Every value is anchored and restricted to inert
// characters: no quotes, semicolons, backslashes or parens (outside the fixed
// rgba() shape), so emitted declarations can never break out of the attribute
// or invoke CSS tricks — unquoted font families only, no url()/expression.
const STYLE_FONT_SIZE_RE = /^\d+(?:\.\d+)?(?:px|em|rem|%)$/
const STYLE_FONT_STYLE_RE = /^(?:normal|italic|oblique)$/i
const STYLE_FONT_WEIGHT_RE = /^(?:normal|bold|[1-9]00)$/i
const STYLE_FONT_FAMILY_RE = /^[A-Za-z0-9 -]+$/
const STYLE_TEXT_SHADOW_RE =
  /^\d+(?:\.\d+)?(?:px|em)?\s+\d+(?:\.\d+)?(?:px|em)?(?:\s+\d+(?:\.\d+)?(?:px|em)?)?\s+(?:#[0-9a-fA-F]{3,8}|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\))$/

/** Rebuild a span style attribute from a per-declaration whitelist. */
function sanitizeStyleAttribute(rawAttrs: string): string {
  const styleMatch = rawAttrs.match(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
  if (!styleMatch) return ""
  const styleVal = (styleMatch[1] ?? styleMatch[2] ?? styleMatch[3] ?? "").trim()
  if (!styleVal) return ""

  const safeDeclarations: string[] = []
  for (const rawDeclaration of styleVal.split(";")) {
    const declaration = rawDeclaration.trim()
    const colonIdx = declaration.indexOf(":")
    if (colonIdx === -1) continue
    const prop = declaration.slice(0, colonIdx).trim().toLowerCase()
    const value = declaration.slice(colonIdx + 1).trim()
    if (!value) continue

    let valid = false
    switch (prop) {
      case "color":
      case "background-color":
        valid = SAFE_COLOR_RE.test(value)
        break
      case "font-size":
        valid = STYLE_FONT_SIZE_RE.test(value)
        break
      case "font-style":
        valid = STYLE_FONT_STYLE_RE.test(value)
        break
      case "font-weight":
        valid = STYLE_FONT_WEIGHT_RE.test(value)
        break
      case "font-family":
        valid = STYLE_FONT_FAMILY_RE.test(value)
        break
      case "text-shadow":
        valid = STYLE_TEXT_SHADOW_RE.test(value)
        break
      default:
        valid = false
    }

    if (valid) safeDeclarations.push(`${prop}: ${value}`)
  }

  if (safeDeclarations.length === 0) return ""
  return ` style="${safeDeclarations.join("; ")}"`
}

function sanitizeAttributes(tagName: string, rawAttrs: string): string {
  if (tagName === "font") {
    // Only extract color attribute: color="value" or color='value' or color=value
    const colorMatch = rawAttrs.match(/\bcolor\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
    if (colorMatch) {
      const colorVal = (colorMatch[1] ?? colorMatch[2] ?? colorMatch[3] ?? "").trim()
      if (SAFE_COLOR_RE.test(colorVal)) {
        return ` color="${colorVal}"`
      }
    }
    return ""
  }

  if (tagName === "span") {
    const classMatch = rawAttrs.match(/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
    const classFragment = classMatch
      ? (/^[a-zA-Z0-9_-]+$/.test((classMatch[1] ?? classMatch[2] ?? classMatch[3] ?? "").trim())
          ? ` class="${(classMatch[1] ?? classMatch[2] ?? classMatch[3] ?? "").trim()}"`
          : "")
      : ""
    return `${sanitizeStyleAttribute(rawAttrs)}${classFragment}`
  }

  // No attributes allowed for b, i, u, s, em, strong
  return ""
}

/** Automatically close any unclosed allowed HTML tags to prevent style leaks */
function autoCloseTags(html: string): string {
  const openTags: string[] = []
  const tagRegex = /<\/?([a-z0-9]+)(?:\s+[^>]*)?>/gi
  let match: RegExpExecArray | null

  while ((match = tagRegex.exec(html)) !== null) {
    const fullTag = match[0]
    const tagName = match[1].toLowerCase()
    if (ALLOWED_TAGS.has(tagName)) {
      if (fullTag.startsWith("</")) {
        const idx = openTags.lastIndexOf(tagName)
        if (idx !== -1) {
          openTags.splice(idx, 1)
        }
      } else if (!fullTag.endsWith("/>")) {
        openTags.push(tagName)
      }
    }
  }

  let result = html
  for (let i = openTags.length - 1; i >= 0; i--) {
    result += `</${openTags[i]}>`
  }
  return result
}

const FANSUB_WARNING_PATTERNS = [
  /does not support the subtitle format/i,
  /using a recent version of mpv/i,
  /subtitles will likely not display as originally intended/i,
  /make sure you(?:'re| are) using.*mpv/i,
  /contact us on (?:our )?discord/i,
  /mpv\.io/i,
  /unsupported subtitle format/i,
]

/**
 * Sanitize and format cue text:
 * 1. Replace ASS \N and \n line break codes with newlines
 * 2. Strip ASS/SSA override tags like {\an8}, {\b1}, {\pos(x,y)}
 * 3. Convert <br> / <br/> tags to newlines (\n)
 * 4. Strip WebVTT voice/class/ruby/rt/lang/timestamp tags like <v Speaker>, <c.yellow>
 * 5. Strictly sanitize HTML tags & attributes (whitelisting b, i, u, s, em, strong, font, span)
 * 6. Filter out ASS vector drawing commands (e.g. "m 0 0 l 100 100...")
 * 7. Filter out MPV / player format warning messages embedded in ASS tracks
 * 8. Auto-close open tags
 */
export function sanitizeCueText(text: string): string {
  if (!text) return ""

  let cleaned = text
    // Convert ASS \N and \n line break codes to newlines
    .replace(/\\N/g, "\n")
    .replace(/\\n/g, "\n")
    // Strip ASS / SSA override tags inside {...}
    .replace(/\{[^}]*\}/g, "")
    // Strip script, style, iframe, textarea blocks including inner content
    .replace(/<(script|style|iframe|textarea|title|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    // Convert <br> / <br/> tags to newlines
    .replace(/<br\s*\/?>/gi, "\n")
    // Normalize CRLF
    .replace(/\r\n?/g, "\n")
    // Strip WebVTT timestamps <00:00:00.000>
    .replace(/<(\d{2}:)?\d{2}:\d{2}[.,]\d{3}>/g, "")
    // Strip WebVTT voice <v ...>, class <c...>, lang <lang ...>, ruby/rt tags
    .replace(/<\/?(v|c|lang|ruby|rt)(\s+[^>]*)?>/gi, "")

  // Filter out ASS vector drawing commands (e.g. "m 0 0 l 100 100...")
  if (/^[mslbcq]\s+[\d\s-]/i.test(cleaned.trim())) return ""

  // Filter out fansub warning messages embedded in ASS tracks for non-MPV players
  if (FANSUB_WARNING_PATTERNS.some((pattern) => pattern.test(cleaned))) return ""

  // Strict whitelist-based HTML sanitization for tags & attributes
  // Strip dangerous tag structures (script, iframe, object, embed, style, img, svg, etc.)
  const sanitizePass = (input: string): string => {
    return input.replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/gi, (_match, tagNameRaw: string, rawAttrs: string) => {
      const tagName = tagNameRaw.toLowerCase()
      const isClosing = _match.startsWith("</")

      if (!ALLOWED_TAGS.has(tagName)) {
        return "" // Strip non-whitelisted tags entirely
      }

      if (isClosing) {
        return `</${tagName}>`
      }

      const safeAttrs = sanitizeAttributes(tagName, rawAttrs)
      return `<${tagName}${safeAttrs}>`
    })
  }

  // Run two passes to handle any nested tag tricks (e.g., <scr<script>ipt>)
  cleaned = sanitizePass(cleaned)
  cleaned = sanitizePass(cleaned)

  // Auto-close any unclosed formatting tags
  cleaned = autoCloseTags(cleaned)

  // Trim each line while preserving clean internal line breaks
  const lines = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter((line, idx, arr) => line.length > 0 || (idx > 0 && idx < arr.length - 1))

  return lines.join("\n").trim()
}

export function parseVtt(vtt: string): VttCue[] {
  if (!vtt) return []
  const normalized = vtt.replace(/\r\n?/g, "\n")
  const cues: VttCue[] = []

  let playResX = 1920
  let playResY = 1080

  const resXMatch = normalized.match(/PlayResX:\s*(\d+)/i)
  if (resXMatch) playResX = parseInt(resXMatch[1], 10) || 1920

  const resYMatch = normalized.match(/PlayResY:\s*(\d+)/i)
  if (resYMatch) playResY = parseInt(resYMatch[1], 10) || 1080

  // 1. Parse raw ASS / SSA format (contains Dialogue: lines)
  if (normalized.includes("Dialogue:")) {
    const lines = normalized.split("\n")
    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line.startsWith("Dialogue:")) continue
      const prefixIdx = line.indexOf(":")
      if (prefixIdx === -1) continue
      const content = line.substring(prefixIdx + 1).trim()

      // Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
      // Split by comma up to 9 times so text (part 10) retains internal commas
      const parts: string[] = []
      let temp = content
      for (let i = 0; i < 9; i++) {
        const commaIdx = temp.indexOf(",")
        if (commaIdx === -1) break
        parts.push(temp.substring(0, commaIdx).trim())
        temp = temp.substring(commaIdx + 1)
      }
      parts.push(temp.trim())

      if (parts.length < 10) continue

      const layer = parseInt(parts[0], 10)
      const style = parts[3] || ""
      const startRaw = parts[1]
      const endRaw = parts[2]
      const rawText = parts[9]

      // Ignore negative layers (overlaid warning banners). Style-name
      // filtering is limited to known-signaling styles — "offscreen" is
      // deliberately NOT filtered: some release groups use it for off-screen
      // speakers' actual dialogue, so removing it wholesale would drop lines.
      if (Number.isFinite(layer) && layer < 0) continue
      if (/^(warning|notice|banner-warning|mpv)$/i.test(style.trim())) continue

      const start = parseTimestamp(startRaw)
      const end = parseTimestamp(endRaw)

      const { position } = extractCuePosition(rawText, "", playResX, playResY)
      const text = sanitizeCueText(rawText)

      if (text && end > start) {
        cues.push({ id: `ass-${cues.length}`, start, end, text, position })
      }
    }
    return cues.sort((a, b) => a.start - b.start)
  }

  // 2. Otherwise parse WebVTT / SRT format (contains "-->" timing lines)
  const blocks = normalized.split(/\n\n+/)
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean)
    if (lines.length === 0) continue

    // Find the timing line "start --> end [settings]"
    const timingIndex = lines.findIndex((l) => l.includes("-->"))
    if (timingIndex === -1) continue

    const id = timingIndex > 0 ? lines[0] : ""
    const timingLine = lines[timingIndex]
    const [startRaw, restRaw] = timingLine.split("-->")
    if (!startRaw || !restRaw) continue

    const restParts = restRaw.trim().split(/\s+/)
    const endRaw = restParts[0]
    const timingSettings = restParts.slice(1).join(" ")

    const start = parseTimestamp(startRaw)
    const end = parseTimestamp(endRaw)

    const rawText = lines.slice(timingIndex + 1).join("\n")
    const { position } = extractCuePosition(rawText, timingSettings, playResX, playResY)
    const text = sanitizeCueText(rawText)

    if (text && end > start) {
      cues.push({ id, start, end, text, position })
    }
  }

  return cues.sort((a, b) => a.start - b.start)
}

/**
 * Get all cues active at a given time in seconds (handles overlapping cues).
 * Assumes `cues` are sorted ascending by `start` (parseVtt guarantees this).
 * Binary search for the rightmost cue with start <= time, then a bounded
 * backward scan collects cues still in effect: O(log n + k), k capped at
 * MAX_OVERLAP_SCAN — a 2-hour movie (~1500 cues) costs ~11 comparisons and at
 * most 32 end checks instead of 1500.
 */
const MAX_OVERLAP_SCAN = 32

export function findActiveCues(cues: VttCue[], time: number): VttCue[] {
  if (cues.length === 0) return []

  let lo = 0
  let hi = cues.length - 1
  let idx = -1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    if (cues[mid].start <= time) {
      idx = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  if (idx === -1) return []

  // Every index <= idx has start <= time by construction, so the scan only
  // needs to check `end`; the cap bounds pathological overlap chains.
  const active: VttCue[] = []
  for (let i = idx; i >= 0 && idx - i < MAX_OVERLAP_SCAN; i--) {
    if (time < cues[i].end) active.push(cues[i])
  }
  // Restore ascending (file) order for overlapping stacks
  active.reverse()
  return active
}

/** Get the first active cue at a given time (backward compatibility). */
export function findActiveCue(cues: VttCue[], time: number): VttCue | null {
  const active = findActiveCues(cues, time)
  return active.length > 0 ? active[0] : null
}
