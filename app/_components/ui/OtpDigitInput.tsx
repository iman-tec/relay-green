"use client";

/*
 * OtpDigitInput — discrete digit boxes for one-time codes.
 *
 * - Customer first-time signup uses an 8-digit code.
 * - Staff login uses an 8-digit code.
 *
 * Behavior:
 *  - Typing a digit auto-advances to the next box.
 *  - Backspace clears the current box; if already empty, jumps back.
 *  - Left/Right arrow keys move focus.
 *  - Pasting an N-digit string fills all boxes from the focused position.
 *  - `inputMode="numeric"` + `autoComplete="one-time-code"` lights up
 *    iOS/Android keyboards + the SMS autofill suggestion.
 *
 * The value is plumbed up as a single concatenated string. The submit
 * call-site (SignInForm, StaffLoginForm) keeps its existing endpoint
 * shape — this component only changes the visual + UX, not the wire.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { cn } from "./cn";

export interface OtpDigitInputProps {
  length?: number;
  value: string;
  onChange: (next: string) => void;
  /** Fires when the user finishes (length matches). Useful for auto-submit. */
  onComplete?: (full: string) => void;
  label?: string;
  /** Visually hide the label but keep it for screen readers. */
  srLabelOnly?: boolean;
  error?: string;
  hint?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}

export function OtpDigitInput({
  length = 8,
  value,
  onChange,
  onComplete,
  label = "One-time code",
  srLabelOnly = false,
  error,
  hint,
  disabled = false,
  autoFocus = false,
}: OtpDigitInputProps) {
  const groupId = useId();
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const [focused, setFocused] = useState(false);

  // Normalize the controlled value to exactly `length` characters (digits or "").
  const digits: string[] = Array.from({ length }, (_, i) => value[i] ?? "");

  useEffect(() => {
    if (autoFocus && refs.current[0]) {
      refs.current[0].focus();
    }
  }, [autoFocus]);

  const focusIndex = useCallback((i: number) => {
    const target = refs.current[Math.max(0, Math.min(length - 1, i))];
    target?.focus();
    target?.select();
  }, [length]);

  const writeAt = useCallback(
    (index: number, ch: string) => {
      const next = digits.slice();
      next[index] = ch;
      const joined = next.join("");
      onChange(joined);
      if (joined.length === length && !joined.includes("") && onComplete) {
        onComplete(joined);
      }
    },
    [digits, length, onChange, onComplete],
  );

  const handleChange = (index: number, raw: string) => {
    const digit = raw.replace(/\D/g, "").slice(-1);
    writeAt(index, digit);
    if (digit) focusIndex(index + 1);
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      if (digits[index]) {
        writeAt(index, "");
      } else {
        focusIndex(index - 1);
        writeAt(Math.max(0, index - 1), "");
      }
      e.preventDefault();
    } else if (e.key === "ArrowLeft") {
      focusIndex(index - 1);
      e.preventDefault();
    } else if (e.key === "ArrowRight") {
      focusIndex(index + 1);
      e.preventDefault();
    } else if (e.key === "Enter") {
      // Submission is left to the parent form's onSubmit.
    }
  };

  const handlePaste = (index: number, e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text").replace(/\D/g, "");
    if (!text) return;
    e.preventDefault();
    const next = digits.slice();
    for (let i = 0; i < text.length && index + i < length; i++) {
      next[index + i] = text[i];
    }
    const joined = next.join("").slice(0, length);
    onChange(joined);
    const nextFocus = Math.min(length - 1, index + text.length);
    focusIndex(nextFocus);
    if (joined.length === length && !joined.includes("") && onComplete) {
      onComplete(joined);
    }
  };

  const hintId = `${groupId}-hint`;
  const errorId = `${groupId}-error`;

  return (
    <fieldset
      className="flex flex-col gap-2"
      aria-describedby={error ? errorId : hint ? hintId : undefined}
      aria-invalid={error ? true : undefined}
      disabled={disabled}
    >
      <legend
        className={cn(
          "text-sm font-medium text-[var(--text)] mb-0.5",
          srLabelOnly && "sr-only",
        )}
      >
        {label}
      </legend>

      <div
        className={cn(
          // Boxes share the available width equally — never overflow the
          // parent card. Caps overall row width so on wide screens the
          // squares don't become cartoonish; the inline grid-template
          // adapts to whatever `length` prop is in use (default 8).
          "grid w-full max-w-md gap-1.5 sm:gap-2",
          focused && "transition-[gap] duration-[var(--motion-fast)]",
        )}
        style={{
          gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))`,
        }}
      >
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            pattern="\d*"
            maxLength={1}
            autoComplete={i === 0 ? "one-time-code" : "off"}
            aria-label={`Digit ${i + 1} of ${length}`}
            value={d}
            disabled={disabled}
            onFocus={() => {
              setFocused(true);
              refs.current[i]?.select();
            }}
            onBlur={() => setFocused(false)}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={(e) => handlePaste(i, e)}
            className={cn(
              // Each input fills its grid cell and stays square via
              // aspect-square. Heavier 2px border + a soft raised fill
              // make the box read as a tappable field, not decoration.
              // `min-w-0` lets the grid actually shrink the cells on
              // tight viewports; without it the inputs would refuse to
              // narrow past their intrinsic width and overflow the row.
              "w-full min-w-0 aspect-square text-center text-lg sm:text-xl font-mono",
              "bg-[var(--surface-raised)] text-[var(--text)] caret-[var(--primary)]",
              "border-2 border-[var(--border-strong)] rounded-lg outline-none",
              // Hover: nudge the border darker so an empty field reveals
              // itself as clickable without a focus event.
              "hover:border-[color-mix(in_srgb,var(--text)_28%,transparent)]",
              // Focus: lift to brand colour. Border thickness stays 2px so
              // the box doesn't reflow; a Tailwind ring would outset and
              // produce a square halo against the rounded edge.
              "focus-visible:border-[var(--primary)] focus-visible:bg-[var(--surface)]",
              "transition-[border-color,background-color] duration-[var(--motion-fast)]",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              // Filled state: white interior so the typed digit pops.
              d && "border-[var(--text)] bg-[var(--surface)]",
              error && "border-[var(--risk)]",
            )}
          />
        ))}
      </div>

      {error ? (
        <p id={errorId} role="alert" className="text-xs text-[var(--risk)]">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-[var(--text-muted)]">
          {hint}
        </p>
      ) : null}
    </fieldset>
  );
}
