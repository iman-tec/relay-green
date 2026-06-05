"use client";

/*
 * Zoom Video SDK singleton.
 *
 * `@zoom/videosdk` mutates window-level state internally and HMR will
 * re-import the module unless we cache the instance on globalThis. Always
 * read through `getVideoClient()` — never `import ZoomVideo from '@zoom/videosdk'`
 * directly from app code, so the cache is the only entry point.
 */

import type { default as ZoomVideoLib } from "@zoom/videosdk";

type ZoomClient = ReturnType<typeof ZoomVideoLib.createClient>;

declare global {
  // eslint-disable-next-line no-var
  var __relayVideoClient__:
    | { lib?: typeof ZoomVideoLib; client?: ZoomClient }
    | undefined;
}

function bag() {
  if (!globalThis.__relayVideoClient__) {
    globalThis.__relayVideoClient__ = {};
  }
  return globalThis.__relayVideoClient__;
}

async function lib(): Promise<typeof ZoomVideoLib> {
  const b = bag();
  if (!b.lib) {
    const mod = await import("@zoom/videosdk");
    b.lib =
      (mod as unknown as { default: typeof ZoomVideoLib }).default ??
      (mod as unknown as typeof ZoomVideoLib);
  }
  return b.lib;
}

export async function getVideoClient(): Promise<ZoomClient> {
  const b = bag();
  if (!b.client) {
    const ZoomVideo = await lib();
    b.client = ZoomVideo.createClient();
  }
  return b.client;
}

/**
 * Tear the singleton down. Safe to call from a final unmount; the next
 * getVideoClient() lazily reconstructs.
 */
export async function destroyVideoClient(): Promise<void> {
  const b = bag();
  if (b.client) {
    try {
      await b.client.leave(true);
    } catch {
      /* may not be in a session */
    }
    try {
      const ZoomVideo = await lib();
      (
        ZoomVideo as unknown as { destroyClient?: () => void }
      ).destroyClient?.();
    } catch {
      /* ignore */
    }
    b.client = undefined;
  }
}
