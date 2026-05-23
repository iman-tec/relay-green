"use client";

/*
 * Closing CTA above the footer. Lead with the message ("AI changed who can
 * build. Relay changes the way they ship."), then a supporting line, then
 * the big green sphere as the interactive object, and finally a quiet
 * "One press. That's it." caption. The sphere opens the Try Relay modal.
 */

import { useRef } from "react";
import { useTryRelay } from "./TryRelayProvider";

export function PressTheDot() {
  const { open } = useTryRelay();
  const sphereRef = useRef<HTMLButtonElement>(null);

  function handlePress() {
    const el = sphereRef.current;
    if (el) {
      // Toggle the animation class with a reflow so a rapid second click
      // restarts the press animation instead of being swallowed mid-play.
      el.classList.remove("is-pressing");
      void el.offsetWidth;
      el.classList.add("is-pressing");
    }
    open();
  }

  return (
    <section className="r-press" aria-label="Start a Relay session">
      <div className="r-press-stage">
        <h2 className="r-press-h">
          AI changed <em>who</em> can build.
          <br />
          Relay changes <em className="r-press-h-accent">the way</em> they ship.
        </h2>
        <p className="r-press-sub">
          First session is free. An engineer joins in seconds. Same person stays
          with you from build to shipped to running.
        </p>
        <button
          ref={sphereRef}
          type="button"
          className="r-press-sphere"
          onClick={handlePress}
          onAnimationEnd={() =>
            sphereRef.current?.classList.remove("is-pressing")
          }
          aria-label="Press the dot to start a Relay session"
        />
        <p className="r-press-caption">One press. That&rsquo;s it.</p>
      </div>
    </section>
  );
}
