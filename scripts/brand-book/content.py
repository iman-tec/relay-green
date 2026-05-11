"""
Section content for the Relay Brand Book.

Each entry is a `Section` describing one section of the book. Renderers
walk this list, paginate within sections by yielding `Page` records, and
both backends produce the same number of pages in the same order.

Copy is sourced from:
  - relay-green/app/brand-guidelines/page.tsx       (10 web sections)
  - relay-green/lib/brand.ts                        (customer-facing strings)
  - relay-green/public/llms.txt                     (positioning)
  - relay-green/app/_marketing/Home.tsx             (AI tools, pricing)
  - relay-green/app/company/about/page.tsx          (architecture)
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any


# ---------------------------------------------------------------------------
# Page schema — the renderer-facing primitive.
#
# `kind` is a string tag the renderer dispatches on. Each kind has a
# documented shape in `data`. Keeping this loose (dict[str, Any]) is
# deliberate — adding a new layout means adding one branch to each
# renderer, not changing this schema.
# ---------------------------------------------------------------------------

@dataclass
class Page:
    kind: str
    data: dict[str, Any] = field(default_factory=dict)


@dataclass
class Section:
    number: str           # "01", "02", ... or "—" for cover/back
    title: str            # display title
    pages: list[Page] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Section authors — keep each as a small builder fn for readability.
# ---------------------------------------------------------------------------

def _cover() -> Section:
    return Section("—", "Cover", pages=[
        Page("cover", {
            "eyebrow": "— Brand Book · v1.0 · May 2026",
            "title_top": "The brand is the",
            "title_emph": "green dot.",
            "subtitle": "What Relay looks like, sounds like, and does not do.",
            "footer": "Relay, Inc. · San Francisco · London · Independent",
        }),
        Page("colophon", {
            "fields": [
                ("Owner",    "Brand · Relay, Inc."),
                ("Status",   "Living document"),
                ("Audience", "Design, Eng, Marketing, Sales, Partners"),
                ("Cadence",  "Reviewed quarterly"),
                ("Version",  "v1.0 · May 2026"),
                ("Contact",  "brand@relay.green"),
            ],
            "note": (
                "This book is the canonical reference for the Relay visual and "
                "verbal identity. It supersedes any earlier deck, doc, or design "
                "file. When in doubt, this document wins. When this document is "
                "wrong, fix it — and tell brand@relay.green."
            ),
        }),
    ])


def _foreword() -> Section:
    return Section("—", "How to use this book", pages=[
        Page("foreword", {
            "eyebrow": "— Foreword",
            "title": "How to use this book.",
            "body_paragraphs": [
                "Every brand book promises consistency. Most deliver constraint. "
                "This one is meant to be useful — opened on a Tuesday afternoon "
                "by an engineer writing a tooltip, a designer naming a Figma "
                "frame, a salesperson cutting a slide for a 4pm call.",
                "Read the Essence (section 01) once. Everything else follows from "
                "it. If a design, a line of copy, or a feature decision contradicts "
                "the essence, it's wrong — even if it looks great.",
                "The mark, the color, the type, and the voice are not five "
                "separate systems. They are one system, expressed in five places. "
                "The dot is the through-line.",
                "When you find a gap — a surface this book doesn't cover — "
                "extend the principles, ship the work, and propose the addition. "
                "This is a living document. Reviewed quarterly. Owned by Brand.",
            ],
        }),
    ])


def _toc(toc_rows: list[tuple[str, str, int]]) -> Section:
    """toc_rows: (number, title, page_number) tuples. Built dynamically."""
    return Section("—", "Table of contents", pages=[
        Page("toc", {"rows": toc_rows}),
    ])


def _essence() -> Section:
    return Section("01", "Essence", pages=[
        Page("section_divider", {
            "number": "01", "title": "Essence",
            "lede": (
                "Read this once. Everything else in this document follows from it. "
                "If a design, a line of copy, or a feature decision contradicts "
                "the essence, it's wrong — even if it looks great."
            ),
        }),
        Page("three_tiles", {
            "title_top": "What Relay",
            "title_emph": "actually is.",
            "tiles": [
                {"label": "— Promise",     "headline": "Build with AI. Ship with engineers.",
                 "body": "One tap. One senior engineer. One promise — a real person, by name and face, joins in seconds and stays through launch."},
                {"label": "— Position",    "headline": "Software-as-a-Service has a Service in it again.",
                 "body": "Relay restores the human half of SaaS. Not a chatbot, not a forum, not a marketplace. A senior engineer who stays from build to shipped to running."},
                {"label": "— Personality", "headline": "Calm. Plain-spoken. Quietly confident.",
                 "body": "We sound like a senior engineer at a whiteboard, not a tech company at a launch event. No exclamation marks. No “revolutionize.” No emoji."},
            ],
        }),
        Page("dark_quote", {
            "label": "— The one-line test",
            "quote_top": "Would a senior engineer say this",
            "quote_emph": "out loud,",
            "quote_bottom": "with a straight face, to another engineer?",
            "footnote": "If yes, ship it. If not, rewrite it. This applies to headlines, button labels, error messages, sales decks — everything.",
        }),
        Page("two_tiles", {
            "title": "The four pillars beneath the promise.",
            "tiles": [
                {"label": "— On demand",    "headline": "A press, not a queue.",
                 "body": "Relay is summoned, not requested. The user presses once and is in a session in seconds. There is no ticket, no triage, no callback."},
                {"label": "— Same engineer", "headline": "One person, three legs.",
                 "body": "The engineer who joins your build is the engineer who launches you and the engineer who keeps you running. Continuity is the product."},
                {"label": "— On the record", "headline": "Sessions are recorded with consent.",
                 "body": "Every Relay session is a Zoom call, recorded with the builder's consent and retained for replay. Trust is built in the open."},
                {"label": "— Independent",   "headline": "We answer to the work, not a parent.",
                 "body": "Relay is independently operated and accountable to its builders. The brand carries no investor logos and no parent-company crest."},
            ],
        }),
    ])


def _story() -> Section:
    return Section("02", "Story", pages=[
        Page("section_divider", {
            "number": "02", "title": "Story",
            "lede": (
                "Why Relay exists, told the way an engineer would tell it on a "
                "Sunday walk. No origin myth, no founder hagiography. Just the "
                "shape of the problem and the shape of the answer."
            ),
        }),
        Page("long_form", {
            "eyebrow": "— The irreducibly human moment",
            "title_top": "AI made software cheaper.",
            "title_emph": "It made humans more necessary, not less.",
            "paragraphs": [
                "Software is following the path coal once did: when a thing gets "
                "cheaper, we use a lot more of it. AI dev tools were supposed to "
                "reduce the demand for engineers. Instead they multiplied "
                "builders by an order of magnitude — and every one of them, "
                "sooner or later, gets stuck.",
                "Stuck is not a bug. Stuck is the moment where AI's automation "
                "ends and a human's judgement begins. The schema doesn't quite "
                "match. The error message doesn't decode. The spec is right but "
                "the implementation is wrong in a way the model can't see. "
                "These moments are irreducibly human.",
                "Relay is the press for those moments. One button. One senior "
                "engineer. One relationship that stays from the first stuck "
                "moment through launch and into production. The brand is the "
                "green dot — the live signal that a human is here and ready.",
            ],
        }),
    ])


def _mark() -> Section:
    return Section("03", "Mark", pages=[
        Page("section_divider", {
            "number": "03", "title": "The mark",
            "lede": (
                "The mark is a word and a dot. RELAY set in uppercase sans, "
                "tracked open, with a single perfect circle in Relay Green "
                "sitting one space after. The word is the company. The dot is "
                "the press. Together they are the entire system."
            ),
        }),
        Page("lockup_hero", {
            "label": "— Primary lockup",
            "wordmark": "RELAY",
            "caption": "Wordmark + green dot. The full system.",
        }),
        Page("mark_construction", {
            "label": "— Construction grid",
            "title": "How the mark is built.",
            "specs": [
                ("Wordmark", "RELAY · uppercase · letter-spacing 0.04em"),
                ("Weight",   "Instrument Sans 500 (Medium)"),
                ("Dot diameter", "0.72× cap-height of RELAY"),
                ("Dot offset",   "0.22em from final Y, baseline-aligned"),
                ("Dot color",    "Moss · #4F6B3A (or cream on a green field)"),
            ],
        }),
        Page("mark_clear_space", {
            "label": "— Clear space & minimum sizes",
            "title": "Give it room to breathe.",
            "rules": [
                "Clear space on every side equals one dot diameter. Nothing — typography, imagery, edge of canvas — encroaches.",
                "Minimum digital size: 24 px cap-height for RELAY. Below this the dot is illegible.",
                "Minimum print size: 12 mm cap-height for RELAY at 300 DPI.",
                "On hostile backgrounds (busy photography), use a cream-fill safe panel with the same clear space rules.",
            ],
        }),
        Page("mark_lockups", {
            "label": "— Variants",
            "title": "Four lockups. Use the right one.",
            "cells": [
                {"variant": "primary", "label": "Primary · cream",   "note": "Default. Use everywhere with cream/paper backgrounds."},
                {"variant": "reverse", "label": "Reverse · ink",     "note": "On dark/ink sections. Wordmark cream, dot stays moss."},
                {"variant": "green",   "label": "Green block",       "note": "Sparingly — billboards, swag. Wordmark cream, dot cream."},
                {"variant": "dot",     "label": "Dot alone",         "note": "Favicon, app icon, status bug, sticker."},
            ],
        }),
        Page("mark_mono", {
            "label": "— Monochrome",
            "title": "When color is unavailable.",
            "rules": [
                "Single-color black: the entire mark — wordmark and dot — in 100% K. Use only for fax-grade print, embossing, or single-channel manufacturing.",
                "Single-color cream-on-ink: wordmark cream, dot cream. Acceptable on green or ink fields.",
                "Never use a recolored dot in monochrome. The dot is moss or cream — nothing else.",
                "Never use a stroke-only outline mark. Relay does not have an outline lockup.",
            ],
        }),
        Page("mark_dos_donts", {
            "label": "— Do's & don'ts",
            "title": "If in doubt, don't.",
            "dos": [
                "Use the wordmark with a single dot, always at the baseline-period position.",
                "Maintain clear space equal to the dot diameter on all sides.",
                "Animate the dot with a subtle pulse only when it represents an active “press for a human” moment.",
                "Use the dot alone (no word) for app icons, favicons, status indicators, and merchandise.",
            ],
            "donts": [
                "Don't add a tagline lockup. The mark stands alone.",
                "Don't enclose the mark in a shape, badge, or container.",
                "Don't recolor the dot to anything other than Relay Green (or cream, on a green field).",
                "Don't animate the dot decoratively — it pulses to mean something, never to look interesting.",
                "Don't spell it “relay.green” in the mark. The URL is the URL; the brand is “Relay.”",
            ],
        }),
    ])


def _dot() -> Section:
    return Section("04", "The dot", pages=[
        Page("section_divider", {
            "number": "04", "title": "The dot",
            "lede": (
                "The green dot is the most important pixel Relay owns. It is the "
                "logo, the CTA, the status bug, the favicon, and the brand. Every "
                "rule in this section exists because the dot must mean something."
            ),
        }),
        Page("dot_anatomy", {
            "title": "Anatomy of a press.",
            "states": [
                {"name": "Rest",       "fill": "moss",    "ring": False, "note": "Default. Solid moss, perfectly circular, no stroke."},
                {"name": "Pulse",      "fill": "moss",    "ring": True,  "note": "An engineer is available. 2s ease-in-out, ±20% scale, ring opacity 0.25 → 0."},
                {"name": "Engaged",    "fill": "moss",    "ring": False, "note": "Human is in the session. Static. The promise has been kept."},
                {"name": "Cream-on-ink","fill": "cream",  "ring": False, "note": "On dark surfaces only. Used on green block lockups and reverse marks."},
            ],
            "footer": "The dot is never an outline, never a gradient, never a glow. It is a circle.",
        }),
    ])


def _color() -> Section:
    return Section("05", "Color", pages=[
        Page("section_divider", {
            "number": "05", "title": "Color",
            "lede": (
                "The palette is two warm neutrals and one earned green. Green is "
                "reserved for the dot, for state changes the user caused "
                "(“Engineer joined”), and for the act of human contact. Never "
                "decorative. If you find yourself reaching for green, ask whether "
                "a human is involved."
            ),
        }),
        Page("color_grid", {
            "title": "Primary palette.",
            "subtitle": "— Primary tokens",
            "swatch_keys": ["cream", "ink", "moss", "deep_moss"],
        }),
        Page("color_grid", {
            "title": "Surface & support.",
            "subtitle": "— Surface + support",
            "swatch_keys": ["paper", "cream_2", "rule", "green_tint"],
        }),
        Page("color_rule", {
            "title": "The 80 / 15 / 5 rule.",
            "body": (
                "On any given screen: 80% cream/paper as background, 15% ink as "
                "type and structure, 5% green as the moment of human contact. If "
                "your green creeps above 5%, you're using it as decoration, not "
                "as meaning."
            ),
            "bars": [
                ("80%", "cream", "Cream / paper background"),
                ("15%", "ink", "Ink — type, structure"),
                ("5%",  "moss", "Green — human contact"),
            ],
        }),
        Page("color_combos", {
            "title": "Allowed combinations.",
            "allowed": [
                ("cream", "ink",       "Default. The native pairing."),
                ("paper", "ink",       "Cards on cream backgrounds."),
                ("ink",   "cream",     "Reverse / hero panels."),
                ("moss",  "cream",     "Green-block lockup. Sparingly."),
                ("cream", "deep_moss", "Hyperlinks, italic emphasis."),
                ("green_tint", "deep_moss", "Baton-pass and success notifications."),
            ],
            "forbidden": [
                "Moss on ink. Insufficient contrast.",
                "Moss on moss. The dot must always read as a separate object.",
                "Cream on paper. Indistinguishable.",
                "Any pure red, blue, or yellow. Off-brand and meaningless.",
            ],
        }),
        Page("color_a11y", {
            "title": "Accessibility & dark mode.",
            "ratios": [
                ("Ink on cream",        "13.8 : 1", "AAA"),
                ("Ink on paper",        "14.7 : 1", "AAA"),
                ("Ink-soft on cream",   "8.9 : 1",  "AAA"),
                ("Ink-mute on cream",   "4.7 : 1",  "AA"),
                ("Deep-moss on cream",  "6.4 : 1",  "AAA"),
                ("Cream on ink",        "13.8 : 1", "AAA"),
                ("Cream on moss",       "5.1 : 1",  "AA"),
            ],
            "dark_note": (
                "Dark mode flips background to ink (#1A1814) and text to cream "
                "(#F4F2EE). The dot stays moss. The 80/15/5 rule still holds."
            ),
        }),
    ])


def _typography() -> Section:
    return Section("06", "Typography", pages=[
        Page("section_divider", {
            "number": "06", "title": "Typography",
            "lede": (
                "Display in Fraunces (a Tiempos-adjacent free serif), with italics "
                "doing emphasis work. Body and UI in Instrument Sans (a Söhne-"
                "adjacent free grotesk). Mono in JetBrains for code, eyebrows, "
                "and numerical labels. Three families. Done."
            ),
        }),
        Page("type_families", {
            "title": "Three families. One voice.",
            "families": [
                {"role": "Display", "name": "Fraunces", "weights": "400 / 400 italic", "use": "Headlines, hero copy, tile titles. Italic carries the human moment."},
                {"role": "Body / UI", "name": "Instrument Sans", "weights": "400 / 500 / 600", "use": "Paragraphs, captions, button labels, navigation."},
                {"role": "Mono", "name": "JetBrains Mono", "weights": "400 / 500", "use": "Eyebrows, code, numerals, tags, section numbers."},
            ],
            "fallbacks_note": (
                "Web fallbacks: Fraunces → Tiempos → Georgia → serif. "
                "Instrument Sans → SF Pro Text → system-ui → sans-serif. "
                "JetBrains Mono → SF Mono → Menlo → monospace. "
                "Office fallbacks (Word/PowerPoint without Fraunces installed): Georgia, Arial, Consolas."
            ),
        }),
        Page("type_scale", {
            "title": "Scale & specimens.",
            "rows": [
                {"meta": "— Display\nFraunces 400 / italic\nClamp 48–96px",
                 "sample": "Build with AI. Ship with engineers.", "scale": "display"},
                {"meta": "— Heading 1\nFraunces 400\n48px / -0.025em",
                 "sample": "Your engineer becomes your engineer.", "scale": "h1"},
                {"meta": "— Heading 2\nFraunces 400\n32px / -0.02em",
                 "sample": "From build to shipped, with the same engineer.", "scale": "h2"},
                {"meta": "— Eyebrow\nJetBrains Mono 500\n12px / 0.05em / UPPER",
                 "sample": "— HOW IT WORKS · 06 FRAMES", "scale": "eyebrow"},
                {"meta": "— Body\nInstrument Sans 400\n17px / 1.65",
                 "sample": "Software is following the path coal once did: when a thing gets cheaper, we use a lot more of it.", "scale": "body"},
                {"meta": "— Caption\nInstrument Sans 400\n14px / 1.55",
                 "sample": "Median time-to-human · 74 seconds in beta. Priority dispatch on Max plan targets 30 seconds.", "scale": "caption"},
            ],
        }),
        Page("type_italic", {
            "title": "Italic, with intent.",
            "rules": [
                "Italics in Fraunces are reserved for the human moment in a sentence. They mark the part where Relay is the answer.",
                "Italics carry Deep Moss color (#3F5C2E) in headlines. Never in body copy.",
                "Maximum one italic phrase per headline. If you have two, you have two headlines.",
                "Never italicise full sentences. Italic is emphasis, not voice.",
            ],
            "examples": [
                {"sentence_pre": "Same engineer. Three legs. ", "sentence_emph": "One relationship.", "sentence_post": ""},
                {"sentence_pre": "Your engineer becomes ", "sentence_emph": "your engineer.", "sentence_post": ""},
                {"sentence_pre": "We sound like a senior engineer ", "sentence_emph": "at a whiteboard,", "sentence_post": " not a tech company at a launch event."},
            ],
        }),
        Page("type_numerals", {
            "title": "Numerals & eyebrows.",
            "rules": [
                "Use font-variant-numeric: tabular-nums on stat blocks so digits align column-to-column.",
                "Eyebrows always lead with an em-dash and end with a section number: — Pricing · 03",
                "Eyebrows are JetBrains Mono 500, 12px, 0.05em tracking, UPPERCASE, color ink-mute.",
                "Numerals in Fraunces display headlines may use lining figures; in body copy, prefer oldstyle.",
            ],
        }),
    ])


def _voice() -> Section:
    return Section("07", "Voice & Tone", pages=[
        Page("section_divider", {
            "number": "07", "title": "Voice & Tone",
            "lede": (
                "Imagine a senior engineer explaining the product to a friend on a "
                "Sunday walk. That's the register. Direct, slightly understated, "
                "occasionally dry. We never sell — we describe what is true. The "
                "product does the convincing."
            ),
        }),
        Page("voice_pairs", {
            "title": "Yes / no, side by side.",
            "pairs": [
                {"do": ["Build with AI. Ship with ", "engineers.", ""],
                 "dont": "Revolutionize your workflow with the world's first AI-native human assistance platform!"},
                {"do": ["Same engineer. Three legs. ", "One relationship.", ""],
                 "dont": "End-to-end engineer continuity across the full development lifecycle."},
                {"do": ["Your team is already building. ", "Make sure it doesn't break.", ""],
                 "dont": "Empower your enterprise with AI governance solutions for citizen developers."},
            ],
        }),
        Page("voice_lexicon", {
            "title": "Lexicon.",
            "use": [
                "builder", "ship", "press the dot", "pass the baton",
                "same engineer", "on demand", "ready", "session",
                "track", "leg 1 / 2 / 3", "stuck", "press for a human",
            ],
            "avoid": [
                "solution", "empower", "revolutionize", "seamless",
                "world-class", "cutting-edge", "leverage", "synergy",
                "next-gen", "robust", "enterprise-grade", "best-in-class",
            ],
        }),
        Page("voice_punctuation", {
            "title": "Punctuation, capitalization, mechanics.",
            "rules": [
                "Em-dash — sparingly. Frame ideas, not decoration.",
                "No exclamation marks. Periods earn the line.",
                "Sentence case in everything except the wordmark and acronyms.",
                "Oxford comma. Always.",
                "Numbers: spell zero through nine; numerals from 10 onward. Always numerals for measured values (90 seconds, 2,000 engineers).",
                "Quotation marks: typographic curly quotes. Straight quotes are a bug.",
                "Dashes: en-dash for ranges (Mon–Fri); em-dash for parenthetical breaks; hyphen for compounds.",
                "URLs: lowercase, no trailing slash, no http(s)://.",
            ],
        }),
        Page("voice_register_shifts", {
            "title": "Same voice, different surfaces.",
            "rows": [
                ("Hero", "Build with AI. Ship with engineers.", "One sentence. One italic. Earned period."),
                ("Button", "Press for a human", "Verb + object. Three words or fewer."),
                ("Error", "We couldn't reach an engineer. Try again, or email support@relay.green.", "State the truth, name the next step."),
                ("Email · transactional", "An engineer joined your session at 14:02. Recording attached.", "Time, fact, attachment. No marketing furniture."),
                ("Email · marketing", "We don't send these often. Here's what shipped in May.", "Acknowledge the channel. Earn the line."),
                ("Sales deck", "Two-person marketing team. Twenty internal tools. One engineer on call.", "Specifics make it real."),
                ("Status page", "All systems normal. 1,247 engineers online.", "Numbers without spin."),
            ],
        }),
    ])


def _photography() -> Section:
    return Section("08", "Photography & Imagery", pages=[
        Page("section_divider", {
            "number": "08", "title": "Photography & Imagery",
            "lede": (
                "When we show a human, we show a real one — first name, photo, "
                "expertise. We never use stock illustration, never use 3D abstract "
                "shapes, never use AI-generated faces. The product is humans; the "
                "brand should look like it."
            ),
        }),
        Page("photo_principles", {
            "title": "Documentary, not directed.",
            "rules": [
                "Engineer photos are square crops, ink-and-cream toned, with a green dot status bug at the bottom-right corner.",
                "Backgrounds are neutral and real — desks, kitchens, windows. No corporate-stock smiles. No conference-room glass.",
                "Eye-level with the subject. Never above (paternal), never below (heroic).",
                "One person per frame. Pairs only when the photo is about the relationship between two engineers.",
                "Product UI is shown the way it actually looks — real terminal windows, real chat threads, real code. Never “futuristic” mockups.",
            ],
        }),
        Page("photo_treatment", {
            "title": "Treatment & status bug.",
            "specs": [
                ("Aspect ratios",   "Square 1:1 (default), 4:3 (editorial), 16:9 (banner only)."),
                ("Tone",            "Slight warm shift toward cream, blacks pulled to ink (#1A1814)."),
                ("Status bug",      "Moss circle, diameter 6% of short side, inset 4% from bottom-right."),
                ("Saturation",      "Reduce 12–18% from camera-default. Brand reads as quiet, not muted."),
                ("Resolution",      "Web: 2x retina at intended display size. Print: 300 DPI minimum at 1:1 use."),
                ("Format",          "JPEG q90 for web; TIFF / PNG-24 for print masters."),
            ],
        }),
        Page("photo_dos_donts", {
            "title": "Do's & don'ts.",
            "dos": [
                "Show the face of a real engineer with their first name and area of expertise.",
                "Capture concentration. The good photos are the ones where the subject didn't know.",
                "Frame the work — the screen, the keyboard, the notebook — alongside the person.",
                "Crop tight. Brand photography is intimate.",
            ],
            "donts": [
                "Don't use stock photography.",
                "Don't use AI-generated faces. The promise of the product is a real person.",
                "Don't use 3D abstract shapes, glassmorphism, or gradient meshes.",
                "Don't crop out faces or shoot from behind. We are not a faceless company.",
                "Don't put the dot bug anywhere except bottom-right.",
            ],
        }),
    ])


def _icons() -> Section:
    return Section("09", "Iconography", pages=[
        Page("section_divider", {
            "number": "09", "title": "Iconography",
            "lede": (
                "Icons in Relay carry meaning, never decoration. They are line, "
                "two-pixel, with a single soft round corner. If a sentence would "
                "be clearer than an icon, use the sentence."
            ),
        }),
        Page("icon_principles", {
            "title": "Construction.",
            "rules": [
                "Stroke weight: 1.75 px on a 24 px grid. Scales linearly to other sizes (1.25 at 16, 2.25 at 32).",
                "Corner radius: 2 px on the grid. Outer corners round, inner corners sharp.",
                "Standard sizes: 16, 20, 24, 32. Use the size that matches the surrounding type's cap-height.",
                "Color: ink in default state, ink-mute in disabled, moss only when the icon represents human contact.",
                "Single-purpose: one icon = one concept. Multi-symbol icons (“gear plus arrow”) are a code smell.",
                "Custom icons match the inventory in style and weight. Submitted via brand@relay.green for review.",
            ],
        }),
    ])


def _motion() -> Section:
    return Section("10", "Motion", pages=[
        Page("section_divider", {
            "number": "10", "title": "Motion",
            "lede": (
                "Pulse means presence. Everything else is still. The dot pulses "
                "to mean a human is here — never to look interesting. Other "
                "interactions get 200 ms ease-out. That is the entire motion "
                "system."
            ),
        }),
        Page("motion_pulse", {
            "title": "The pulse — frame ladder.",
            "frames": [
                {"label": "0 ms",     "scale": 1.00, "ring_opacity": 0.25, "note": "Rest. Dot solid moss, ring at 0.25 opacity."},
                {"label": "1000 ms",  "scale": 1.20, "ring_opacity": 0.0,  "note": "Peak. Ring expanded to 1.4× size, faded to 0."},
                {"label": "2000 ms",  "scale": 1.00, "ring_opacity": 0.25, "note": "Back to rest. Loop ease-in-out."},
            ],
            "specs": "Duration 2000 ms · ease-in-out · loop · scale ±20% · ring opacity 0.25 → 0",
        }),
        Page("motion_principles", {
            "title": "What's allowed. What isn't.",
            "allowed": [
                "Pulse on the green dot when a human is available — and only then.",
                "200 ms ease-out for hover, focus, and small state changes.",
                "Underline animations on links, 150 ms, in/out from left.",
                "Page transitions: instant scroll-to-top. Layouts do not animate between routes.",
            ],
            "forbidden": [
                "Parallax. We are not a 2014 startup.",
                "Scroll-triggered reveals. Content exists when the page loads.",
                "Auto-playing video. Anywhere.",
                "Bouncing, shaking, or wobbling. Animation must mean something.",
                "Animated logos. The mark is still. Only the dot moves, and only with cause.",
            ],
        }),
    ])


def _components() -> Section:
    return Section("11", "Components", pages=[
        Page("section_divider", {
            "number": "11", "title": "Components",
            "lede": (
                "Buttons, the press-for-a-human button, the engineer card, the "
                "modality toggle, and the numbered tile. Everything else is "
                "composition. Resist adding a sixth."
            ),
        }),
        Page("comp_buttons", {
            "title": "Buttons.",
            "buttons": [
                {"variant": "ink",   "label": "Get in touch →", "note": "Primary CTA in body sections. Pill, 40 px tall, ink fill, cream label."},
                {"variant": "green", "label": "Try Relay →",     "note": "Reserved for the act of summoning a human. Green fill, cream label, 40 px tall."},
                {"variant": "ghost", "label": "See the kit →",   "note": "Secondary action. Always paired with a primary. Ink border, ink label, transparent fill."},
            ],
            "states": "Hover: 4% darker fill. Focus: 2 px ink ring at 4 px offset. Disabled: 40% opacity, no pointer.",
        }),
        Page("comp_press", {
            "title": "Press-for-a-human.",
            "headline": "The single most important component.",
            "body": (
                "Used once per screen, max. Pulses on hover. Means something. "
                "When this button appears, it is the visual climax of the page — "
                "everything else makes way for it."
            ),
            "specs": [
                ("Layout",  "ink pill · cream label · green dot at 10 px"),
                ("Size",    "vertical padding 12 px · horizontal padding 20 px · radius 999"),
                ("Label",   "Press for a human. Always those four words."),
                ("Behavior","Pulse begins on hover. On press, dot expands to fill the pill briefly, then resets."),
            ],
        }),
        Page("comp_engineer_card", {
            "title": "Engineer card.",
            "spec_rows": [
                ("Avatar",    "36 × 36 px ink circle, cream initial in Fraunces 16. Green dot status bug at bottom-right with cream ring."),
                ("Name line", "Instrument Sans 500, 13 px, ink. Format: First name + Last initial + · + employer or specialism."),
                ("Status",    "Instrument Sans 400, 11 px, ink-mute. Format: Online · joined in 71s."),
                ("Background","Cream surface, 1 px rule border, 8 px radius."),
            ],
            "example_name": "Priya R. · Stripe",
            "example_status": "Online · joined in 71s",
        }),
        Page("comp_other", {
            "title": "Modality toggle. Numbered tile. Status pill.",
            "items": [
                {"name": "Modality toggle",
                 "body": "Three-segment pill (Chat · Voice · Screen share). Selected segment ink fill, others ghost. Used in product surfaces, not marketing."},
                {"name": "Numbered tile",
                 "body": "Paper card, 1 px rule border, 12 px radius. Tile-num eyebrow at top, Fraunces headline, Instrument Sans body. The workhorse of every long page."},
                {"name": "Status pill",
                 "body": "Pill with cream-on-moss for “online,” ink-mute on cream for “offline,” accent-red on cream for “degraded.” Used on the trust center."},
                {"name": "Form field",
                 "body": "Cream fill, 1 px rule border, 8 px radius, 40 px tall. Focus state: 2 px deep-moss ring at 2 px offset."},
            ],
        }),
    ])


def _layout() -> Section:
    return Section("12", "Layout & Grid", pages=[
        Page("section_divider", {
            "number": "12", "title": "Layout & Grid",
            "lede": (
                "Every section starts with vast top-padding and an eyebrow. "
                "Content sits in a 1200px max-width container with 32px gutters. "
                "Headlines don't fill the column — they wrap intentionally, around "
                "an idea."
            ),
        }),
        Page("layout_spacing", {
            "title": "Spacing scale (8 pt base).",
            "scale": [4, 8, 16, 24, 32, 48, 64, 96, 128],
            "tokens": ["--sp-1", "--sp-2", "--sp-4", "--sp-6", "--sp-8", "--sp-12", "--sp-16", "--sp-24", "--sp-32"],
        }),
        Page("layout_constants", {
            "title": "Section rhythm. Containers. Radii.",
            "tiles": [
                {"label": "— Section rhythm", "headline": "96 / 100 / 128",
                 "body": "Sections breathe. Top padding is 100–128px. Anything tighter feels like marketing software, not editorial."},
                {"label": "— Containers", "headline": "1200 / 820 / 32",
                 "body": "1200px primary container. 820px narrow container for long-form prose. 32px gutter on both sides."},
                {"label": "— Radii", "headline": "8 · 12 · 16 · 999",
                 "body": "Cards: 12px. Hero panels: 16px. Buttons: full pill (999). Don't mix radii within a composition."},
            ],
        }),
    ])


def _naming() -> Section:
    return Section("13", "Naming & Glossary", pages=[
        Page("section_divider", {
            "number": "13", "title": "Naming & Glossary",
            "lede": (
                "A product's vocabulary is part of its design. Get the words "
                "right once, and every team uses them the same way forever."
            ),
        }),
        Page("naming_table", {
            "title": "What things are called.",
            "rows": [
                ("The brand name",     "Relay",                                     "relay.green, Relay.Green, ReLay, Relay AI"),
                ("The promise",        "Build with AI. Ship with engineers.",       "A real engineer, in your AI build / The press for a person / From build to shipped"),
                ("The CTA",            "Try Relay / Press for a human",             "Get started / Sign up / Request a demo"),
                ("The user",           "Builder",                                   "Citizen developer / Vibe coder / Non-developer / Customer"),
                ("The expert",         "Engineer (always by name)",                 "Agent / Operator / Specialist / Consultant / Pro"),
                ("The session",        "Session / Build moment",                    "Ticket / Chat / Conversation / Inquiry"),
                ("The handoff",        "Pass the baton (Leg 1 → 2 → 3)",  "Upsell / Conversion / Plan upgrade"),
                ("The categories",     "Track (Claude track, Cursor track, …)","Vertical / Practice / Channel / Pillar"),
                ("The promise time",   "On demand",                                 "Instant / Real-time / Lightning-fast"),
            ],
        }),
        Page("naming_glossary", {
            "title": "Glossary.",
            "terms": [
                ("Builder", "A user of an AI dev tool — solo, in a team, or in an enterprise. Relay's audience."),
                ("Engineer", "A senior software engineer on Relay's roster. Always referred to by first name."),
                ("Session", "A live, recorded Zoom call between a builder and an engineer. Has a start and end time."),
                ("Track", "A specialism aligned to a builder tool — Claude track, Cursor track, Lovable track, etc."),
                ("Leg", "One of three phases of the engagement: Build (1), Ship (2), Run (3)."),
                ("Pass the baton", "The handoff from one leg to the next, with the same engineer carrying continuity."),
                ("On demand", "The press-for-a-human promise. A session begins in seconds, not minutes."),
                ("Stuck", "The moment in a build where AI's automation ends and a human's judgement begins."),
            ],
        }),
    ])


def _architecture() -> Section:
    return Section("14", "Brand Architecture", pages=[
        Page("section_divider", {
            "number": "14", "title": "Brand Architecture",
            "lede": (
                "Relay is an independent company. Our investors, our operators, "
                "and our partners are mentioned where it's honest to mention "
                "them — never as a credibility crutch in the marketing surface."
            ),
        }),
        Page("architecture_layers", {
            "title": "The layers.",
            "layers": [
                ("Customer-facing",     "Relay",                       "The brand. The mark. The voice. The dot. Everything in marketing, product, and trust surfaces."),
                ("Corporate identity",  "Relay, Inc.",                 "Legal entity. Used in contracts, T&Cs, DPAs, and the corporate-line on /company/about."),
                ("Funding",             "Backed by The Asgard Fund",   "Mentioned only on /company/about. No logos in hero. No “as seen on” bars."),
                ("Operations",          "Operated with NINtec Systems","Engineering capacity partner. Disclosed on /company/about and trust pages. Never customer-surfaced."),
                ("Co-branding",         "Works with Claude / Cursor / …", "Tool integrations. Wordmark + “Works with” + tool wordmark. See section 15."),
            ],
        }),
        Page("architecture_independence", {
            "title": "What we say. What we don't.",
            "say": [
                "Relay, Inc. — independent, San Francisco · London.",
                "Backed by The Asgard Fund (on company/about only).",
                "Operated with NINtec Systems for global engineering capacity (on company/about and trust).",
            ],
            "dont_say": [
                "Don't list investor logos in the hero.",
                "Don't put a parent-company crest in the footer.",
                "Don't use “a [Parent] company” as a tagline. We are independent.",
                "Don't lead with size, age, or geographic reach. Lead with the press, the engineer, the moment of relief.",
            ],
        }),
    ])


def _ai_tooling() -> Section:
    return Section("15", "AI Tool Integration", pages=[
        Page("section_divider", {
            "number": "15", "title": "AI Tool Integration",
            "lede": (
                "Relay sits next to every major AI dev tool — Claude, Cursor, "
                "Lovable, Replit, Copilot, ChatGPT, Gemini, v0. Our co-branding "
                "rules keep the relationship clear: Relay is the human layer, the "
                "tool is the build layer."
            ),
        }),
        Page("ai_tracks", {
            "title": "The tracks.",
            "tracks": [
                ("Claude track",   "Anthropic Claude — Sonnet, Opus, Haiku.",       "Most-used by enterprise builders."),
                ("Cursor track",   "Cursor IDE — agent + chat modes.",              "Most-used by professional developers."),
                ("ChatGPT track",  "OpenAI ChatGPT — GPT-5, GPT-4o.",                "Most-used by solo builders."),
                ("Gemini track",   "Google Gemini — Pro, Flash.",                   "Strong on long-context analysis."),
                ("Copilot track",  "GitHub Copilot — chat, edit, agent.",           "In-IDE assistance for working teams."),
                ("Lovable track",  "Lovable — full-stack AI app builder.",          "Most-used by non-developer founders."),
                ("Replit track",   "Replit Agent — full-stack from prompt.",        "Most-used by educators and learners."),
                ("v0 track",       "Vercel v0 — UI-first generation.",              "Most-used by frontend designers."),
            ],
            "footnote": "A track is a specialism, not a contract. Engineers on multiple tracks are the norm.",
        }),
        Page("ai_lockup_rules", {
            "title": "“Works with” lockup.",
            "rules": [
                "Format: RELAY •   ·   Works with   ·   [Tool wordmark]. Hairline rule between Relay and the tool.",
                "Type: “Works with” in JetBrains Mono 500, 11 px, ink-mute, UPPERCASE.",
                "Tool wordmark uses the tool's official lockup at the tool's preferred sizing. Never recolor it.",
                "Cap-height parity: tool wordmark cap-height equals RELAY cap-height. The dot stays moss.",
                "Don't “rebrand” a tool. Don't put the tool inside Relay's mark. Don't use a “powered by” framing — Relay powers no one.",
            ],
        }),
        Page("ai_surface", {
            "title": "Where the tracks show up.",
            "surfaces": [
                ("Marketing site", "AI-tools marquee on the homepage and product page. Tools listed alphabetically; logos at consistent baseline."),
                ("In-product",     "Track selector on session start. The track determines which engineers are matched."),
                ("Sales material", "“Works with” lockup band at the bottom of slides for tool-specific decks."),
                ("Documentation",  "Each track gets a dedicated /resources/blog tag and a track-specific FAQ."),
                ("Trust",          "Each track's data handling is disclosed on /trust/data-handling."),
            ],
        }),
    ])


def _ide_extension() -> Section:
    return Section("16", "IDE & Extension", pages=[
        Page("section_divider", {
            "number": "16", "title": "IDE Plugin & Browser Extension",
            "lede": (
                "Where Relay lives next to a builder's tool of choice. The press "
                "is portable: a sidebar in the IDE, a corner button in the "
                "browser, a slash command in the terminal."
            ),
        }),
        Page("ide_principles", {
            "title": "Surface principles.",
            "rules": [
                "Match the host. The plugin chrome inherits the IDE's theme — dark in dark, light in light. Only the dot stays moss.",
                "One press, one promise. The plugin's primary action is always “Press for a human.” Never bundled with secondary CTAs.",
                "Never modal. The session opens in a side panel. Builders keep their context.",
                "Status bug. The plugin icon shows the engineer's online state with the same green dot. Pulse when a session is live.",
                "Browser extension. Same rules. Corner button, side panel, status bug. Available on any web-based AI tool.",
            ],
        }),
    ])


def _pricing() -> Section:
    return Section("17", "Three-Phase Pricing", pages=[
        Page("section_divider", {
            "number": "17", "title": "Three-Phase Pricing",
            "lede": (
                "Relay's pricing visual system mirrors the product itself: three "
                "phases, one engineer, one relationship. The visual language for "
                "each phase is consistent and earned."
            ),
        }),
        Page("pricing_phases", {
            "title": "Build · Ship · Run.",
            "phases": [
                {"num": "01", "name": "Build phase",
                 "model": "On-demand sessions",
                 "price": "First session free · €50 / 100 min · €100 / 240 min · €200 / 500 min",
                 "color_role": "moss",
                 "body": "10-minute sessions, billed by the bundle. The press-for-a-human moment, productized."},
                {"num": "02", "name": "Launch & Go-Live",
                 "model": "Fixed-scope project fee",
                 "price": "€1.5K – €5K based on complexity",
                 "color_role": "deep_moss",
                 "body": "When the build is done and the launch begins. One engineer, one fixed scope, one outcome."},
                {"num": "03", "name": "Maintain & Scale",
                 "model": "Monthly retainer",
                 "price": "€1K – €8K / mo",
                 "color_role": "ink",
                 "body": "Same engineer, ongoing. The leg most products skip and most relationships need."},
            ],
        }),
        Page("pricing_visual_rules", {
            "title": "Visual rules for the system.",
            "rules": [
                "Phase numbers are JetBrains Mono 500, 11 px, UPPERCASE — never roman numerals, never spelled out.",
                "Phase tiles always appear in order, with a consistent rhythm of paper background, 1 px rule border, 12 px radius.",
                "Phase color escalates: moss (Build) → deep moss (Ship) → ink (Run). Never reversed.",
                "Pricing displays in JetBrains Mono with tabular nums, on a single line where possible.",
                "Never collapse the three phases into a single “subscribe” CTA. The relationship is the product.",
            ],
        }),
    ])


def _digital_apps() -> Section:
    return Section("18", "Digital Applications", pages=[
        Page("section_divider", {
            "number": "18", "title": "Digital Applications",
            "lede": (
                "How the brand shows up on the surfaces builders actually see — "
                "the homepage, the OG image, the email signature, the slide "
                "deck, the dashboard."
            ),
        }),
        Page("digital_web", {
            "title": "Web hero composition.",
            "rules": [
                "Eyebrow above the headline: “— Section name · NN” in JetBrains Mono.",
                "Headline in Fraunces 400, with a single italic phrase in Deep Moss.",
                "Lede in Instrument Sans, max 60ch, color ink-soft.",
                "Primary CTA below the lede, ink pill. The Press-for-a-human button reserved for the dedicated CTA section.",
                "Hero band height 80–100 vh. White space below, never above.",
            ],
        }),
        Page("digital_og", {
            "title": "OG images & link previews.",
            "specs": [
                ("Dimensions",  "1200 × 630 px"),
                ("Background",  "Cream (#F4F2EE) by default; ink (#1A1814) for trust/legal pages."),
                ("Wordmark",    "RELAY • in upper-left at 64 px cap-height, with a clear-space dot diameter on each side."),
                ("Headline",    "Fraunces 400, 56 px, max 18 ch. Italic phrase in Deep Moss."),
                ("Footer",      "Section path in JetBrains Mono 12 px, lower-right, ink-mute."),
                ("Format",      "PNG, sRGB, 80–90% q. No text shadows, no rounded corners."),
            ],
        }),
        Page("digital_email", {
            "title": "Email signatures.",
            "blocks": [
                {"label": "Plain (default)",
                 "lines": ["Priya R.", "Engineer · Relay", "priya@relay.green", "relay.green"]},
                {"label": "Customer-facing (signature with role)",
                 "lines": ["Priya R.", "Senior Engineer · Stripe track · Relay", "+1 (415) 000-0000", "relay.green/p/priya-r"]},
                {"label": "Out of office",
                 "lines": ["Priya is on a session until 17:30 GMT.", "Press the green dot at relay.green to reach the next available engineer."]},
            ],
            "rules": [
                "Plain text only. No images, no banners, no quotes-of-the-day.",
                "First name + last initial. Always.",
                "Domain at the end. Never above the name.",
            ],
        }),
        Page("digital_slides", {
            "title": "Slide deck masters.",
            "rules": [
                "Cover slide: cream background, RELAY • lockup top-left, deck title in Fraunces 56, italic phrase in Deep Moss.",
                "Section dividers: ink background, eyebrow in JetBrains Mono, section title in Fraunces 64, deck dot in lower-right.",
                "Content slide: cream background, eyebrow + headline + body. Max 8 lines of body text. If you need more, you have two slides.",
                "Stat slide: ink background, single number in Fraunces 144, label below in Instrument Sans 18.",
                "Closing slide: green block, RELAY • (cream dot) centered, single line in Fraunces below.",
            ],
        }),
    ])


def _social() -> Section:
    return Section("19", "Social Media", pages=[
        Page("section_divider", {
            "number": "19", "title": "Social Media",
            "lede": (
                "Relay's social presence is small and on-message. The dot is the "
                "avatar. The voice is the same as everywhere else. Less posting, "
                "more meaning per post."
            ),
        }),
        Page("social_sizes", {
            "title": "Sizes by platform.",
            "rows": [
                ("LinkedIn",  "Profile 400 × 400 · Cover 1128 × 191 · Post 1200 × 627 · Story 1080 × 1920"),
                ("X / Twitter","Profile 400 × 400 · Header 1500 × 500 · Post 1200 × 675"),
                ("YouTube",   "Channel 800 × 800 · Banner 2560 × 1440 · Thumbnail 1280 × 720"),
                ("GitHub",    "Org avatar 500 × 500 · README banner 1280 × 640 · OG fallback 1200 × 630"),
                ("Medium",    "Avatar 400 × 400 · Banner 1500 × 750 · Story image 1400 × 787"),
                ("Bluesky",   "Profile 400 × 400 · Banner 3000 × 1000 · Post 1200 × 630"),
            ],
        }),
        Page("social_avatar_cover", {
            "title": "Avatar & cover rules.",
            "rules": [
                "Avatar: the dot. Moss circle on cream background. No wordmark, ever, in a circular avatar — circles fight wordmarks.",
                "Cover: ink background, RELAY • lockup left-anchored, single line of cream Fraunces. Never crowd the safe area.",
                "Username: @relay on every platform where available, @relaygreen as fallback.",
                "Bio: “Human engineers, in seconds. Build with AI. Ship with engineers. · relay.green”",
            ],
        }),
        Page("social_post_templates", {
            "title": "Post templates.",
            "templates": [
                {"kind": "Quote post",   "body": "Cream background. Single line of Fraunces 48 with one italic phrase. RELAY • lockup bottom-right."},
                {"kind": "Stat post",    "body": "Ink background. One number in Fraunces 144 cream. Label in Instrument Sans 24 ink-mute. Source attribution at bottom."},
                {"kind": "Engineer card","body": "Paper background. Engineer photo (square) on the left, name + track + a one-line quote on the right."},
                {"kind": "Field note",   "body": "Cream background. Eyebrow + headline + 3-line excerpt. Link in caption only — no link-in-image."},
            ],
        }),
    ])


def _stationery() -> Section:
    return Section("20", "Stationery", pages=[
        Page("section_divider", {
            "number": "20", "title": "Stationery",
            "lede": (
                "Print is rare for Relay. When it happens, the rules are short. "
                "The mark, the type, the color. Don't reinvent."
            ),
        }),
        Page("stationery_card", {
            "title": "Business card.",
            "specs": [
                ("Size",     "85 × 55 mm (international standard)."),
                ("Material", "Uncoated, 350 gsm, cream stock."),
                ("Front",    "RELAY • lockup centered, 24 mm wide. Nothing else."),
                ("Back",     "Name in Fraunces 14 pt, role + track in Instrument Sans 9 pt, email + relay.green in JetBrains Mono 8 pt."),
                ("Ink",      "Single Pantone for moss; black for ink. No CMYK."),
            ],
        }),
        Page("stationery_letterhead", {
            "title": "Letterhead & envelope.",
            "specs": [
                ("Letterhead size", "A4 (210 × 297 mm)."),
                ("Header",          "RELAY • lockup upper-left at 28 mm wide, with 12 mm clear space."),
                ("Footer",          "Single line: Relay, Inc. · San Francisco · London · relay.green"),
                ("Envelope size",   "DL (110 × 220 mm)."),
                ("Envelope mark",   "RELAY • upper-left at 22 mm wide, return address below in Instrument Sans 8 pt."),
            ],
        }),
    ])


def _physical() -> Section:
    return Section("21", "Applied Physical", pages=[
        Page("section_divider", {
            "number": "21", "title": "Applied Physical",
            "lede": (
                "Relay's physical presence is the dot. A laptop sticker. A "
                "notebook cover. A t-shirt. The brand book ends here for "
                "merchandise — anything else gets approved by Brand."
            ),
        }),
        Page("physical_items", {
            "title": "The three things we make.",
            "items": [
                {"name": "Laptop sticker",
                 "spec": "32 mm green dot, die-cut. No wordmark. Available at conferences and in the welcome kit."},
                {"name": "Notebook",
                 "spec": "A5, soft cover, cream stock. Front: dot debossed at 18 mm. Back: “Relay, Inc. · relay.green” blind embossed."},
                {"name": "T-shirt",
                 "spec": "Cream tee, dot screen-printed at 60 mm on the front-left chest. RELAY • lockup screen-printed across the back at 200 mm."},
            ],
            "footer": "No mugs. No keychains. No tote bags with a wall of logos. The dot does the work.",
        }),
    ])


def _trust() -> Section:
    return Section("22", "Trust & Compliance", pages=[
        Page("section_divider", {
            "number": "22", "title": "Trust & Compliance",
            "lede": (
                "Relay's trust posture is part of the brand. SOC 2, GDPR, "
                "session recording with consent — these are not legal disclosures, "
                "they are product features. We display them as such."
            ),
        }),
        Page("trust_principles", {
            "title": "How we show trust.",
            "rules": [
                "Trust pages live at /trust/* with a section divider matching the rest of the site. Same eyebrow, same Fraunces headline, same lede.",
                "Compliance badges (SOC 2, GDPR) appear as named pills at the foot of marketing pages — never as a wall of logos.",
                "Sub-processors are listed by name and purpose, not as a logo grid. We don't credibility-stack.",
                "Session recording is described in plain language: “Recorded with your consent. Retained for replay. Deleted on request.”",
                "Responsible disclosure has a public page, an email, and a 90-day SLA. Worded the same way the law is.",
            ],
        }),
    ])


def _governance() -> Section:
    return Section("23", "Governance", pages=[
        Page("section_divider", {
            "number": "23", "title": "Governance",
            "lede": (
                "This document is owned, reviewed, and revised. When the brand "
                "changes, this book is the first thing to change."
            ),
        }),
        Page("governance_meta", {
            "title": "How this document is maintained.",
            "fields": [
                ("Owner",          "Brand · Relay, Inc."),
                ("Editorial lead", "Head of Brand"),
                ("Contributors",   "Design · Engineering · Marketing · Sales · Trust"),
                ("Cadence",        "Reviewed quarterly. Revised whenever a brand change ships."),
                ("Approvals",      "Material changes (mark, color, voice) require Head of Brand sign-off; surface-level changes can ship via PR review."),
                ("Distribution",   "PDF + PPTX rebuilt from the source repo on every change. Latest version lives at relay.green/brand-guidelines."),
                ("Change log",     "Tracked in scripts/brand-book/CHANGELOG.md alongside the source."),
                ("Contact",        "brand@relay.green"),
            ],
        }),
        Page("governance_principles", {
            "title": "Principles for editing this book.",
            "rules": [
                "Every rule earns its place. If a rule has never been broken, it shouldn't be in the book.",
                "Show, don't tell. Every spec gets a rendered example.",
                "If two rules conflict, the older one wins until Brand says otherwise.",
                "When you find a gap, write the rule, ship the work, then propose the addition. The book trails the work, not the other way around.",
                "When in doubt, don't.",
            ],
        }),
    ])


def _back_cover() -> Section:
    return Section("—", "Back cover", pages=[
        Page("back_cover", {
            "wordmark_top": "RELAY",
            "tagline": "Build with AI. Ship with engineers.",
            "footer_lines": [
                "Relay Brand Book · v1.0 · May 2026",
                "Relay, Inc. · San Francisco · London · Independent",
                "brand@relay.green · relay.green",
            ],
        }),
    ])


# ---------------------------------------------------------------------------
# The full book.
# ---------------------------------------------------------------------------

def build_book() -> list[Section]:
    """Returns the full ordered list of sections.

    The TOC is inserted after the cover/foreword and is computed from the
    other sections' page counts at render time.
    """
    sections: list[Section] = [
        _cover(),
        _foreword(),
        # toc inserted by build_with_toc()
        _essence(),
        _story(),
        _mark(),
        _dot(),
        _color(),
        _typography(),
        _voice(),
        _photography(),
        _icons(),
        _motion(),
        _components(),
        _layout(),
        _naming(),
        _architecture(),
        _ai_tooling(),
        _ide_extension(),
        _pricing(),
        _digital_apps(),
        _social(),
        _stationery(),
        _physical(),
        _trust(),
        _governance(),
        _back_cover(),
    ]
    return sections


def build_with_toc() -> list[Section]:
    """Inserts a derived TOC section after the foreword."""
    sections = build_book()

    toc_rows: list[tuple[str, str, int]] = []
    page_no = 1
    # Cover (2) + Foreword (1) + TOC (1) = 4 pages before section 01
    cover_pages = sum(len(s.pages) for s in sections[:2])
    toc_page_count = 1
    page_no = cover_pages + toc_page_count + 1

    for s in sections[2:]:
        if s.number != "—":
            toc_rows.append((s.number, s.title, page_no))
        page_no += len(s.pages)

    toc_section = _toc(toc_rows)
    return sections[:2] + [toc_section] + sections[2:]
