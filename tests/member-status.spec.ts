/*
 * Pure-logic regression for the member lifecycle status + CP last-activity
 * helpers (lib/relay/memberStatus). No browser/server/DB — runs anywhere.
 *
 * Covers the brief's invariants:
 *   - an added member is Invited until first login, then Active automatically;
 *   - Suspended is a separate state (auth ban), independent of login;
 *   - CP "last activity" = the later of last-login / last-session, "—" only when
 *     neither exists.
 */

import { test, expect } from "@playwright/test";
import { deriveMemberStatus, laterIso } from "../lib/relay/memberStatus";
import { ROLE, canReceiveSupervisorAlerts } from "../lib/relay/roles";

test.describe("deriveMemberStatus", () => {
  test("added member (no sign-in) is Invited, not Active", () => {
    expect(deriveMemberStatus(false, null)).toBe("invited");
    expect(deriveMemberStatus(false, undefined)).toBe("invited");
  });

  test("first login flips Invited → Active", () => {
    expect(deriveMemberStatus(false, "2026-06-09T10:00:00.000Z")).toBe(
      "active"
    );
  });

  test("banned is Suspended regardless of login state", () => {
    expect(deriveMemberStatus(true, null)).toBe("suspended");
    expect(deriveMemberStatus(true, "2026-06-09T10:00:00.000Z")).toBe(
      "suspended"
    );
  });
});

test.describe("laterIso (CP last activity)", () => {
  test("picks the later of two timestamps", () => {
    expect(laterIso("2026-06-01T00:00:00Z", "2026-06-09T00:00:00Z")).toBe(
      "2026-06-09T00:00:00Z"
    );
    expect(laterIso("2026-06-09T00:00:00Z", "2026-06-01T00:00:00Z")).toBe(
      "2026-06-09T00:00:00Z"
    );
  });

  test("returns the present one when the other is null", () => {
    expect(laterIso(null, "2026-06-09T00:00:00Z")).toBe("2026-06-09T00:00:00Z");
    expect(laterIso("2026-06-09T00:00:00Z", null)).toBe("2026-06-09T00:00:00Z");
  });

  test("null only when neither last-login nor last-session exists", () => {
    expect(laterIso(null, null)).toBeNull();
    expect(laterIso(undefined, undefined)).toBeNull();
  });
});

test.describe("canReceiveSupervisorAlerts (escalation audience allow-list)", () => {
  test("supervisor + super_admin receive ops alerts", () => {
    expect(canReceiveSupervisorAlerts([ROLE.supervisor])).toBe(true);
    expect(canReceiveSupervisorAlerts([ROLE.super_admin])).toBe(true);
  });

  test("enterprise/department admins + resellers do NOT (the closed leak)", () => {
    expect(canReceiveSupervisorAlerts([ROLE.enterprise_admin])).toBe(false);
    expect(canReceiveSupervisorAlerts([ROLE.department_admin])).toBe(false);
    expect(canReceiveSupervisorAlerts([ROLE.reseller])).toBe(false);
  });

  test("engineers do NOT (they get session-scoped signals elsewhere)", () => {
    expect(canReceiveSupervisorAlerts([ROLE.engineer])).toBe(false);
  });
});
