# UmrFlix Design Reference

This document defines the visual language of UmrFlix so future UI work stays cohesive. It is based on the implementation in [src/app/globals.css](src/app/globals.css), [src/app/layout.tsx](src/app/layout.tsx), [src/components/Navbar.tsx](src/components/Navbar.tsx), [src/components/LayoutShell.tsx](src/components/LayoutShell.tsx), [src/components/HeroBillboard.tsx](src/components/HeroBillboard.tsx), [src/components/MovieRow.tsx](src/components/MovieRow.tsx), [src/components/MovieCard.tsx](src/components/MovieCard.tsx), [src/components/SearchBar.tsx](src/components/SearchBar.tsx), and [src/components/ui/button.tsx](src/components/ui/button.tsx).

## Design DNA

UmrFlix is a dark streaming interface with a Netflix-adjacent structure and a slightly sharper, more editorial finish. The mood is cinematic, dense, and utility-first: large media imagery, compact controls, strong hierarchy, and restrained decoration. The interface should feel like one system, not a collection of unrelated screens.

When adding or changing UI, favor:

- high contrast dark surfaces over light or saturated themes
- square or near-square geometry over rounded, soft, or playful shapes
- strong visual hierarchy with bold titles and quiet supporting text
- motion that reinforces focus, not motion for its own sake
- media-first layouts that let posters, backdrops, and logos carry the page

## Color System

The palette is built around black, charcoal, muted gray, and a saturated red accent.

Primary tokens observed in the app:

- Background: pure black or near-black, used as the default canvas
- Surfaces: charcoal and dark slate layers for nav, cards, dropdowns, overlays, and modals
- Foreground: white for primary text and very light gray for secondary text
- Muted text: mid-gray for labels, metadata, and de-emphasized copy
- Accent: Netflix-style red used for primary actions, focus, active states, and key highlights
- Status colors: green, amber, and blue appear only for semantic badges and availability cues

Practical rules:

- Use the accent red sparingly so it remains a strong signal
- Keep most UI neutral and let imagery, badges, and hover states provide emphasis
- Avoid bright gradients, neon palettes, and pastel UI treatments
- Preserve the dark tonal range; do not introduce high-key white panels unless a specific flow requires it

## Typography

The app uses Satoshi as the global sans font through the root layout and CSS theme. The typography is modern, geometric, and slightly condensed in feel, with a clear bias toward bold headings and compact supporting text.

Observed typographic patterns:

- headlines are often uppercase, bold, and tightly tracked
- section titles are large and heavy, especially on rows and landing surfaces
- metadata is small, muted, and compact
- buttons often use uppercase labels with wider letter spacing for emphasis
- body copy is restrained and usually shorter than conventional product copy

Typography guidance:

- Use Satoshi or the existing sans theme for all new UI
- Prefer bold weights for titles, call-to-action labels, and section headers
- Use smaller sizes and muted colors for descriptive text
- Avoid decorative display fonts, serif families, or casual rounded typefaces

## Layout And Spacing

The layout follows a centered, wide-content streaming pattern with a fixed top nav and full-width hero treatment.

Structural traits:

- top navigation is fixed and spans the full width
- main content begins below the nav with a consistent top offset
- content blocks are centered in a wide container, typically maxing out at 1600px
- the hero billboard is full-bleed and intentionally large
- rows often break out horizontally and use negative overlap to pull content upward into the hero area
- footers and lower sections remain simple and informational

Spacing rules:

- use generous vertical spacing between major content groups
- keep internal padding tight inside controls, cards, and dropdowns
- rely on alignment, width, and contrast more than ornamentation
- do not introduce heavy border radii or large empty white space unless it serves a deliberate reset

## Surfaces, Borders, And Shape

The system is intentionally sharp and rectangular.

Observed surface treatment:

- cards and buttons use `rounded-none` or near-zero radius
- borders are thin and visible, especially on nav, cards, dropdowns, inputs, and overlays
- shadows are used to lift panels, but not to create softness
- overlay panels and dropdowns are dark, opaque, and precise

Shape guidance:

- keep corners square unless a component already has a different established convention
- use 1px borders to separate layers instead of heavy shadows
- avoid pill shapes, soft blur-heavy glass, or rounded modern SaaS styling

## Navigation And Chrome

