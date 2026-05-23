/**
 * cn — tiny classnames helper. Filters non-string / empty entries and joins
 * the remainder with spaces. Accepts `unknown` so call-sites can use plain
 * `cond && "cls"` short-circuits without TypeScript complaining about
 * ReactNode-shaped conditions resolving to numbers/strings/etc.
 *
 * Avoids adding `clsx` as a dependency.
 */
export function cn(...parts: Array<unknown>): string {
  return parts
    .filter((p): p is string => typeof p === "string" && p.length > 0)
    .join(" ");
}
