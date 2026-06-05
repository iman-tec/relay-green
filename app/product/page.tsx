/*
 * /product, How it works.
 *
 * Reordered: hero → audience cards → trust pillars → 6-frame how-it-works
 * sequence → modalities → on-the-record (Zoom + compliance) → pull quote →
 * CTA. The audience + trust pair sits right after the hero so a first-time
 * visitor sees who Relay is for and why to trust it before the operational
 * deep-dive.
 *
 * Animations: scroll-triggered fade-up on cards (animation-timeline: view()
 * with a stagger fallback for older browsers), hover lift on the audience
 * cards, animated underlines on the trust pillars, pulsing brand dots on
 * every RELAY• mark. All motion respects prefers-reduced-motion.
 */

import type { Metadata } from "next";
import { Shell } from "../_marketing/Shell";
import { RelayLogo } from "../_marketing/RelayLogo";
import { BuiltToTrustCenter } from "../_marketing/BuiltToTrustCenter";
import { ProductHeroOrb } from "./ProductHeroOrb";
import { JsonLd } from "../_marketing/JsonLd";
import { breadcrumbSchema, webPageSchema } from "../../lib/seo/schema";

const SITE_URL = "https://www.relay.green";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "Three phases. One team. Same engineer the whole way, from build through launch through ongoing maintenance.",
  alternates: { canonical: "/product" },
};

const TRUST_PILLARS = [
  {
    title: "Enterprise-grade security",
    body: "SOC 2 aligned, GDPR aware. Data residency where it matters.",
  },
  {
    title: "Engineering Team Continuity",
    body: "Same engineer from first commit to fifth iteration. Context that compounds. Trust that deepens over time.",
  },
];