The global chrome is functional and media-platform-oriented.

Navigation characteristics:

- nav background is a dark charcoal strip with a bottom border
- active states are shown with darker surface fills and white text
- hover states shift to slightly different dark surfaces rather than bright highlights
- icons are compact and geometric
- dropdowns and drawers are dense, bordered, and aligned to the nav grid

If building new chrome:

- match the existing fixed-header behavior and dark nav tone
- keep interactive areas crisp and rectangular
- preserve the split between navigation, search, account, and utility actions

## Media Presentation

UmrFlix is driven by media imagery. Posters, backdrops, and logos are the dominant visual content.

Rules for media surfaces:

- hero modules use cinematic backdrops with large gradients and strong vignette treatment
- cards show poster art first, then reveal richer details on hover
- overlays are dark, translucent, and text-forward
- logos are used when available; fallback titles should still feel bold and cinematic

Design expectation:

- let content imagery do the visual work
- do not wrap media in playful frames or highly decorative containers
- avoid forcing uniform cards to feel like generic dashboard widgets

## Motion And Interaction

Motion in the app is subtle, purposeful, and mostly directional.

Observed motion patterns:

- hero backdrops swipe horizontally with eased transitions
- hero text slides in from the direction of change
- skeletons use a shimmer loading state
- dropdowns and overlays fade and slide in quickly
- hover states rely on color shifts, slight scale, and opacity changes

Motion rules:

- keep transitions quick and confident
- use motion to indicate navigation, selection, and hierarchy changes
- avoid bouncy, elastic, or playful easing
- do not introduce complex choreography unless it is already consistent with the existing cinematic treatment

## Components And Controls

Reusable controls should inherit the system rather than inventing a new one.

Component rules observed in the repo:

- primary buttons are red, square, and bold
- secondary buttons are dark, bordered, and subdued
- cards are dark panels with thin borders and no rounding
- search inputs are compact, dark, and border-driven
- hover overlays reveal more detail instead of changing the card shape

For new components:

- prefer dark bordered variants first
- use the accent color only for primary actions or semantic highlights
- keep iconography small, crisp, and monochrome or accent-tinted
- avoid inventing a different component language for one-off screens

## Content Tone

The voice of the interface is concise and functional. Labels are brief. Descriptions are short. Section titles are assertive.

Best practice:

- write like a catalog and playback system, not a marketing site
- use direct labels such as Browse, Watch, Add, Request, Library, and Search
- keep helper text short and informative
- avoid friendly fluff or verbose onboarding copy unless the feature explicitly needs it

## Implementation Defaults

When a design choice is ambiguous, default to the established system:

1. Black or charcoal background
2. White or muted-gray text
3. Satoshi type
4. Square, bordered controls
5. Red accent for primary actions
6. Large cinematic imagery over decorative UI
7. Tight, high-contrast hover and focus states

## Do Not Drift

Avoid these patterns unless the project is intentionally changing direction:

- rounded, soft, or bubbly UI
- purple, pastel, or neon-heavy palettes
- light-mode-heavy pages that break the dark system
- generic SaaS card grids with big radii and diffused shadows
- ornate gradients unrelated to media content
- mixed typography systems that swap in different fonts by page
- motion that feels playful, springy, or excessive

## Source Anchors

The strongest references for this design language are:

- [src/app/globals.css](src/app/globals.css) for the color tokens, font, scrollbar styling, and animation primitives
- [src/app/layout.tsx](src/app/layout.tsx) for global font loading and app shell structure
- [src/components/Navbar.tsx](src/components/Navbar.tsx) for chrome, nav interaction, dropdown density, and hover states
- [src/components/HeroBillboard.tsx](src/components/HeroBillboard.tsx) for hero composition, gradients, motion, and CTA style
- [src/components/MovieRow.tsx](src/components/MovieRow.tsx) and [src/components/MovieCard.tsx](src/components/MovieCard.tsx) for row rhythm, card geometry, hover overlays, and badge language
- [src/components/SearchBar.tsx](src/components/SearchBar.tsx) for input styling and dark autocomplete treatment
- [src/components/ui/button.tsx](src/components/ui/button.tsx) and [src/components/ui/card.tsx](src/components/ui/card.tsx) for shared component shape rules

If a new screen or component does not fit these anchors, it should be adjusted until it does.