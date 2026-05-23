"use client";

/*
 * Hero-side card for the Contact Us page: a soft-shadowed white plate
 * holding the large green sphere button + a mono "PRESS TO START RELAY"
 * caption. Reuses .r-press-sphere from marketing.css for the gradient
 * ball look + the squish-bounce press animation (toggled via
 * .is-pressing). On click, opens the global Try Relay modal.
 */

import { useRef } from "react";
import { useTryRelay } from "../../_marketing/TryRelayProvider";

export function HeroDot() {
  const { open } = useTryRelay();
  const ref = useRef<HTMLButtonElement>(null);

  function handlePress() {
    const el = ref.current;
    if (el) {
      el.classList.remove("is-pressing");
      void el.offsetWidth;
      el.classList.add("is-pressing");
    }
    open();
  }

  return (
    <div className="r-hero-dot-card">
      <button
        ref={ref}
        type="button"
        className="r-press-sphere r-hero-dot-sphere"
        onClick={handlePress}
        onAnimationEnd={() => ref.current?.classList.remove("is-pressing")}
        aria-label="Press the dot to start a Relay session"
      />
      <p className="r-hero-dot-caption">Press to start Relay</p>
    </div>
  );
}
