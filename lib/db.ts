/*
 * Prisma is no longer wired up — Supabase IS the database (managed Postgres
 * + auth + realtime), and every active code path goes through @supabase/
 * supabase-js. This file used to import @/app/generated/prisma/client and
 * created a runtime Prisma client; that generated folder isn't checked in
 * (rightly so) and was breaking production builds because Vercel can't
 * regenerate it without DATABASE_URL.
 *
 * To keep the legacy imports compiling without dragging Prisma into the
 * build, we export a Proxy that throws if anyone actually calls a query.
 * The legacy pages (`/customer`, `/engineer`, `/supervisor`, etc.) are not
 * linked from the live UX — the redesigned routes (/room, /dashboard,
 * /inbox, /supervise, /staff/session/[id]) all use Supabase directly.
 *
 * If you see "Prisma is no longer used" at runtime, you hit one of those
 * legacy pages — either delete the page or rewrite it against Supabase.
 */

type AnyFn = (...args: unknown[]) => unknown;

function deadStub(): never {
  throw new Error(
    "Prisma is no longer wired in this app. All persistence goes through " +
    "@supabase/supabase-js. If you reached this error, the calling page is " +
    "legacy code that should be rewritten or removed.",
  );
}

const handler: ProxyHandler<object> = {
  get(_target, prop): unknown {
    // Allow framework introspection like Symbol.toPrimitive, then/util.inspect
    // — these get called by error formatters and shouldn't throw.
    if (typeof prop === "symbol") return undefined;
    if (prop === "then" || prop === "catch") return undefined;
    // Anything else: return a function that throws on call OR a nested proxy
    // (so prisma.foo.findMany() also throws cleanly).
    const fn: AnyFn = () => deadStub();
    return new Proxy(fn, handler);
  },
  apply() {
    return deadStub();
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const prisma: any = new Proxy(() => undefined, handler);
