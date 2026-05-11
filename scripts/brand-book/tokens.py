"""
Brand tokens for the Relay Brand Book generator.

Mirrors the canonical web tokens in:
  - relay-green/app/brand-guidelines/brand-guidelines.css   (.bg-root :root)
  - relay-green/app/globals.css                             (:root primary tokens)
  - relay-green/lib/brand.ts                                (customer-facing strings)

If you change a hex here, change it there too — the verification step
(`build_brand_book.py --check-tokens`) fails the build if they drift.

Units: hex strings are the wire format. Helpers expose RGB tuples for
ReportLab (0..1 floats) and python-pptx (0..255 ints).
"""

from __future__ import annotations
from dataclasses import dataclass


# ---------------------------------------------------------------------------
# Color palette — sourced from brand-guidelines.css :root
# ---------------------------------------------------------------------------

PALETTE: dict[str, dict[str, str]] = {
    # Primary
    "cream":      {"hex": "#F4F2EE", "token": "--cream",       "role": "primary",  "use": "Default page background. Warm, paper-like. Sets the editorial tone of the brand."},
    "ink":        {"hex": "#1A1814", "token": "--ink",         "role": "primary",  "use": "Body text, primary buttons, dark sections. Almost-but-not-quite black, warm-tinted."},
    "moss":       {"hex": "#4F6B3A", "token": "--green",       "role": "primary",  "use": "The brand. The dot. Human presence. Use sparingly — the only color that earns attention."},
    "deep_moss":  {"hex": "#3F5C2E", "token": "--green-deep",  "role": "primary",  "use": "Italic emphasis in serif headlines. Hyperlink color. Accessible on cream."},
    # Surface + support
    "paper":      {"hex": "#F9F7F3", "token": "--paper",       "role": "surface",  "use": "Card and tile surface. Half-step lighter than cream."},
    "cream_2":    {"hex": "#ECE8E0", "token": "--cream-2",     "role": "surface",  "use": "Alternate section background. Differentiates two-up splits."},
    "rule":       {"hex": "#D8D2C5", "token": "--rule",        "role": "surface",  "use": "Hairlines, dividers, card borders. Never as a fill."},
    "green_tint": {"hex": "#E6F4EA", "token": "--green-tint",  "role": "surface",  "use": "Background for baton-pass cards and successful-action notifications."},
    # Functional / text
    "ink_soft":   {"hex": "#4A4640", "token": "--ink-soft",    "role": "text",     "use": "Lede paragraphs, supporting body copy. Softer than full ink."},
    "ink_mute":   {"hex": "#8A857C", "token": "--ink-mute",    "role": "text",     "use": "Eyebrows, captions, metadata. Lowest-emphasis text."},
    # Accent / state
    "accent_red": {"hex": "#C44A2C", "token": "--accent-red",  "role": "state",    "use": "Don't markers, supervisor alerts. Never decorative."},
    "warning":    {"hex": "#B8741A", "token": "--warning",     "role": "state",    "use": "Caution states. Used at <1% of any screen."},
}

# Convenience direct accessors (most-used)
CREAM = PALETTE["cream"]["hex"]
PAPER = PALETTE["paper"]["hex"]
CREAM_2 = PALETTE["cream_2"]["hex"]
INK = PALETTE["ink"]["hex"]
INK_SOFT = PALETTE["ink_soft"]["hex"]
INK_MUTE = PALETTE["ink_mute"]["hex"]
RULE = PALETTE["rule"]["hex"]
MOSS = PALETTE["moss"]["hex"]
DEEP_MOSS = PALETTE["deep_moss"]["hex"]
GREEN_TINT = PALETTE["green_tint"]["hex"]
ACCENT_RED = PALETTE["accent_red"]["hex"]


def hex_to_rgb_int(hexstr: str) -> tuple[int, int, int]:
    """'#1A1814' -> (26, 24, 20). For python-pptx RGBColor."""
    h = hexstr.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def hex_to_rgb_float(hexstr: str) -> tuple[float, float, float]:
    """'#1A1814' -> (0.102, 0.094, 0.078). For ReportLab setFillColorRGB."""
    r, g, b = hex_to_rgb_int(hexstr)
    return (r / 255.0, g / 255.0, b / 255.0)


# ---------------------------------------------------------------------------
# Type stack — sourced from app/layout.tsx + brand-guidelines.css
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class FontFamily:
    name: str               # display name, e.g. "Fraunces"
    role: str               # 'display' | 'sans' | 'mono'
    css_var: str            # the var name in CSS, e.g. '--font-fraunces'
    google_repo_path: str   # path under github.com/google/fonts/ofl/
    pdf_filename: str       # the TTF filename ReportLab will register
    fallback_chain: tuple[str, ...]


