import type { MetadataRoute } from "next";

/*
 * Web App Manifest for Relay. Served at /manifest.webmanifest.
 *
 * theme_color is the brand green (--green = #4d6b40, same token as the
 * dot, italic emphasis, and primary CTA). Android sets the URL-bar tint
 * and Add-to-Home-Screen splash from this, so it reads as "the green dot
 * brand" the moment a visitor saves the site. background_color stays
 * paper-white so the splash doesn't flash a saturated card.
 *
 * This file is the SINGLE source of truth. The legacy static file at
 * public/manifest.webmanifest was removed in the pre-launch QA pass; do
 * not reintroduce one (the static file would win the URL silently and
 * this generator would become dead code).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Relay",
    short_name: "Relay",
    description:
      "Press once. A software engineer joins your AI build in seconds, and stays with you from build to shipped to running.",
    start_url: "/",
    scope: "/",
    display: "browser",
    background_color: "#ffffff",
    theme_color: "#4d6b40",
    icons: [
      { src: "/icon", sizes: "32x32", type: "image/png" },
      { src: "/icon", sizes: "192x192", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
      { src: "/favicon.ico", sizes: "any", type: "image/x-icon" },
    ],
  };
}
