"use client";

/*
 * Initializes AOS (Animate-On-Scroll) once on the client. Any element
 * anywhere in the app can opt in by adding the standard `data-aos="..."`
 * attribute (fade-up, fade-in, zoom-in, etc.). Re-running `refresh` on
 * route changes ensures newly-mounted elements pick up their animations
 * without a hard reload.
 *
 * The CSS is imported here (not in globals.css) so it only ships when
 * the bundle actually mounts this component — which is the whole app
 * via root layout, but lazy-loading keeps the import explicit.
 */

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import AOS from "aos";
import "aos/dist/aos.css";

export function AosProvider() {
  const pathname = usePathname();

  useEffect(() => {
    AOS.init({
      duration:    520,        // ms
      easing:      "ease-out-cubic",
      once:        true,       // animate once per element
      offset:      40,
      delay:       0,
      disable:     "phone",    // skip on small/old mobiles for perf
    });
  }, []);

  // Re-scan the DOM on every route change so newly-rendered children
  // animate in instead of staying at opacity:0.
  useEffect(() => {
    AOS.refreshHard();
  }, [pathname]);

  return null;
}
