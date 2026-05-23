import type { MetadataRoute } from "next";

/*
 * Web App Manifest for Relay. Served at /manifest.webmanifest.
 *
 * theme_color and background_color match the current white/graphite
 * marketing surface. The green dot remains the in-page identity mark.
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
    theme_color: "#111111",
    icons: [
      { src: "/icon", sizes: "32x32", type: "image/png" },
      { src: "/icon", sizes: "192x192", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
      { src: "/favicon.ico", sizes: "any", type: "image/x-icon" },
    ],
  };
}
