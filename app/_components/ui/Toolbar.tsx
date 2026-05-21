"use client";

/*
 * Toolbar — horizontal flex container with consistent spacing. The
 * canonical place for "title on the left, actions on the right" rows
 * (page toolbars above tables, list-pane headers, room toolbars).
 *
 *   <Toolbar>
 *     <Toolbar.Group><h2>…</h2></Toolbar.Group>
 *     <Toolbar.Spacer />
 *     <Toolbar.Group><Button>…</Button></Toolbar.Group>
 *   </Toolbar>
 */

import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

interface ToolbarRootProps extends HTMLAttributes<HTMLDivElement> {
  /** Tighter vertical padding for in-page toolbars. */
  dense?: boolean;
  children: ReactNode;
}

function ToolbarRoot({
  dense = false,
  className,
  children,
  ...rest
}: ToolbarRootProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 w-full",
        dense ? "py-1" : "py-2",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

function ToolbarGroup({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex items-center gap-2", className)} {...rest}>
      {children}
    </div>
  );
}

function ToolbarSpacer() {
  return <div className="flex-1" aria-hidden />;
}

function ToolbarDivider() {
  return (
    <span
      aria-hidden
      className="inline-block h-5 w-px bg-[var(--border)] mx-1"
    />
  );
}

export const Toolbar = Object.assign(ToolbarRoot, {
  Group: ToolbarGroup,
  Spacer: ToolbarSpacer,
  Divider: ToolbarDivider,
});