FONTS: dict[str, FontFamily] = {
    "fraunces": FontFamily(
        name="Fraunces",
        role="display",
        css_var="--font-fraunces",
        google_repo_path="fraunces",
        pdf_filename="Fraunces-Regular.ttf",
        fallback_chain=("Tiempos", "Georgia", "serif"),
    ),
    "fraunces_italic": FontFamily(
        name="Fraunces-Italic",
        role="display",
        css_var="--font-fraunces",
        google_repo_path="fraunces",
        pdf_filename="Fraunces-Italic.ttf",
        fallback_chain=("Tiempos", "Georgia", "serif"),
    ),
    "instrument_sans": FontFamily(
        name="InstrumentSans",
        role="sans",
        css_var="--font-instrument-sans",
        google_repo_path="instrumentsans",
        pdf_filename="InstrumentSans-Regular.ttf",
        fallback_chain=("SF Pro Text", "system-ui", "Arial", "sans-serif"),
    ),
    "instrument_sans_medium": FontFamily(
        name="InstrumentSans-Medium",
        role="sans",
        css_var="--font-instrument-sans",
        google_repo_path="instrumentsans",
        pdf_filename="InstrumentSans-Medium.ttf",
        fallback_chain=("SF Pro Text", "system-ui", "Arial", "sans-serif"),
    ),
    "jetbrains_mono": FontFamily(
        name="JetBrainsMono",
        role="mono",
        css_var="--font-jetbrains",
        google_repo_path="jetbrainsmono",
        pdf_filename="JetBrainsMono-Regular.ttf",
        fallback_chain=("SF Mono", "Menlo", "Consolas", "monospace"),
    ),
    "jetbrains_mono_medium": FontFamily(
        name="JetBrainsMono-Medium",
        role="mono",
        css_var="--font-jetbrains",
        google_repo_path="jetbrainsmono",
        pdf_filename="JetBrainsMono-Medium.ttf",
        fallback_chain=("SF Mono", "Menlo", "Consolas", "monospace"),
    ),
}

# Type scale — sourced from brand-guidelines.css .bg-type-* + .bg-hero h1
TYPE_SCALE: dict[str, dict] = {
    "display":  {"family": "fraunces",        "size_pt": 56, "leading": 1.05, "tracking_em": -0.030, "color": "ink",  "label": "Display · clamp 48–96px"},
    "h1":       {"family": "fraunces",        "size_pt": 36, "leading": 1.05, "tracking_em": -0.025, "color": "ink",  "label": "Heading 1 · 48px"},
    "h2":       {"family": "fraunces",        "size_pt": 26, "leading": 1.15, "tracking_em": -0.020, "color": "ink",  "label": "Heading 2 · 32px"},
    "h3":       {"family": "fraunces",        "size_pt": 20, "leading": 1.20, "tracking_em": -0.015, "color": "ink",  "label": "Heading 3 · 22px"},
    "lede":     {"family": "instrument_sans", "size_pt": 14, "leading": 1.55, "tracking_em": 0.0,    "color": "ink_soft", "label": "Lede · 17px / 1.65"},
    "body":     {"family": "instrument_sans", "size_pt": 11, "leading": 1.55, "tracking_em": 0.0,    "color": "ink_soft", "label": "Body · 17px / 1.65"},
    "caption":  {"family": "instrument_sans", "size_pt":  9, "leading": 1.45, "tracking_em": 0.0,    "color": "ink_soft", "label": "Caption · 14px / 1.55"},
    "eyebrow":  {"family": "jetbrains_mono_medium", "size_pt": 8, "leading": 1.30, "tracking_em": 0.05, "color": "ink_mute", "label": "Eyebrow · 12px / UPPER / 0.05em"},
    "tag":      {"family": "jetbrains_mono",  "size_pt":  7, "leading": 1.20, "tracking_em": 0.04, "color": "ink_mute", "label": "Tag · 11px"},
}


# ---------------------------------------------------------------------------
# Spacing — 8pt scale, sourced from page.tsx layout section
# ---------------------------------------------------------------------------

SPACING: list[dict] = [
    {"px": 4,   "token": "--sp-1"},
    {"px": 8,   "token": "--sp-2"},
    {"px": 16,  "token": "--sp-4"},
    {"px": 24,  "token": "--sp-6"},
    {"px": 32,  "token": "--sp-8"},
    {"px": 48,  "token": "--sp-12"},
    {"px": 64,  "token": "--sp-16"},
    {"px": 96,  "token": "--sp-24"},
    {"px": 128, "token": "--sp-32"},
]

# Layout system constants
SECTION_RHYTHM = (96, 100, 128)        # top padding scale
CONTAINER_PRIMARY_PX = 1200
CONTAINER_NARROW_PX = 820
GUTTER_PX = 32
RADII = (8, 12, 16, 999)               # Cards / Hero / (full pill)
MOTION_PULSE_MS = 2000                 # green dot pulse
MOTION_TRANSITION_MS = 200             # default ease-out


# ---------------------------------------------------------------------------
# Page geometry — A4 landscape
# ---------------------------------------------------------------------------

# A4 in points (1 inch = 72 pt). Landscape.
PAGE_WIDTH_PT = 297.0 / 25.4 * 72.0    # ~841.89
PAGE_HEIGHT_PT = 210.0 / 25.4 * 72.0   # ~595.28

# PPTX wants inches.
PAGE_WIDTH_IN = 11.6929
PAGE_HEIGHT_IN = 8.2677

MARGIN_PT = 56.0                       # ~0.78 in — generous editorial margin
HEADER_FOOTER_BAND_PT = 32.0


# ---------------------------------------------------------------------------
# Brand strings — sourced from lib/brand.ts + page.tsx
# ---------------------------------------------------------------------------

BRAND = {
    "name": "Relay",
    "domain": "relay.green",
    "tagline": "You're building with AI. We're the humans who help you ship.",
    "promise_short": "Build with AI. Ship with engineers.",
    "promise_long": "Click the green dot. Get a qualified engineer in 90 seconds.",
    "doc_title": "Relay Brand Book",
    "doc_version": "v1.0 · May 2026",
    "doc_subtitle": "What Relay looks like, sounds like, and does not do.",
    "doc_owner": "Brand · Relay, Inc.",
    "doc_status": "Living document",
    "doc_audience": "Design, Eng, Marketing, Sales, Partners",
    "doc_cadence": "Reviewed quarterly",
    "corporate_line": "San Francisco · London · Independent",
    "support_email": "support@relay.green",
    "footer_left": "Relay Brand Book · v1.0 · May 2026",
    "footer_right": "Living document · Reviewed quarterly",
}
