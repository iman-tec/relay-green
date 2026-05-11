/*
 * Prisma client singleton (Prisma 7 + pg driver adapter).
 *
 * Next.js dev server hot-reloads modules; without this guard we'd spawn a new
 * PrismaClient per reload and exhaust the database connection pool. The pattern
 * is from the Prisma docs: https://pris.ly/d/help/next-js-best-practices
 *
 * Prisma 7 requires either an `adapter` or `accelerateUrl` to be passed at
 * construction; we use the pg adapter for direct PostgreSQL connections.
 */

import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and ensure docker compose up is running."
    );
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

/*
 * Lazy proxy: defer client construction until first property access. The
 * marketing surface and other public routes import lib/auth (which imports
 * this module) but never touch a query method, so without this proxy the
 * "DATABASE_URL is not set" error fires at module load and breaks pages
 * that don't actually need the database.
 */
function getClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }
  return globalForPrisma.prisma;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient(), prop, receiver);
  },
});
