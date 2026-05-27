"use client";

/*
 * "Launch the in-window call surface" context, wired through RoomClient +
 * EngineerSessionClient.
 *
 * Consumers (MeetingChatEntry, CallHeaderActions) read this context to:
 *   • decide whether the in-window <CallSurface> is available (vs the
 *     legacy Meeting-SDK popup path that opens Zoom in a new tab), and
 *   • decide whether the current user is presently mounted on the call
 *     surface IN THIS BROWSER (vs has-ever-joined per the DB stamp).
 *
 * The presence check matters because the chat-card "You're on the call"
 * badge used to fire off `session.engineer_joined_at` alone — meaning
 * once an engineer joined, the badge stuck forever and the "Join call"
 * button disappeared, locking them out after a hot-reload or unmount.
 * `isCallOpen` reflects the live mount state so the button reappears.
 *
 * Gated by NEXT_PUBLIC_USE_VIDEO_SDK: when the env flag is unset/false,
 * `launchCall` is null and consumers fall back to the legacy popup path.
 */

import { createContext, useContext } from "react";

export type LaunchCallShape = {
  /** Mount the in-window <CallSurface>. Null when the Video SDK is
   *  disabled (consumer falls back to opening the Zoom popup). */
  launchCall: (() => void) | null;
  /** True when the parent has the in-window <CallSurface> mounted
   *  RIGHT NOW. Lets chat-card consumers show "Join call" again after
   *  the surface unmounts (e.g. user closed the rail, hot-reload). */
  isCallOpen: boolean;
};

/** Legacy alias kept so existing imports don't break. */
export type LaunchCall = (() => void) | null;

const DEFAULT_SHAPE: LaunchCallShape = { launchCall: null, isCallOpen: false };

const LaunchCallContext = createContext<LaunchCallShape>(DEFAULT_SHAPE);

/** Provider — pass the current LaunchCallShape as `value`. */
export const LaunchCallProvider = LaunchCallContext.Provider;

/**
 * Original hook signature: returns ONLY the launchCall function. Kept for
 * call sites that don't care about the open-state. Use useLaunchCallShape()
 * when you need both fields.
 */
export function useLaunchCall(): LaunchCall {
  return useContext(LaunchCallContext).launchCall;
}

/** Returns the full { launchCall, isCallOpen } shape. */
export function useLaunchCallShape(): LaunchCallShape {
  return useContext(LaunchCallContext);
}

export function isVideoSdkEnabled(): boolean {
  return process.env.NEXT_PUBLIC_USE_VIDEO_SDK === "true";
}