const PRODUCT_PAGE_PALETTES = {
  referenceCobaltOchre: {
    name: "Reference Cobalt Ochre",
    hero: "linear-gradient(115deg, rgba(249,245,226,0.98) 0%, rgba(149,193,238,0.9) 31%, rgba(58,131,239,0.88) 64%, rgba(37,62,154,0.94) 100%), radial-gradient(circle at 22% 16%, rgba(249,245,226,0.78) 0%, rgba(249,245,226,0) 34%), radial-gradient(circle at 78% 34%, rgba(190,123,24,0.28) 0%, rgba(190,123,24,0) 30%)",
    core: "linear-gradient(180deg, rgba(249,245,226,0.98) 0%, rgba(228,238,247,0.96) 100%)",
    model:
      "linear-gradient(180deg, rgba(240,244,238,0.98) 0%, rgba(149,193,238,0.38) 100%)",
    session:
      "linear-gradient(180deg, rgba(224,237,249,0.96) 0%, rgba(249,245,226,0.98) 100%)",
    integrations:
      "linear-gradient(180deg, rgba(249,245,226,1) 0%, rgba(235,225,199,0.98) 100%)",
    trust:
      "radial-gradient(ellipse 100% 120% at 70% 30%, #253e9a 0%, #17275f 58%, #0c1533 100%)",
  },
  referenceTealSpectrum: {
    name: "Reference Teal Spectrum",
    hero: "linear-gradient(115deg, rgba(211,239,235,0.98) 0%, rgba(130,194,184,0.9) 30%, rgba(48,114,119,0.9) 66%, rgba(14,51,72,0.94) 100%), radial-gradient(circle at 22% 16%, rgba(211,239,235,0.78) 0%, rgba(211,239,235,0) 34%), radial-gradient(circle at 78% 34%, rgba(68,146,134,0.3) 0%, rgba(68,146,134,0) 30%)",
    core: "linear-gradient(180deg, rgba(211,239,235,0.98) 0%, rgba(186,224,219,0.96) 100%)",
    model:
      "linear-gradient(180deg, rgba(198,231,226,0.98) 0%, rgba(130,194,184,0.52) 100%)",
    session:
      "linear-gradient(180deg, rgba(154,208,200,0.66) 0%, rgba(211,239,235,0.98) 100%)",
    integrations:
      "linear-gradient(180deg, rgba(221,244,241,1) 0%, rgba(181,222,216,0.98) 100%)",
    trust:
      "radial-gradient(ellipse 100% 120% at 70% 30%, #2d7375 0%, #184c5d 56%, #0e3348 100%)",
  },
  referenceBlueCyanSun: {
    name: "Reference Blue Cyan Sun",
    hero: "linear-gradient(115deg, rgba(223,246,255,0.98) 0%, rgba(27,195,245,0.84) 30%, rgba(10,108,241,0.88) 64%, rgba(0,31,84,0.94) 100%), radial-gradient(circle at 22% 16%, rgba(223,246,255,0.78) 0%, rgba(223,246,255,0) 34%), radial-gradient(circle at 78% 34%, rgba(255,183,3,0.32) 0%, rgba(255,183,3,0) 30%)",
    core: "linear-gradient(180deg, rgba(223,246,255,0.98) 0%, rgba(202,237,249,0.96) 100%)",
    model:
      "linear-gradient(180deg, rgba(217,244,254,0.98) 0%, rgba(27,195,245,0.24) 100%)",
    session:
      "linear-gradient(180deg, rgba(178,229,248,0.72) 0%, rgba(223,246,255,0.98) 100%)",
    integrations:
      "linear-gradient(180deg, rgba(239,250,255,1) 0%, rgba(255,239,176,0.68) 100%)",
    trust:
      "radial-gradient(ellipse 100% 120% at 70% 30%, #0a6cf1 0%, #003a91 52%, #001f54 100%)",
  },
  brightBlueCascade: {
    name: "Bright Blue Cascade",
    hero: "linear-gradient(115deg, rgba(0,84,255,0.98) 0%, rgba(13,97,255,0.96) 45%, rgba(36,119,255,0.94) 100%), radial-gradient(circle at 22% 16%, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0) 34%), radial-gradient(circle at 78% 34%, rgba(223,246,255,0.22) 0%, rgba(223,246,255,0) 30%)",
    core: "linear-gradient(180deg, rgba(75,145,255,0.94) 0%, rgba(119,174,255,0.9) 100%)",
    model:
      "linear-gradient(180deg, rgba(151,197,255,0.88) 0%, rgba(187,219,255,0.9) 100%)",
    session:
      "linear-gradient(180deg, rgba(202,229,255,0.92) 0%, rgba(224,242,255,0.96) 100%)",
    integrations:
      "linear-gradient(180deg, rgba(234,247,255,0.98) 0%, rgba(247,252,255,1) 100%)",
    trust:
      "radial-gradient(ellipse 100% 120% at 70% 30%, #0a55e8 0%, #0840b5 52%, #062b78 100%)",
  },
  royalBlueGlassMono: {
    name: "Royal Blue Glass Mono",
    hero: "linear-gradient(112deg, rgba(255,255,255,0.98) 0%, rgba(255,255,255,0.94) 38%, rgba(210,222,251,0.78) 46%, rgba(17,30,108,0.92) 72%, rgba(17,30,108,0.98) 100%), radial-gradient(ellipse 80% 95% at 18% 86%, rgba(255,255,255,0.76) 0%, rgba(255,255,255,0.24) 34%, rgba(255,255,255,0) 58%), radial-gradient(ellipse 70% 72% at 88% 8%, rgba(4,13,65,0.62) 0%, rgba(4,13,65,0.28) 42%, rgba(4,13,65,0) 72%), linear-gradient(35deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.08) 42%, rgba(255,255,255,0) 74%)",
    core: "linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(246,248,252,0.98) 100%)",
    model:
      "linear-gradient(180deg, rgba(250,252,255,1) 0%, rgba(235,240,248,0.96) 100%)",
    session:
      "linear-gradient(180deg, rgba(241,245,251,0.98) 0%, rgba(255,255,255,1) 100%)",
    integrations:
      "linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(240,244,250,0.98) 100%)",
    trust:
      "radial-gradient(ellipse 100% 120% at 70% 30%, #111e6c 0%, #0b164f 58%, #060d2f 100%)",
  },
  blueSpaceTwoTone: {
    name: "Blue Space Two Tone",
    hero: "linear-gradient(120deg, rgba(255,255,255,0.94) 0%, rgba(232,237,255,0.86) 24%, rgba(0,0,255,0.92) 54%, rgba(29,41,81,0.98) 100%), radial-gradient(ellipse 78% 88% at 18% 84%, rgba(255,255,255,0.74) 0%, rgba(255,255,255,0.2) 34%, rgba(255,255,255,0) 58%), radial-gradient(ellipse 70% 72% at 88% 8%, rgba(7,14,48,0.58) 0%, rgba(7,14,48,0.24) 42%, rgba(7,14,48,0) 72%)",
    core: "linear-gradient(180deg, rgba(247,249,255,1) 0%, rgba(229,235,255,0.98) 100%)",
    model:
      "linear-gradient(180deg, rgba(238,242,255,1) 0%, rgba(206,217,255,0.94) 100%)",
    session:
      "linear-gradient(180deg, rgba(221,229,255,0.96) 0%, rgba(246,248,255,1) 100%)",
    integrations:
      "linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(232,237,250,0.98) 100%)",
    trust:
      "radial-gradient(ellipse 100% 120% at 70% 30%, #1d2951 0%, #111b3c 56%, #080f24 100%)",
  },
  kineticTriad: {
    name: "Kinetic Triad",
    hero: "linear-gradient(118deg, rgba(255,255,255,0.94) 0%, rgba(255,244,228,0.9) 24%, rgba(255,150,26,0.9) 48%, rgba(45,150,142,0.9) 70%, rgba(222,47,40,0.92) 100%), radial-gradient(ellipse 78% 88% at 18% 84%, rgba(255,255,255,0.76) 0%, rgba(255,255,255,0.22) 34%, rgba(255,255,255,0) 58%), radial-gradient(ellipse 70% 72% at 88% 8%, rgba(222,47,40,0.32) 0%, rgba(222,47,40,0.12) 42%, rgba(222,47,40,0) 72%)",
    core: "linear-gradient(180deg, rgba(255,248,237,1) 0%, rgba(238,248,246,0.98) 100%)",
    model:
      "linear-gradient(180deg, rgba(232,247,245,1) 0%, rgba(255,231,212,0.94) 100%)",
    session:
      "linear-gradient(180deg, rgba(255,237,224,0.96) 0%, rgba(238,249,247,1) 100%)",
    integrations:
      "linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(255,243,226,0.98) 100%)",
    trust:
      "radial-gradient(ellipse 100% 120% at 70% 30%, #2d968e 0%, #1f5f5d 48%, #321412 100%)",
  },
  graphiteCyan: {
    name: "Graphite Cyan",
    hero: "linear-gradient(118deg, rgba(238,238,238,0.98) 0%, rgba(238,238,238,0.92) 26%, rgba(0,136,204,0.82) 50%, rgba(102,102,102,0.88) 76%, rgba(0,0,0,0.96) 100%), radial-gradient(ellipse 78% 88% at 18% 84%, rgba(255,255,255,0.78) 0%, rgba(255,255,255,0.22) 34%, rgba(255,255,255,0) 58%), radial-gradient(ellipse 70% 74% at 74% 24%, rgba(0,136,204,0.58) 0%, rgba(0,136,204,0.24) 44%, rgba(0,136,204,0) 76%)",
    core: "linear-gradient(180deg, rgba(238,238,238,1) 0%, rgba(226,242,248,0.98) 100%)",
    model:
      "linear-gradient(180deg, rgba(218,236,244,1) 0%, rgba(151,151,151,0.42) 100%)",
    session:
      "linear-gradient(180deg, rgba(0,136,204,0.18) 0%, rgba(238,238,238,1) 100%)",
    integrations:
      "linear-gradient(180deg, rgba(248,248,248,1) 0%, rgba(230,242,248,0.98) 100%)",
    trust:
      "radial-gradient(ellipse 100% 120% at 70% 30%, #0088cc 0%, #666666 46%, #000000 100%)",
  },
  charcoalRustPowder: {
    name: "Charcoal Rust Powder",
    hero: "linear-gradient(118deg, rgba(255,255,255,0.94) 0%, rgba(232,243,249,0.9) 22%, rgba(144,177,196,0.88) 48%, rgba(128,56,38,0.9) 72%, rgba(38,50,50,0.96) 100%), radial-gradient(ellipse 78% 88% at 18% 84%, rgba(255,255,255,0.72) 0%, rgba(255,255,255,0.22) 34%, rgba(255,255,255,0) 58%), radial-gradient(ellipse 70% 72% at 86% 12%, rgba(38,50,50,0.52) 0%, rgba(38,50,50,0.2) 42%, rgba(38,50,50,0) 72%)",
    core: "linear-gradient(180deg, rgba(241,247,250,1) 0%, rgba(224,237,244,0.98) 100%)",
    model:
      "linear-gradient(180deg, rgba(230,240,246,1) 0%, rgba(216,196,186,0.86) 100%)",
    session:
      "linear-gradient(180deg, rgba(235,219,211,0.88) 0%, rgba(236,245,249,1) 100%)",
    integrations:
      "linear-gradient(180deg, rgba(250,252,253,1) 0%, rgba(226,238,244,0.98) 100%)",
    trust:
      "radial-gradient(ellipse 100% 120% at 70% 30%, #803826 0%, #263232 56%, #111818 100%)",
  },
  solidForestPlumClay: {
    name: "Solid Forest Plum Clay",
    hero: "#3f6739",
    core: "#e9f0d9",
    model: "#5a3a5f",
    session: "#df7c3c",
    integrations: "#e9f0d9",
    trust: "#563e31",
  },
  lushInkSmoke: {
    name: "Lush Ink Smoke",
    hero: "radial-gradient(ellipse 70% 65% at 18% 46%, rgba(6,47,79,0.92) 0%, rgba(6,47,79,0.42) 38%, rgba(6,47,79,0) 68%), radial-gradient(ellipse 62% 58% at 68% 42%, rgba(129,55,114,0.88) 0%, rgba(129,55,114,0.34) 42%, rgba(129,55,114,0) 72%), radial-gradient(ellipse 58% 60% at 72% 78%, rgba(184,38,1,0.86) 0%, rgba(184,38,1,0.36) 44%, rgba(184,38,1,0) 74%), linear-gradient(115deg, #000000 0%, #062f4f 46%, #000000 100%)",
    core: "linear-gradient(180deg, rgba(8,24,35,1) 0%, rgba(6,47,79,0.96) 100%)",
    model:
      "linear-gradient(180deg, rgba(6,47,79,1) 0%, rgba(129,55,114,0.96) 100%)",
    session:
      "linear-gradient(180deg, rgba(129,55,114,0.98) 0%, rgba(184,38,1,0.92) 100%)",
    integrations:
      "linear-gradient(180deg, rgba(18,18,18,1) 0%, rgba(6,47,79,0.94) 100%)",
    trust:
      "radial-gradient(ellipse 100% 120% at 70% 30%, #b82601 0%, #062f4f 46%, #000000 100%)",
  },
  terracottaSage: {
    name: "Terracotta Sage",
    hero: "linear-gradient(118deg, rgba(232,237,214,0.96) 0%, rgba(232,237,214,0.9) 28%, rgba(174,193,177,0.88) 54%, rgba(186,92,73,0.92) 100%), radial-gradient(ellipse 78% 88% at 18% 84%, rgba(255,255,255,0.62) 0%, rgba(255,255,255,0.18) 34%, rgba(255,255,255,0) 58%), radial-gradient(ellipse 70% 72% at 86% 12%, rgba(186,92,73,0.28) 0%, rgba(186,92,73,0.1) 42%, rgba(186,92,73,0) 72%)",
    core: "linear-gradient(180deg, rgba(232,237,214,1) 0%, rgba(219,229,207,0.98) 100%)",
    model:
      "linear-gradient(180deg, rgba(223,232,211,1) 0%, rgba(174,193,177,0.62) 100%)",
    session:
      "linear-gradient(180deg, rgba(224,206,190,0.88) 0%, rgba(232,237,214,1) 100%)",
    integrations:
      "linear-gradient(180deg, rgba(241,244,229,1) 0%, rgba(218,228,210,0.98) 100%)",
    trust:
      "radial-gradient(ellipse 100% 120% at 70% 30%, #ba5c49 0%, #496455 52%, #26382f 100%)",
  },
  heritageGreenBurgundy: {
    name: "Heritage Green Burgundy",
    hero: "linear-gradient(118deg, rgba(235,225,198,0.96) 0%, rgba(235,225,198,0.9) 22%, rgba(78,139,83,0.9) 46%, rgba(111,27,40,0.9) 72%, rgba(44,58,51,0.96) 100%), radial-gradient(ellipse 78% 88% at 18% 84%, rgba(255,255,255,0.58) 0%, rgba(255,255,255,0.16) 34%, rgba(255,255,255,0) 58%), radial-gradient(ellipse 70% 72% at 86% 12%, rgba(111,27,40,0.28) 0%, rgba(111,27,40,0.1) 42%, rgba(111,27,40,0) 72%)",
    core: "linear-gradient(180deg, rgba(235,225,198,1) 0%, rgba(224,218,198,0.98) 100%)",
    model:
      "linear-gradient(180deg, rgba(232,223,204,1) 0%, rgba(186,165,142,0.72) 100%)",
    session:
      "linear-gradient(180deg, rgba(214,199,178,0.88) 0%, rgba(235,225,198,1) 100%)",
    integrations:
      "linear-gradient(180deg, rgba(244,238,222,1) 0%, rgba(224,214,194,0.98) 100%)",
    trust:
      "radial-gradient(ellipse 100% 120% at 70% 30%, #6f1b28 0%, #2c3a33 56%, #17211d 100%)",
  },
  appleMono: {
    name: "Apple Mono",
    hero: "#ffffff",
    core: "linear-gradient(180deg, #f5f5f7 0%, #ffffff 100%)",
    model: "linear-gradient(180deg, #ffffff 0%, #f5f5f7 100%)",
    session: "linear-gradient(180deg, #f5f5f7 0%, #ffffff 100%)",
    integrations: "#ffffff",
    trust: "#d8d8d4",
  },
  appleAirBlue: {
    name: "Apple Air Blue",
    hero: "linear-gradient(180deg, #dff2fb 0%, #edf8fd 48%, #ffffff 100%), radial-gradient(ellipse 72% 62% at 50% 18%, rgba(255,255,255,0.72) 0%, rgba(255,255,255,0) 64%), radial-gradient(ellipse 82% 72% at 18% 28%, rgba(188,225,242,0.36) 0%, rgba(188,225,242,0) 68%)",
    core: "linear-gradient(180deg, #ffffff 0%, #f2f9fd 100%)",
    model: "linear-gradient(180deg, #f2f9fd 0%, #ffffff 100%)",
    session: "linear-gradient(180deg, #ffffff 0%, #edf7fc 100%)",
    integrations: "linear-gradient(180deg, #f5fbfe 0%, #ffffff 100%)",
    trust:
      "radial-gradient(ellipse 100% 120% at 70% 30%, #1b5f86 0%, #0b2f46 58%, #051822 100%)",
  },
  altermindRidge: {
    name: "Altermind Ridge",
    hero: "radial-gradient(ellipse 90% 72% at 50% 18%, rgba(42,86,76,0.26) 0%, rgba(42,86,76,0) 62%), linear-gradient(180deg, #0b2420 0%, #061b18 48%, #03100f 100%)",
    core: "linear-gradient(180deg, #ffffff 0%, #f2f9fd 100%)",
    model: "linear-gradient(180deg, #f2f9fd 0%, #ffffff 100%)",
    session: "linear-gradient(180deg, #ffffff 0%, #edf7fc 100%)",
    integrations: "linear-gradient(180deg, #f5fbfe 0%, #ffffff 100%)",
    trust:
      "radial-gradient(ellipse 100% 120% at 70% 30%, #123c35 0%, #09231f 58%, #03100f 100%)",
  },
  warmSunriseGlass: {
    name: "Warm Sunrise Glass",
    hero: "linear-gradient(115deg, rgba(255,255,255,0.96) 0%, rgba(255,248,231,0.92) 32%, rgba(255,215,156,0.88) 68%, rgba(247,167,88,0.88) 100%), radial-gradient(circle at 24% 18%, rgba(255,255,255,0.84) 0%, rgba(255,255,255,0) 34%), radial-gradient(circle at 76% 30%, rgba(255,238,190,0.36) 0%, rgba(255,238,190,0) 30%)",
    core: "linear-gradient(180deg, rgba(255,249,236,0.98) 0%, rgba(255,244,224,0.96) 100%)",
    model:
      "linear-gradient(180deg, rgba(255,247,231,0.98) 0%, rgba(255,238,210,0.95) 100%)",
    session:
      "linear-gradient(180deg, rgba(255,241,218,0.96) 0%, rgba(255,250,242,0.98) 100%)",
    integrations:
      "linear-gradient(180deg, rgba(255,252,246,1) 0%, rgba(255,245,229,0.98) 100%)",
    trust:
      "radial-gradient(ellipse 100% 120% at 70% 30%, #2a2118 0%, #17130f 62%, #0f0d0a 100%)",
  },
  goldenDaylightGlass: {
    name: "Golden Daylight Glass",
    hero: "linear-gradient(115deg, rgba(255,255,255,0.96) 0%, rgba(255,250,232,0.92) 28%, rgba(250,224,141,0.88) 62%, rgba(230,164,56,0.86) 100%), radial-gradient(circle at 24% 18%, rgba(255,255,255,0.84) 0%, rgba(255,255,255,0) 34%), radial-gradient(circle at 76% 30%, rgba(255,244,183,0.36) 0%, rgba(255,244,183,0) 30%)",
    core: "linear-gradient(180deg, rgba(255,252,239,0.98) 0%, rgba(255,247,220,0.96) 100%)",
    model:
      "linear-gradient(180deg, rgba(255,249,230,0.98) 0%, rgba(250,234,190,0.94) 100%)",
    session:
      "linear-gradient(180deg, rgba(255,244,213,0.96) 0%, rgba(255,251,240,0.98) 100%)",
    integrations:
      "linear-gradient(180deg, rgba(255,253,246,1) 0%, rgba(255,244,215,0.98) 100%)",
    trust:
      "radial-gradient(ellipse 100% 120% at 70% 30%, #2b2415 0%, #17140c 62%, #0f0d08 100%)",
  },
  morningBlue: {
    name: "Morning Blue",
    hero: "linear-gradient(115deg, rgba(255,255,255,0.96) 0%, rgba(234,247,255,0.92) 30%, rgba(181,222,246,0.88) 66%, rgba(139,199,240,0.88) 100%), radial-gradient(circle at 24% 18%, rgba(255,255,255,0.84) 0%, rgba(255,255,255,0) 34%), radial-gradient(circle at 76% 30%, rgba(224,246,255,0.36) 0%, rgba(224,246,255,0) 30%)",
    core: "linear-gradient(180deg, rgba(248,253,255,0.98) 0%, rgba(231,245,253,0.96) 100%)",
    model:
      "linear-gradient(180deg, rgba(242,250,255,0.98) 0%, rgba(218,238,250,0.95) 100%)",
    session:
      "linear-gradient(180deg, rgba(229,244,253,0.96) 0%, rgba(248,253,255,0.98) 100%)",
    integrations:
      "linear-gradient(180deg, rgba(252,254,255,1) 0%, rgba(232,246,254,0.98) 100%)",
    trust:
      "radial-gradient(ellipse 100% 120% at 70% 30%, #173148 0%, #101d2a 62%, #0b121a 100%)",
  },
  pacificGlass: {
    name: "Pacific Glass",
    hero: "linear-gradient(115deg, rgba(248,252,255,0.96) 0%, rgba(216,240,247,0.92) 30%, rgba(143,205,224,0.88) 66%, rgba(75,157,203,0.88) 100%), radial-gradient(circle at 24% 18%, rgba(255,255,255,0.84) 0%, rgba(255,255,255,0) 34%), radial-gradient(circle at 76% 30%, rgba(220,251,255,0.34) 0%, rgba(220,251,255,0) 30%)",
    core: "linear-gradient(180deg, rgba(246,253,255,0.98) 0%, rgba(225,244,248,0.96) 100%)",
    model:
      "linear-gradient(180deg, rgba(239,250,253,0.98) 0%, rgba(207,233,241,0.95) 100%)",
    session:
      "linear-gradient(180deg, rgba(218,241,248,0.96) 0%, rgba(248,253,255,0.98) 100%)",
    integrations:
      "linear-gradient(180deg, rgba(252,254,255,1) 0%, rgba(225,245,250,0.98) 100%)",
    trust:
      "radial-gradient(ellipse 100% 120% at 70% 30%, #143642 0%, #0d2028 62%, #071419 100%)",
  },
  monochromePacific: {
    name: "Monochrome Pacific",
    hero: "linear-gradient(115deg, rgba(250,254,255,0.98) 0%, rgba(225,246,251,0.94) 28%, rgba(158,215,229,0.9) 62%, rgba(61,151,179,0.9) 100%), radial-gradient(circle at 24% 18%, rgba(255,255,255,0.78) 0%, rgba(255,255,255,0) 34%), radial-gradient(circle at 76% 30%, rgba(211,244,250,0.34) 0%, rgba(211,244,250,0) 30%)",
    core: "linear-gradient(180deg, rgba(247,253,255,0.98) 0%, rgba(226,245,250,0.96) 100%)",
    model:
      "linear-gradient(180deg, rgba(236,249,252,0.98) 0%, rgba(205,233,241,0.95) 100%)",
    session:
      "linear-gradient(180deg, rgba(219,240,246,0.96) 0%, rgba(246,253,255,0.98) 100%)",
    integrations:
      "linear-gradient(180deg, rgba(251,254,255,1) 0%, rgba(225,244,249,0.98) 100%)",
    trust:
      "radial-gradient(ellipse 100% 120% at 70% 30%, #1a5263 0%, #113542 58%, #09212a 100%)",
  },
  monochromeGrey: {
    name: "Monochrome Grey",
    hero: "linear-gradient(115deg, rgba(226,228,230,0.98) 0%, rgba(198,202,205,0.94) 30%, rgba(149,156,162,0.92) 66%, rgba(78,86,93,0.94) 100%), radial-gradient(circle at 24% 18%, rgba(255,255,255,0.48) 0%, rgba(255,255,255,0) 34%), radial-gradient(circle at 76% 30%, rgba(214,217,220,0.22) 0%, rgba(214,217,220,0) 30%)",
    core: "linear-gradient(180deg, rgba(218,220,222,0.98) 0%, rgba(198,202,205,0.96) 100%)",
    model:
      "linear-gradient(180deg, rgba(205,209,212,0.98) 0%, rgba(171,177,182,0.95) 100%)",
    session:
      "linear-gradient(180deg, rgba(184,190,195,0.96) 0%, rgba(213,216,219,0.98) 100%)",
    integrations:
      "linear-gradient(180deg, rgba(224,226,228,1) 0%, rgba(188,194,199,0.98) 100%)",
    trust:
      "radial-gradient(ellipse 100% 120% at 70% 30%, #24272a 0%, #141618 58%, #070808 100%)",
  },
  clearSky: {
    name: "Clear Sky",
    hero: "linear-gradient(115deg, rgba(255,255,255,0.96) 0%, rgba(233,246,255,0.92) 30%, rgba(170,219,246,0.88) 66%, rgba(106,183,232,0.88) 100%), radial-gradient(circle at 24% 18%, rgba(255,255,255,0.84) 0%, rgba(255,255,255,0) 34%), radial-gradient(circle at 76% 30%, rgba(224,246,255,0.36) 0%, rgba(224,246,255,0) 30%)",
    core: "linear-gradient(180deg, rgba(249,253,255,0.98) 0%, rgba(232,246,255,0.96) 100%)",
    model:
      "linear-gradient(180deg, rgba(243,250,255,0.98) 0%, rgba(214,237,251,0.95) 100%)",
    session:
      "linear-gradient(180deg, rgba(225,242,253,0.96) 0%, rgba(249,253,255,0.98) 100%)",
    integrations:
      "linear-gradient(180deg, rgba(252,254,255,1) 0%, rgba(231,246,255,0.98) 100%)",
    trust:
      "radial-gradient(ellipse 100% 120% at 70% 30%, #16324c 0%, #0e1e2e 62%, #08131e 100%)",
  },
  blueMist: {
    name: "Blue Mist",
    hero: "linear-gradient(115deg, rgba(250,252,255,0.96) 0%, rgba(226,238,247,0.92) 32%, rgba(185,207,225,0.88) 68%, rgba(138,175,203,0.88) 100%), radial-gradient(circle at 24% 18%, rgba(255,255,255,0.84) 0%, rgba(255,255,255,0) 34%), radial-gradient(circle at 76% 30%, rgba(235,246,255,0.34) 0%, rgba(235,246,255,0) 30%)",
    core: "linear-gradient(180deg, rgba(249,252,255,0.98) 0%, rgba(235,243,249,0.96) 100%)",
    model:
      "linear-gradient(180deg, rgba(244,249,252,0.98) 0%, rgba(223,234,243,0.95) 100%)",
    session:
      "linear-gradient(180deg, rgba(231,240,247,0.96) 0%, rgba(250,252,255,0.98) 100%)",
    integrations:
      "linear-gradient(180deg, rgba(253,254,255,1) 0%, rgba(235,244,250,0.98) 100%)",
    trust:
      "radial-gradient(ellipse 100% 120% at 70% 30%, #243445 0%, #151f2a 62%, #0d141c 100%)",
  },
  optimistBlue: {
    name: "Optimist Blue",
    hero: "linear-gradient(115deg, rgba(255,255,255,0.96) 0%, rgba(230,247,255,0.92) 28%, rgba(151,220,246,0.88) 62%, rgba(59,167,224,0.88) 100%), radial-gradient(circle at 24% 18%, rgba(255,255,255,0.84) 0%, rgba(255,255,255,0) 34%), radial-gradient(circle at 76% 30%, rgba(219,249,255,0.36) 0%, rgba(219,249,255,0) 30%)",
    core: "linear-gradient(180deg, rgba(248,253,255,0.98) 0%, rgba(226,246,255,0.96) 100%)",
    model:
      "linear-gradient(180deg, rgba(241,251,255,0.98) 0%, rgba(205,238,251,0.95) 100%)",
    session:
      "linear-gradient(180deg, rgba(218,242,252,0.96) 0%, rgba(248,253,255,0.98) 100%)",
    integrations:
      "linear-gradient(180deg, rgba(252,254,255,1) 0%, rgba(225,247,255,0.98) 100%)",
    trust:
      "radial-gradient(ellipse 100% 120% at 70% 30%, #12364c 0%, #0b2130 62%, #06151f 100%)",
  },
} as const;

