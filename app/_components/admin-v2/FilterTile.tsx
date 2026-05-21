"use client";

/*
 * Big clickable tile used in the Internal Users tab sidebar. Shows a
 * label + live count. Selected tile gets the coral border + filled tint.
 */

export function FilterTile({
  label,
  count,
  selected,
  onClick,
}: {
  label:    string;
  count:    number;
  selected: boolean;
  onClick:  () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-1 rounded-lg border px-4 py-3 text-left transition-colors"
      style={{
        borderColor: selected ? "var(--primary)" : "var(--border)",
        background:  selected
          ? "color-mix(in srgb, var(--primary) 10%, transparent)"
          : "transparent",
        color:       "var(--text)",
      }}
    >
      <span className="text-sm font-medium">{label}</span>
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
        {count.toLocaleString()} {count === 1 ? "user" : "users"}
      </span>
    </button>
  );
}
