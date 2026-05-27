/*
 * Shared "RELAY ●" wordmark — matches the landing page nav exactly.
 *
 * Spec mirrors `.mk-root .r-logo` in app/_marketing/marketing.css:
 *   • RELAY in Inter sans, font-weight 500, uppercase, letter-spacing 0.04em
 *   • Green dot after, sized in proportion to the text, margin-left 6px
 *
 * Used everywhere the brand mark appears (landing nav already has its own
 * inline copy; this component covers login, room, dashboard, inbox, etc.).
 */

const BRAND_GREEN = "var(--primary)";
const SIZES = {
  sm: { font: "14px", dot: 10, gap: "4px" },
  md: { font: "18px", dot: 12, gap: "6px" },
  lg: { font: "22px", dot: 14, gap: "6px" },
  // xl is used by the /room landing where we want the wordmark to
  // feel like the page's anchor visual without dominating it.
  xl: { font: "30px", dot: 16, gap: "8px" },
} as const;

export function Wordmark({
  size = "md",
  className = "",
}: {
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const s = SIZES[size];
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap ${className}`}
      style={{
        fontFamily: "var(--font-inter)",
        fontWeight: 500,
        fontSize: s.font,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: "var(--text)",
        gap: s.gap,
      }}
    >
      RELAY
      <span
        aria-hidden="true"
        style={{
          display: "inline-block",
          width: s.dot,
          height: s.dot,
          borderRadius: "50%",
          backgroundColor: BRAND_GREEN,
        }}
      />
    </span>
  );
}