const productPalette = PRODUCT_PAGE_PALETTES.appleMono;

export default function ProductPage() {
  return (
    <Shell>
      {/* Structured data: WebPage + BreadcrumbList for rich-result
          eligibility. Organization + WebSite schemas already render
          globally from app/layout.tsx. */}
      <JsonLd
        data={[
          webPageSchema({
            url: `${SITE_URL}/product`,
            name: "How Relay works",
            description:
              "Three phases. One team. Same engineer the whole way, from build through launch through ongoing maintenance.",
          }),
          breadcrumbSchema([
            { name: "Home", href: "/" },
            { name: "How it works", href: "/product" },
          ]),
        ]}
      />

      {/* Page-local CSS, scroll-triggered fade-ups + hover effects.
          animation-timeline: view() in supporting browsers; staggered
          delays as fallback. prefers-reduced-motion turns it all off. */}
      <style>{`
        :root {
          --green: #4d6b40;
          --green-bright: #4d6b40;
          --green-deep: #3f5c34;
          --green-tint: rgba(77, 107, 64, 0.1);
          --cream: #f5f5f7;
          --paper: #ffffff;
          --rule: rgba(0, 0, 0, 0.12);
        }

        @keyframes prod-fade-up {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes prod-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes underline-grow {
          from { transform: scaleX(0); }
          to   { transform: scaleX(1); }
        }
        .prod-fade {
          opacity: 0;
          animation: prod-fade-up 0.6s cubic-bezier(0.2, 0.7, 0.2, 1) forwards;
        }
        .prod-fade-1 { animation-delay: 0.05s; }
        .prod-fade-2 { animation-delay: 0.15s; }
        .prod-fade-3 { animation-delay: 0.25s; }
        .prod-fade-4 { animation-delay: 0.35s; }
        @supports (animation-timeline: view()) {
          .prod-fade {
            animation-timeline: view();
            animation-range: entry 0% entry 50%;
            animation-delay: 0s !important;
          }
        }

        .audience-card {
          background: #ffffff;
          border: 1px solid var(--rule);
          border-radius: 8px;
          padding: 32px;
          display: flex;
          flex-direction: column;
          position: relative;
          overflow: hidden;
          transition: transform 0.35s cubic-bezier(0.2, 0.7, 0.2, 1),
            box-shadow 0.35s cubic-bezier(0.2, 0.7, 0.2, 1),
            border-color 0.25s ease;
        }
        .audience-card::before {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: 8px;
          background: linear-gradient(
            135deg,
            rgba(0, 0, 0, 0.04) 0%,
            transparent 60%
          );
          opacity: 0;
          transition: opacity 0.35s ease;
          pointer-events: none;
        }
        .audience-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 16px 36px rgba(0, 0, 0, 0.08);
          border-color: rgba(0, 0, 0, 0.22);
        }
        .audience-card:hover::before {
          opacity: 1;
        }
        .audience-card-icon {
          color: var(--green-deep);
          width: 28px;
          height: 28px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 18px;
          transition: transform 0.35s cubic-bezier(0.2, 0.7, 0.2, 1);
        }
        .audience-card:hover .audience-card-icon {
          transform: scale(1.08) rotate(-2deg);
        }

        .product-card-surface {
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.035),
            0 18px 48px rgba(0, 0, 0, 0.045);
        }

        .product-card-surface:hover {
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.045),
            0 26px 60px rgba(0, 0, 0, 0.07);
          transform: translateY(-2px);
        }

        .product-card-surface {
          transition: transform 0.32s cubic-bezier(0.2, 0.7, 0.2, 1),
            box-shadow 0.32s cubic-bezier(0.2, 0.7, 0.2, 1);
        }

        .hero-scroll-hint::selection {
          background: transparent;
        }

        @media (max-width: 640px) {
          .core-sequence-heading {
            white-space: normal !important;
          }
        }

        .trust-pillar {
          position: relative;
          padding-top: 14px;
        }
        .trust-pillar::before {
          content: "";
          position: absolute;
          left: 0;
          top: 0;
          width: 28px;
          height: 2px;
          background: var(--green);
          transform-origin: left center;
          transform: scaleX(0);
          animation: underline-grow 0.5s cubic-bezier(0.2, 0.7, 0.2, 1) 0.2s
            forwards;
        }
        @supports (animation-timeline: view()) {
          .trust-pillar::before {
            animation: underline-grow 0.5s cubic-bezier(0.2, 0.7, 0.2, 1)
              forwards;
            animation-timeline: view();
            animation-range: entry 10% entry 60%;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .prod-fade,
          .trust-pillar::before {
            opacity: 1;
            transform: none !important;
            animation: none !important;
          }
          .audience-card,
          .audience-card-icon,
          .product-card-surface {
            transition: none;
          }
        }
      `}</style>

      {/* HERO — centered editorial hero. Eyebrow + two-line headline +
          lede + a large green "press" disc that anchors the page's
          gesture. The disc is non-functional decor here; the real Try
          Relay flow is opened from the nav. */}
      <section
        className="r-product-hero"
        style={{
          background: "var(--paper)",
          padding: "76px 0 58px",
          textAlign: "left",
        }}
      >
        <div className="r-wrap" style={{ maxWidth: 1180, margin: "0 auto" }}>
          <div
            className="r-product-hero-layout"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.05fr) minmax(300px, 0.72fr)",
              gap: 64,
              alignItems: "center",
            }}
          >
            <div>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 10,
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--ink-mute)",
                  marginBottom: 18,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: "var(--green)",
                    display: "inline-block",
                  }}
                  aria-hidden="true"
                />
                How Relay works
              </div>
              <h1
                className="r-h-display"
                style={{
                  margin: 0,
                  fontSize: "clamp(40px, 5.2vw, 68px)",
                  letterSpacing: "-0.04em",
                  lineHeight: 0.98,
                  maxWidth: "16ch",
                }}
              >
                One Press.
                <br />
                One Engineer.
                <br />
                <em
                  style={{
                    color: "var(--green-deep)",
                    display: "inline-block",
                    fontSize: "clamp(30px, 3.6vw, 48px)",
                    fontStyle: "italic",
                    lineHeight: 1.04,
                    marginTop: 6,
                  }}
                >
                  From being stuck to
                  <br />
                  solution ready in real time.
                </em>
              </h1>
              <p
                style={{
                  margin: "22px 0 0",
                  fontSize: "clamp(16px, 1.35vw, 20px)",
                  lineHeight: 1.45,
                  color: "var(--ink-soft)",
                  maxWidth: "48ch",
                }}
              >
                Here’s exactly what happens when you press the green button, and
                why it’s the fastest way to turn an AI build session into
                robust, scalable, secure, working software.
              </p>
            </div>

            <div
              className="r-product-orb-card"
              style={{
                justifySelf: "end",
                width: "min(100%, 460px)",
                minHeight: 440,
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "#06090a",
                boxShadow:
                  "0 1px 2px rgba(0,0,0,0.3), 0 24px 70px rgba(0,0,0,0.4), 0 0 80px -20px rgba(77,200,109,0.18)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 28,
                padding: 44,
              }}
            >
              <ProductHeroOrb />
              <span
                className="hero-scroll-hint"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "rgba(244, 242, 238, 0.6)",
                  background: "transparent",
                  userSelect: "none",
                }}
              >
                PRESS TO START RELAY
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* THE CORE MECHANIC — vertical 4-step timeline. Each step is a
          numbered green disc on the left rail + a card on the right
          with title, body, and optional chips. Lines between discs
          give the section its "relay" gesture. Anchor id matches the
          hero's "Scroll to see the full flow" link. */}
      <section
        id="core-mechanic"
        className="r-section"
        style={{
          borderTop: "none",
          background: productPalette.core,
          padding: "88px 0",
        }}
      >
        <div className="r-wrap" style={{ maxWidth: 960, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 64 }}>
            <h2
              className="r-h-1 core-sequence-heading"
              style={{
                margin: "0 auto",
                fontSize: "clamp(26px, 3vw, 42px)",
                letterSpacing: "-0.026em",
                lineHeight: 1.03,
                maxWidth: "none",
                whiteSpace: "nowrap",
              }}
            >
              Press, Match, Join, Solve, Deploy, Maintain
            </h2>
          </div>

          {/* Timeline rows */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            {[
              {
                n: 1,
                title: "You press the green button",
                body: (
                  <>
                    You’re in Claude, Cursor, Lovable, Replit, v0, Bolt,
                    wherever you build with AI. You hit a wall: a deployment
                    error, a CORS issue, a database design question. You don’t
                    post on Discord and wait. You press{" "}
                    <span
                      style={{
                        display: "inline-block",
                        width: "0.7em",
                        height: "0.7em",
                        borderRadius: 999,
                        background: "var(--green)",
                        verticalAlign: "middle",
                        margin: "0 1px",
                      }}
                      aria-hidden="true"
                    />
                    .
                  </>
                ),
                chips: [
                  "Claude",
                  "Cursor",
                  "Lovable",
                  "Replit",
                  "v0",
                  "Bolt",
                  "+140 more",
                ].map((label) => (
                  <span
                    key={label}
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      color: "var(--ink-soft)",
                      padding: "4px 12px",
                      borderRadius: 999,
                      background: "var(--paper)",
                      border: "1px solid var(--rule)",
                    }}
                  >
                    {label}
                  </span>
                )),
              },
              {
                n: 2,
                title: "We match you with the right engineer",
                body: (
                  <>
                    Relay reads your stack context, what AI tool you’re using,
                    what framework, what infrastructure. In under 3 minutes, we
                    route you to a qualified human engineer who knows your exact
                    stack. A real engineer with production experience on the
                    tools you’re using.
                  </>
                ),
                chips: [
                  {
                    label: "Average match: 8.2s",
                    icon: (
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="var(--green-deep)"
                        aria-hidden="true"
                      >
                        <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
                      </svg>
                    ),
                  },
                  {
                    label: "Stack-verified engineer",
                    icon: (
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--green-deep)"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <path d="M8 12l3 3 5-6" />
                      </svg>
                    ),
                  },
                ].map((c) => (
                  <span
                    key={c.label}
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      color: "var(--ink-soft)",
                      padding: "4px 12px 4px 10px",
                      borderRadius: 999,
                      background: "var(--cream-2)",
                      border: "1px solid var(--rule)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    {c.icon}
                    {c.label}
                  </span>
                )),
              },
              {
                n: 3,
                title: "Engineer joins your session",
                body: (
                  <>
                    They appear in your Relay session, chat, voice, or screen
                    share. They can see your code, your error messages, your
                    architecture. They don’t need 20 minutes of context. They
                    jump straight in because Relay pre-loads your stack and
                    build state. You’re coding again in under a minute.
                  </>
                ),
                chips: [
                  {
                    label: "Chat",
                    icon: (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--green-deep)"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M3 5h18v11H7l-4 4z" />
                      </svg>
                    ),
                  },
                  {
                    label: "Voice",
                    icon: (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--green-deep)"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <rect x="9" y="3" width="6" height="11" rx="3" />
                        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                      </svg>
                    ),
                  },
                  {
                    label: "Screen share",
                    icon: (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--green-deep)"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <rect x="3" y="4" width="18" height="13" rx="2" />
                        <path d="M8 21h8M12 17v4" />
                      </svg>
                    ),
                  },
                ].map((c) => (
                  <span
                    key={c.label}
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      color: "var(--ink-soft)",
                      padding: "4px 12px 4px 10px",
                      borderRadius: 999,
                      background: "var(--cream-2)",
                      border: "1px solid var(--rule)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    {c.icon}
                    {c.label}
                  </span>
                )),
              },
              {
                n: 4,
                title: "Ship it, and they stay with you",
                body: (
                  <>
                    The fix is in. The feature works. You deploy. Here’s what’s
                    different from every other help model:{" "}
                    <strong style={{ color: "var(--ink)", fontWeight: 600 }}>
                      the same engineer stays connected to your project.
                    </strong>{" "}
                    They remember your stack, your preferences, your
                    architecture. Next time you press the dot, it’s the same
                    person, no re-explaining, no context loss.
                  </>
                ),
                chips: null as React.ReactNode,
              },
            ].map((step, i, arr) => (
              <div
                key={step.n}
                style={{ display: "flex", gap: 24, alignItems: "stretch" }}
              >
                {/* Left rail: number disc + connecting line */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    flexShrink: 0,
                    width: 32,
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 999,
                      background: "var(--green)",
                      color: "var(--cream)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: "var(--font-sans)",
                      fontWeight: 600,
                      fontSize: 14,
                      flexShrink: 0,
                    }}
                  >
                    {step.n}
                  </div>
                  {i < arr.length - 1 && (
                    <div
                      style={{
                        flex: 1,
                        width: 2,
                        background: "var(--green)",
                        opacity: 0.45,
                        marginTop: 6,
                        marginBottom: 0,
                      }}
                    />
                  )}
                </div>

                {/* Card */}
                <div
                  className="product-card-surface"
                  style={{
                    flex: 1,
                    background: "var(--paper)",
                    border: "1px solid var(--rule)",
                    borderRadius: 8,
                    padding: "26px 30px",
                    marginBottom: i < arr.length - 1 ? 22 : 0,
                  }}
                >
                  <h3
                    style={{
                      fontFamily: "var(--font-sans)",
                      fontWeight: 600,
                      fontSize: 19,
                      letterSpacing: "-0.005em",
                      margin: "0 0 12px",
                      color: "var(--ink)",
                    }}
                  >
                    {step.title}
                  </h3>
                  <p
                    style={{
                      fontSize: 14,
                      lineHeight: 1.68,
                      color: "var(--ink-soft)",
                      margin: 0,
                    }}
                  >
                    {step.body}
                  </p>
                  {step.chips && (
                    <div
                      style={{
                        marginTop: 14,
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 8,
                      }}
                    >
                      {step.chips}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* THE RELAY MODEL — three-phase pricing/commitment cards.
          Centered eyebrow + two-line headline + lede; three cards in
          a row, each with a small icon badge, phase label, title,
          body, 3-bullet list, and a green price footer. Cards on
          paper bg, hairline borders, no nested chrome. */}
      <section
        className="r-section"
        style={{
          background: productPalette.model,
          borderTop: "1px solid var(--rule)",
          padding: "88px 0",
        }}
      >
        <div className="r-wrap" style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 56 }}>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--green-deep)",
                marginBottom: 14,
              }}
            >
              The Relay model
            </div>
            <h2
              className="r-h-1"
              style={{
                margin: "0 auto",
                fontSize: "clamp(30px, 3.4vw, 48px)",
                letterSpacing: "-0.026em",
                lineHeight: 1.04,
                maxWidth: "40ch",
              }}
            >
              Three phases. One Engineering Team.
              <br />
              <em style={{ color: "var(--green-deep)", fontStyle: "italic" }}>
                All the way from build to scale.
              </em>
            </h2>
            <p
              style={{
                margin: "18px auto 0",
                maxWidth: "60ch",
                fontSize: 15,
                lineHeight: 1.6,
                color: "var(--ink-soft)",
              }}
            >
              Relay isn’t a one-and-done help desk. It’s an engineering
              relationship that follows your product from idea to production,
              with the same person / team who know your code.
            </p>
          </div>

          <div
            className="r-grid-collapse-md"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 0,
              alignItems: "stretch",
            }}
          >
            {[
              {
                phase: "Phase 1",
                title: "Build",
                body: "On-demand sessions while your AI takes a build from concept to MVP. Every time you’re stuck, a bug, a config issue, a design decision, one press gets you unstuck.",
                bullets: [
                  "Pay-per-session or bundled credits",
                  "Same engineer assigned to your project",
                  "Avg. session: 25 minutes to resolution",
                ],
                icon: (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--green-deep)"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M14.7 6.3a4 4 0 0 1-5 5l-7 7 2 2 7-7a4 4 0 0 1 5-5L14.7 6.3z" />
                  </svg>
                ),
              },
              {
                phase: "Phase 2",
                title: "Launch",
                body: "When your MVP is ready and you need to go live, your engineer takes over the production-readiness work. Fixed scope, fixed timeline, predictable outcome.",
                bullets: [
                  "CI/CD, auth, monitoring, error handling",
                  "Security audit & compliance checklist",
                  "Fixed scope with clear deliverable gates",
                ],
                icon: (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--green-deep)"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M4.5 16.5L3 21l4.5-1.5M14 7l3 3M21 3l-1 6-9 9-3-3 9-9 4-3z" />
                  </svg>
                ),
              },
              {
                phase: "Phase 3",
                title: "Maintain",
                body: "Your product is live. Your engineer stays on a monthly retainer, monitoring, patching, iterating. They know the codebase better than anyone.",
                bullets: [
                  "Monthly retainer with SLA guarantees",
                  "Proactive monitoring & incident response",
                  "Feature iteration without context loss",
                ],
                icon: (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--green-deep)"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" />
                  </svg>
                ),
              },
            ].map((card) => (
              <div
                key={card.phase}
                className="product-card-surface enterprise-card-surface"
                style={{
                  background: "var(--paper)",
                  border: "1px solid var(--rule)",
                  borderRadius: 8,
                  padding: 32,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: "var(--paper)",
                    border: "1px solid var(--rule)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 18,
                  }}
                >
                  {card.icon}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10.5,
                    letterSpacing: "0.10em",
                    textTransform: "uppercase",
                    color: "var(--ink-mute)",
                    marginBottom: 8,
                  }}
                >
                  {card.phase}
                </div>
                <h3
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontWeight: 600,
                    fontSize: 22,
                    letterSpacing: "-0.008em",
                    margin: "0 0 12px",
                    color: "var(--ink)",
                  }}
                >
                  {card.title}
                </h3>
                <p
                  style={{
                    fontSize: 14,
                    lineHeight: 1.6,
                    color: "var(--ink-soft)",
                    margin: "0 0 16px",
                  }}
                >
                  {card.body}
                </p>
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: "0 0 20px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    flex: 1,
                  }}
                >
                  {card.bullets.map((b) => (
                    <li
                      key={b}
                      style={{
                        fontSize: 13,
                        lineHeight: 1.5,
                        color: "var(--ink-soft)",
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 8,
                      }}
                    >
                      <span
                        style={{
                          width: 5,
                          height: 5,
                          borderRadius: 999,
                          background: "var(--green)",
                          display: "inline-block",
                          marginTop: 8,
                          flexShrink: 0,
                        }}
                        aria-hidden="true"
                      />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* INSIDE A SESSION section removed per request. */}

      {/* TRUST, AI for speed. Engineers for trust. — moved here so the
          dark band lands after the page has shown the full operational
          arc (Build/Ship/Evolve, Modalities, Zoom, Integrations).
          Reads as the "trust earned" moment before the closing climax. */}
      <section
        className="r-proof-band r-proof-band-product"
        style={{
          color: "var(--ink)",
        }}
      >
        <div className="r-wrap">
          <div
            className="r-grid-collapse-md r-proof-shell"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 0.92fr) minmax(0, 1.35fr)",
              gap: 56,
              alignItems: "start",
            }}
          >
            <div className="prod-fade r-proof-intro">
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 10,
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--ink-mute)",
                  marginBottom: 16,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: "var(--green)",
                    display: "inline-block",
                  }}
                  aria-hidden="true"
                />
                Built to trust
              </div>
              <h2
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 400,
                  margin: "0 0 20px",
                  fontSize: "clamp(32px, 3.8vw, 52px)",
                  letterSpacing: "-0.032em",
                  lineHeight: 0.98,
                  maxWidth: "15ch",
                  color: "var(--ink)",
                }}
              >
                AI for speed.{" "}
                <em
                  style={{
                    color: "var(--green)",
                    fontStyle: "italic",
                  }}
                >
                  Engineers for trust.
                </em>
              </h2>
              <p
                style={{
                  fontSize: 15,
                  lineHeight: 1.62,
                  color: "var(--ink-soft)",
                  maxWidth: "44ch",
                  margin: 0,
                }}
              >
                <RelayLogo size={13} color="var(--ink)" /> stays with you. Same
                engineer in build, launch, and maintenance, continuity is the
                whole company.
              </p>
            </div>

            <div
              className="r-proof-cards"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 12,
              }}
            >
              {TRUST_PILLARS.map((p, i) => (
                <div
                  key={p.title}
                  className={`trust-pillar r-proof-card prod-fade prod-fade-${i + 1}`}
                  style={{ color: "var(--ink)" }}
                >
                  <h4
                    style={{
                      fontFamily: "var(--font-sans)",
                      fontSize: 15,
                      fontWeight: 600,
                      color: "var(--ink)",
                      letterSpacing: "-0.005em",
                      margin: "0 0 10px",
                    }}
                  >
                    {p.title}
                  </h4>
                  <p
                    style={{
                      fontSize: 13.5,
                      lineHeight: 1.6,
                      color: "var(--ink-soft)",
                      margin: 0,
                    }}
                  >
                    {p.body}
                  </p>
                </div>
              ))}
            </div>

            {/* Centered press-the-dot block — spans both columns of the
                shell grid so the ball sits at the visual center of the
                section, with the headline + CTA stacked beneath it. */}
            <div style={{ gridColumn: "1 / -1", marginTop: 24 }}>
              <BuiltToTrustCenter />
            </div>
          </div>
        </div>
      </section>
    </Shell>
  );
}
