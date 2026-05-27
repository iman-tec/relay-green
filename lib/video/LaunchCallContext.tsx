"use client";

/*
 * Tiny "launch the in-window call surface" context, wired through
 * RoomClient + EngineerSessionClient.
 *
 * Consumers (MeetingChatEntry, CallHeaderActions) read `useLaunchCall()` to
 * detect whether the in-window <CallSurface> is available — when it is,
 * they call the function instead of `window.open(zoom_join_url)`.
 *
 * Gated by NEXT_PUBLIC_USE_VIDEO_SDK at the provider level: when the env
 * flag is unset/false, the provider passes `null`, so consumers fall back
 * to the legacy Meeting-SDK popup path.
 */

import { createContext, useContext } from "react";

export type LaunchCall = (() => void) | null;

const LaunchCallContext = createContext<LaunchCall>(null);

export const LaunchCallProvider = LaunchCallContext.Provider;

export function useLaunchCall(): LaunchCall {
  return useContext(LaunchCallContext);
}

export function isVideoSdkEnabled(): boolean {
  return process.env.NEXT_PUBLIC_USE_VIDEO_SDK === "true";
}
