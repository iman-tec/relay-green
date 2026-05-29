"use client";

/*
 * In-pane Account / Profile / Wallet / Security UI.
 *
 * Replaces the standalone `/account` route + the modal-overlay paywall
 * entry point. Now opens directly inside the /room main pane so the
 * customer never loses sidebar context (their sessions + projects stay
 * visible on the left). The standalone /account route is kept as a
 * fallback for direct-link entry but the in-room flow no longer
 * navigates there.
 *
 * Layout:
 *   ┌─ Profile & settings ──────────── × ─┐
 *   │  ┌──────────┬───────────────────┐   │
 *   │  │ Profile  │  <tab content>    │   │
 *   │  │ Wallet   │                   │   │
 *   │  │ Security │                   │   │
 *   │  │ Notifs   │                   │   │
 *   │  └──────────┴───────────────────┘   │
 *   │  [Save bar — Profile tab, dirty]    │
 *   └─────────────────────────────────────┘
 *
 * Tabs:
 *   • Profile        identity, photo, interests, expertise
 *   • Wallet         balance, plan, recharge entry → PaywallModal
 *   • Security       password reset (later: 2FA, sessions)
 *   • Notifications  placeholder for v2 (email + in-app prefs)
 *
 * State management is local — same data sources as AccountClient
 * (customer_profiles, credit_wallets, customer_entitlements,
 * /api/customer/me-employment) but assembled into a denser, tabbed UX
 * suited to the in-pane width (~70% of viewport).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Building2, Camera, Check, CreditCard, KeyRound, Loader2, Mail,
  ShieldCheck, Trash2, Wallet, User, Bell, X, Sparkles, AlertTriangle,
  ChevronRight, Receipt, Clock, Monitor, Download as DownloadIcon, BellRing,
  Plus, Lock,
} from "lucide-react";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { buildStripeAppearance } from "@/lib/stripe/appearance";
import { useTheme } from "@/app/_components/ThemeProvider";
import {
  Avatar, Button, Chip, ChipGroup, Input, Toast, cn,
} from "@/app/_components/ui";
import { PaywallModal } from "@/app/_components/PaywallModal";
import { createClient } from "@/lib/supabase/browser";
import { patchProfile, readProfile, type TechComfort } from "@/lib/relay/profile";
import {
  AVATAR_INPUT_ACCEPT,
  FIELD_OF_INTEREST_OPTIONS,
  techComfortFromFamiliarity,
  techComfortLabel,
  validateAvatar,
  type CustomerProfileRow,
} from "@/lib/relay/customerProfile";

const OTHER = "Other";

// Single Stripe.js loader for the whole app — Stripe recommends not
// re-loading on every modal open. Mirrors the pattern in PaywallModal.
const STRIPE_PUBLISHABLE_KEY =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) || "";
let _stripePromise: Promise<StripeJs | null> | null = null;
function getStripePromise(): Promise<StripeJs | null> | null {
  if (!STRIPE_PUBLISHABLE_KEY) return null;
  if (!_stripePromise) _stripePromise = loadStripe(STRIPE_PUBLISHABLE_KEY);
  return _stripePromise;
}

// Saved payment method shape — matches the normalized response from
// /api/billing/payment-methods (Stripe PaymentMethod flattened + the
// default-card flag derived from Customer.invoice_settings).
type SavedPaymentMethod = {
  id:        string;
  brand:     string;
  last4:     string;
  expMonth:  number | null;
  expYear:   number | null;
  isDefault: boolean;
};

// Pretty brand label for the card row. Stripe returns lowercase
// codes ("visa", "mastercard", "amex"); we capitalize for display.
function brandLabel(brand: string): string {
  switch (brand.toLowerCase()) {
    case "visa":       return "Visa";
    case "mastercard": return "Mastercard";
    case "amex":
    case "american_express": return "Amex";
    case "discover":   return "Discover";
    case "diners":     return "Diners";
    case "jcb":        return "JCB";
    case "unionpay":   return "UnionPay";
    default: return brand.charAt(0).toUpperCase() + brand.slice(1);
  }
}
function formatExp(month: number | null, year: number | null): string {
  if (!month || !year) return "";
  return `${String(month).padStart(2, "0")}/${String(year).slice(-2)}`;
}

// ── Tab identity ──────────────────────────────────────────────────────────
export type AccountTab = "profile" | "wallet" | "billing" | "security" | "notifications";

type TabDef = {
  id: AccountTab;
  label: string;
  description: string;
  Icon: typeof User;
};

const TABS: readonly TabDef[] = [
  { id: "profile",       label: "Profile",       description: "Identity, photo, interests",  Icon: User },
  { id: "wallet",        label: "Wallet",        description: "Balance and recharge",        Icon: Wallet },
  { id: "billing",       label: "Billing",       description: "Past purchases and receipts", Icon: Receipt },
  { id: "security",      label: "Security",      description: "Password and account safety", Icon: ShieldCheck },
  { id: "notifications", label: "Notifications", description: "Email and in-app prefs",      Icon: Bell },
] as const;

// ── Employment shape (mirrors /api/customer/me-employment) ────────────────
type EmployeeInfo =
  | { isEmployee: false }
  | {
      isEmployee: true;
      enterpriseName: string;
      departmentName: string | null;
      allocatedMinutes: number;
      usedMinutes: number;
      remainingMinutes: number;
    };

type WalletState = {
  paidMinutes: number;
  freeConsumed: boolean;
  employment: EmployeeInfo | null;
};

// ── Billing data shape ─────────────────────────────────────────────────
// One purchase row, normalized across both writer paths:
//   • Legacy payments-webhook → credit_credits RPC writes reason="purchase"
//     with description="Purchased {packageCode}" + metadata.stripe_payment_intent
//   • New relay-stripe-webhook writes reason="relay_plan:{code}" directly
// Both stored in credit_transactions; the UI doesn't care which path put it
// there — it just needs date, minutes, plan label, amount (when recoverable),
// and the Stripe id for the receipt link.
type PurchaseRow = {
  id: string;
  createdAt: string;          // ISO timestamp
  minutes: number;            // delta
  /** Human-readable plan name. Resolves in priority order:
   *  credit_packages.name (by code match) → reason after colon → "Recharge". */
  planLabel: string;
  /** Package code parsed from reason ("relay_plan:starter" → "starter") or
   *  description ("Purchased starter" → "starter"). Null if neither shape
   *  matches — UI shows the amount column as "—". */
  packageCode: string | null;
  /** Resolved price in cents (from credit_packages.price_cents). Null when
   *  package lookup misses — we can't fabricate a number we don't have. */
  priceCents: number | null;
  currency: string;           // e.g. "USD"
  stripeSessionId: string | null;
  description: string | null;
};

type BillingState = {
  purchases: PurchaseRow[];
  /** Lifetime cents from customer_entitlements.total_paid_cents — the
   *  authoritative top-line (each transaction's price is recovered via
   *  package lookup which can miss, but this column is always real). */
  totalPaidCents: number;
  /** Lifetime minutes from credit_wallets.lifetime_purchased. */
  lifetimeMinutes: number;
};

type Banner = { tone: "ok" | "risk" | "info"; text: string } | null;

// Parse a package code from a credit_transactions row's reason/description.
// Handles both writer formats; returns null when neither matches.
function parsePackageCode(reason: string, description: string | null): string | null {
  // New format: "relay_plan:starter" → "starter"
  const m = reason.match(/^relay_plan:(.+)$/);
  if (m) return m[1].trim() || null;
  // Legacy format: description = "Purchased starter" → "starter"
  if (description) {
    const d = description.match(/^Purchased\s+(.+)$/i);
    if (d) return d[1].trim() || null;
  }
  return null;
}

function humanizePlanCode(code: string): string {
  // "starter_30" → "Starter 30"
  // "relay_pro"  → "Relay Pro"
  return code
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function formatCurrency(cents: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

function formatDateLong(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
}

// ── Component ─────────────────────────────────────────────────────────────
export function AccountPane({
  userId,
  email,
  initialTab = "profile",
  onClose,
}: {
  userId: string;
  email: string;
  /** Which tab to open on mount. Recharge entry sets this to "wallet". */
  initialTab?: AccountTab;
  /** Close the pane and return to the prior view (landing/session). */
  onClose: () => void;
}) {
  const sbRef = useRef(createClient());

  const [tab, setTab] = useState<AccountTab>(initialTab);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [resetting, setResetting] = useState(false);

  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [paywallOpen, setPaywallOpen] = useState(false);

  // Billing — fetched lazily on first visit to the Billing tab so the
  // network round-trip doesn't add to first-paint cost for users who
  // never open it.
  const [billing, setBilling] = useState<BillingState | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);

  // Notifications — single email-opt-in flag on customer_profiles.
  // Loaded with the rest of the profile (already in the same row), so
  // no extra round-trip. Saved on toggle with optimistic UI: we update
  // local state immediately + persist in the background, rolling back
  // on error.
  const [emailNotif, setEmailNotif] = useState<boolean>(true);
  const [emailNotifSaving, setEmailNotifSaving] = useState(false);

  // ── Editable form state ────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const [interestOther, setInterestOther] = useState("");
  const [expertise, setExpertise] = useState<TechComfort | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [stagedFile, setStagedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Track the snapshot the form was loaded with so we can detect a "dirty"
  // state — drives the Save bar's visibility.
  const initialRef = useRef<{
    name: string; interests: string[]; interestOther: string;
    expertise: TechComfort | null; avatarUrl: string | null;
  } | null>(null);

  const showBanner = useCallback((b: NonNullable<Banner>) => {
    setBanner(b);
    if (b.tone === "ok") setTimeout(() => setBanner(null), 4000);
  }, []);

  // ── Load profile + expertise (intake fallback) ─────────────────────────
  useEffect(() => {
    const sb = sbRef.current;
    let alive = true;

    void (async () => {
      setLoading(true);
      const local = readProfile();

      const { data: row } = await sb
        .from("customer_profiles")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      const profile = (row as CustomerProfileRow | null) ?? null;

      let resolvedExpertise: TechComfort | null = profile?.technical_expertise ?? null;
      if (!resolvedExpertise) {
        const { data: intake } = await sb
          .from("client_intakes")
          .select("familiarity")
          .eq("customer_user_id", userId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        resolvedExpertise =
          techComfortFromFamiliarity((intake as { familiarity?: string } | null)?.familiarity) ??
          local.techComfort ??
          null;
      }

      if (!alive) return;

      const stored = profile?.fields_of_interest ?? [];
      const known = stored.filter((s) =>
        (FIELD_OF_INTEREST_OPTIONS as readonly string[]).includes(s),
      );
      const customOther = profile?.interest_other ?? stored.find((s) =>
        !(FIELD_OF_INTEREST_OPTIONS as readonly string[]).includes(s),
      ) ?? "";

      const nm = profile?.display_name ?? "";
      const av = profile?.avatar_url ?? null;
      setName(nm);
      setInterests(known);
      setInterestOther(customOther);
      setExpertise(resolvedExpertise);
      setAvatarUrl(av);
      // Email pref defaults TRUE for any row that hasn't been explicitly
      // toggled (per the ToS opt-in). Older rows might have NULL or
      // missing column — treat both as true.
      setEmailNotif(
        profile?.email_notifications_enabled === false ? false : true,
      );
      initialRef.current = {
        name: nm, interests: known, interestOther: customOther,
        expertise: resolvedExpertise, avatarUrl: av,
      };
      setLoading(false);

      if (resolvedExpertise && !profile?.technical_expertise) {
        void sb.from("customer_profiles").upsert(
          { user_id: userId, technical_expertise: resolvedExpertise },
          { onConflict: "user_id" },
        );
      }
    })();

    return () => { alive = false; };
  }, [userId]);

  // ── Load wallet + employment ──────────────────────────────────────────
  useEffect(() => {
    const sb = sbRef.current;
    let alive = true;
    void (async () => {
      const [walletRes, entRes, emp] = await Promise.all([
        sb.from("credit_wallets").select("balance").eq("user_id", userId).maybeSingle(),
        sb.from("customer_entitlements").select("free_session_consumed_at").eq("customer_user_id", userId).maybeSingle(),
        fetch("/api/customer/me-employment", { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : { isEmployee: false }))
          .catch(() => ({ isEmployee: false })) as Promise<EmployeeInfo>,
      ]);
      if (!alive) return;
      setWallet({
        paidMinutes: Number((walletRes.data as { balance?: number } | null)?.balance ?? 0),
        freeConsumed: Boolean((entRes.data as { free_session_consumed_at?: string | null } | null)?.free_session_consumed_at),
        employment: emp,
      });
    })();
    return () => { alive = false; };
  }, [userId]);

  // ── Billing lazy-load ─────────────────────────────────────────────────
  // Fires only when the user actually opens the Billing tab, and caches
  // the result so flipping back and forth between tabs doesn't re-fetch.
  useEffect(() => {
    if (tab !== "billing") return;
    if (billing || billingLoading) return;

    const sb = sbRef.current;
    let alive = true;
    setBillingLoading(true);
    setBillingError(null);

    void (async () => {
      try {
        // Three parallel queries:
        //   1. credit_transactions  — the immutable ledger of all wallet
        //      mutations. We only want purchase rows, so filter by the two
        //      writer-side reason shapes (legacy 'purchase' + new
        //      'relay_plan:*'). Ordered DESC so most recent shows first.
        //   2. credit_packages      — small lookup table; used to resolve
        //      a purchase's USD amount from its package code (the ledger
        //      doesn't store the cash amount, only the minute delta).
        //   3. credit_wallets +
        //      customer_entitlements — top-line stats: lifetime minutes
        //      bought + lifetime cents spent. These are authoritative
        //      (sums of every successful purchase) whereas per-transaction
        //      amounts depend on package-lookup matching.
        const [txRes, pkgRes, walletRes, entRes] = await Promise.all([
          sb.from("credit_transactions")
            .select("id, delta, reason, description, stripe_session_id, created_at, metadata")
            .eq("user_id", userId)
            .or("reason.eq.purchase,reason.like.relay_plan:%")
            .order("created_at", { ascending: false })
            .limit(200),
          sb.from("credit_packages")
            .select("code, name, price_cents, currency"),
          sb.from("credit_wallets")
            .select("lifetime_purchased")
            .eq("user_id", userId)
            .maybeSingle(),
          sb.from("customer_entitlements")
            .select("total_paid_cents")
            .eq("customer_user_id", userId)
            .maybeSingle(),
        ]);

        if (!alive) return;

        if (txRes.error) throw new Error(txRes.error.message);

        // Build a code → package lookup. Falls back gracefully if the
        // packages table is empty (no matches → amount column shows "—").
        const pkgMap = new Map<string, { name: string; priceCents: number; currency: string }>();
        for (const p of (pkgRes.data ?? []) as Array<{
          code: string; name: string; price_cents: number; currency: string;
        }>) {
          pkgMap.set(p.code, {
            name: p.name,
            priceCents: p.price_cents,
            currency: p.currency,
          });
        }

        const purchases: PurchaseRow[] = ((txRes.data ?? []) as Array<{
          id: string;
          delta: number | string;
          reason: string;
          description: string | null;
          stripe_session_id: string | null;
          created_at: string;
          metadata: Record<string, unknown> | null;
        }>).map((row) => {
          const code = parsePackageCode(row.reason, row.description);
          const pkg = code ? pkgMap.get(code) ?? null : null;
          const planLabel = pkg?.name ?? (code ? humanizePlanCode(code) : "Recharge");
          return {
            id: row.id,
            createdAt: row.created_at,
            minutes: Number(row.delta),
            planLabel,
            packageCode: code,
            priceCents: pkg?.priceCents ?? null,
            currency: pkg?.currency ?? "USD",
            stripeSessionId: row.stripe_session_id,
            description: row.description,
          };
        });

        const lifetimeMinutes = Number(
          (walletRes.data as { lifetime_purchased?: number } | null)?.lifetime_purchased ?? 0,
        );
        const totalPaidCents = Number(
          (entRes.data as { total_paid_cents?: number } | null)?.total_paid_cents ?? 0,
        );

        setBilling({ purchases, lifetimeMinutes, totalPaidCents });
      } catch (err) {
        if (!alive) return;
        setBillingError(err instanceof Error ? err.message : "Failed to load billing history.");
      } finally {
        if (alive) setBillingLoading(false);
      }
    })();

    return () => { alive = false; };
    // Deps are intentionally just [tab, userId]. `billing`/`billingLoading`
    // are read as in-effect GUARDS (don't refetch if we already have data
    // or a fetch is in flight) but must NOT be in the dep array: including
    // billingLoading caused the effect to re-run the moment we set it true,
    // which tore down the in-flight fetch (alive=false) before it could
    // setBilling/clear-loading — leaving the panel stuck on
    // "Loading billing history…" forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, userId]);

  // Revoke the preview URL when staged file changes / unmounts.
  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  const onPickFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const v = validateAvatar(file);
    if (!v.ok) { showBanner({ tone: "risk", text: v.error }); return; }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setStagedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }, [previewUrl, showBanner]);

  const clearStaged = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setStagedFile(null);
    setPreviewUrl(null);
  }, [previewUrl]);

  // Dirty detection — Save bar shows only when the user actually changed
  // something so the chrome doesn't add visual noise on a clean profile.
  const isDirty = useMemo(() => {
    if (!initialRef.current) return false;
    const i = initialRef.current;
    if (name !== i.name) return true;
    if (interestOther !== i.interestOther) return true;
    if (expertise !== i.expertise) return true;
    if (stagedFile) return true;
    if (interests.length !== i.interests.length) return true;
    const a = new Set(interests); const b = new Set(i.interests);
    for (const x of a) if (!b.has(x)) return true;
    return false;
  }, [name, interests, interestOther, expertise, stagedFile]);

  // ── Save profile ───────────────────────────────────────────────────────
  const onSave = useCallback(async () => {
    setSaving(true);
    setBanner(null);
    const sb = sbRef.current;

    try {
      let nextAvatarUrl = avatarUrl;

      if (stagedFile) {
        const ext = stagedFile.type === "image/png" ? "png"
          : stagedFile.type === "image/webp" ? "webp" : "jpg";
        const path = `${userId}/avatar-${Date.now()}.${ext}`;
        const { error: upErr } = await sb.storage
          .from("avatars")
          .upload(path, stagedFile, { upsert: true, contentType: stagedFile.type });
        if (upErr) throw new Error(`Photo upload failed: ${upErr.message}`);
        nextAvatarUrl = sb.storage.from("avatars").getPublicUrl(path).data.publicUrl;
      }

      const payload = {
        user_id: userId,
        display_name: name.trim() || null,
        fields_of_interest: interests.filter((i) => i !== OTHER),
        interest_other: interests.includes(OTHER) ? interestOther.trim() || null : null,
        avatar_url: nextAvatarUrl,
        ...(expertise ? { technical_expertise: expertise } : {}),
      };

      const { error } = await sb
        .from("customer_profiles")
        .upsert(payload, { onConflict: "user_id" });
      if (error) throw new Error(error.message);

      patchProfile({ techComfort: expertise });

      setAvatarUrl(nextAvatarUrl);
      clearStaged();
      initialRef.current = {
        name, interests, interestOther,
        expertise, avatarUrl: nextAvatarUrl,
      };
      showBanner({ tone: "ok", text: "Profile saved." });
    } catch (err) {
      showBanner({ tone: "risk", text: err instanceof Error ? err.message : "Could not save profile." });
    } finally {
      setSaving(false);
    }
  }, [userId, avatarUrl, stagedFile, name, interests, interestOther, expertise, clearStaged, showBanner]);

  // ── Email-notifications toggle ────────────────────────────────────────
  // Optimistic UI: flip local state immediately so the toggle feels
  // responsive, then persist. On error, roll back + show a banner so
  // the customer isn't left thinking the change took when it didn't.
  const onToggleEmailNotif = useCallback(async (next: boolean) => {
    if (emailNotifSaving) return;
    const previous = emailNotif;
    setEmailNotif(next);
    setEmailNotifSaving(true);
    try {
      const sb = sbRef.current;
      const { error } = await sb
        .from("customer_profiles")
        .upsert(
          {
            user_id: userId,
            email_notifications_enabled: next,
            email_notifications_updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
      if (error) throw new Error(error.message);
      showBanner({
        tone: "ok",
        text: next
          ? "Email notifications turned on."
          : "Email notifications turned off.",
      });
    } catch (err) {
      // Roll back the optimistic flip so the toggle UI reflects reality.
      setEmailNotif(previous);
      showBanner({
        tone: "risk",
        text: err instanceof Error ? err.message : "Couldn't save preference.",
      });
    } finally {
      setEmailNotifSaving(false);
    }
  }, [emailNotif, emailNotifSaving, userId, showBanner]);

  // ── Reset password ────────────────────────────────────────────────────
  const onResetPassword = useCallback(async () => {
    if (!email) return;
    setResetting(true);
    setBanner(null);
    try {
      const redirectTo = `${window.location.origin}/set-password?mode=customer`;
      const { error } = await sbRef.current.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw new Error(error.message);
      showBanner({ tone: "ok", text: `We've sent a password reset link to ${email}.` });
    } catch (err) {
      showBanner({ tone: "risk", text: err instanceof Error ? err.message : "Could not send reset link." });
    } finally {
      setResetting(false);
    }
  }, [email, showBanner]);

  const shownAvatar = previewUrl ?? avatarUrl;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center" style={{ backgroundColor: "var(--surface)" }}>
        <Loader2 size={20} className="animate-spin" style={{ color: "var(--text-muted)" }} />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col" style={{ backgroundColor: "var(--surface)" }}>
      {/* Header bar — title + close. Sits inside the pane, not page-level. */}
      <header
        className="flex shrink-0 items-center gap-3 border-b px-6 py-4"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex flex-1 items-center gap-3">
          <Sparkles size={14} style={{ color: "var(--primary)" }} />
          <h1
            className="text-[15px] font-semibold tracking-tight"
            style={{ color: "var(--text)" }}
          >
            Profile &amp; settings
          </h1>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          title="Close"
          className="flex h-8 w-8 items-center justify-center rounded-md transition-opacity hover:bg-black/5 dark:hover:bg-white/5"
          style={{ color: "var(--text-muted)" }}
        >
          <X size={16} />
        </button>
      </header>

      {/* Banner — toast-style notification (saved / error) */}
      {banner && (
        <div className="px-6 pt-4">
          <Toast tone={banner.tone}>{banner.text}</Toast>
        </div>
      )}

      {/* Body — left mini-nav + tab content. Two-pane to keep the
          right-side content scannable on wide layouts without forcing
          all four sections to live in one long scroll. */}
      <div className="flex min-h-0 flex-1">
        <SubNav active={tab} onChange={setTab} />

        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-6 py-6 pb-24">
            {tab === "profile" && (
              <ProfileTab
                name={name}              onName={setName}
                interests={interests}    onInterests={setInterests}
                interestOther={interestOther} onInterestOther={setInterestOther}
                expertise={expertise}
                email={email}
                shownAvatar={shownAvatar}
                stagedFile={stagedFile}
                onPickFile={onPickFile}
                onClearStaged={clearStaged}
                fileInputRef={fileInputRef}
              />
            )}
            {tab === "wallet" && (
              <WalletTab
                wallet={wallet}
                onRecharge={() => setPaywallOpen(true)}
                onSeeBilling={() => setTab("billing")}
              />
            )}
            {tab === "billing" && (
              <BillingTab
                state={billing}
                loading={billingLoading}
                error={billingError}
                onRecharge={() => setPaywallOpen(true)}
              />
            )}
            {tab === "security" && (
              <SecurityTab
                email={email}
                resetting={resetting}
                onResetPassword={onResetPassword}
              />
            )}
            {tab === "notifications" && (
              <NotificationsTab
                emailEnabled={emailNotif}
                emailSaving={emailNotifSaving}
                onToggleEmail={onToggleEmailNotif}
              />
            )}
          </div>
        </div>
      </div>

      {/* Save bar — always visible on the Profile tab so the customer
          knows the page is editable from the moment they land on it.
          The button itself is disabled until there are unsaved changes
          (isDirty), so an idle visit doesn't show an actionable Save
          on a clean profile. Previously this whole bar was hidden when
          !isDirty, which made the page look read-only and the user
          had no obvious "edit option" to discover. */}
      {tab === "profile" && (
        <div
          className="shrink-0 border-t px-6 py-3"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "color-mix(in srgb, var(--surface) 95%, transparent)",
            backdropFilter: "blur(8px)",
          }}
        >
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
            <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
              {isDirty
                ? "You have unsaved changes."
                : "Edit any field above — click Save changes when you're done."}
            </p>
            <Button
              iconLeft={saving ? undefined : <Check className="size-4" />}
              loading={saving}
              onClick={onSave}
              disabled={!isDirty || saving}
            >
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      )}

      <PaywallModal
        open={paywallOpen}
        reason="manual"
        onClose={() => setPaywallOpen(false)}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Sub-nav — left vertical tab list with icon + label + description. Each
// item is a button that flips the active tab; the active one gets a
// filled background tint matching the brand.
// ──────────────────────────────────────────────────────────────────────────
function SubNav({
  active, onChange,
}: {
  active: AccountTab;
  onChange: (t: AccountTab) => void;
}) {
  return (
    <nav
      aria-label="Settings sections"
      className="hidden w-[240px] shrink-0 border-r px-3 py-5 md:block"
      style={{ borderColor: "var(--border)" }}
    >
      <div
        className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.08em]"
        style={{ color: "var(--text-faint)" }}
      >
        Settings
      </div>
      <ul className="flex flex-col gap-0.5">
        {TABS.map(({ id, label, description, Icon }) => {
          const isActive = active === id;
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => onChange(id)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "group flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                  isActive
                    ? ""
                    : "hover:bg-black/5 dark:hover:bg-white/5",
                )}
                style={{
                  backgroundColor: isActive
                    ? "var(--primary-soft)"
                    : "transparent",
                }}
              >
                <Icon
                  size={15}
                  className="mt-0.5 shrink-0"
                  style={{
                    color: isActive ? "var(--primary)" : "var(--text-muted)",
                  }}
                />
                <div className="min-w-0 flex-1">
                  <div
                    className="text-[13px] font-medium leading-tight"
                    style={{ color: isActive ? "var(--text)" : "var(--text)" }}
                  >
                    {label}
                  </div>
                  <div
                    className="mt-0.5 truncate text-[11px] leading-snug"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {description}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Profile tab — identity (avatar + name + email + expertise) and the
// field-of-interest pills. Each row is its own section card so the visual
// hierarchy reads top→bottom without crowding.
// ──────────────────────────────────────────────────────────────────────────
function ProfileTab({
  name, onName,
  interests, onInterests,
  interestOther, onInterestOther,
  expertise,
  email,
  shownAvatar,
  stagedFile,
  onPickFile,
  onClearStaged,
  fileInputRef,
}: {
  name: string; onName: (v: string) => void;
  interests: string[]; onInterests: (v: string[]) => void;
  interestOther: string; onInterestOther: (v: string) => void;
  expertise: TechComfort | null;
  email: string;
  shownAvatar: string | null;
  stagedFile: File | null;
  onPickFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClearStaged: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="flex flex-col gap-6">
      <SectionHead
        title="Identity"
        blurb="Your name, photo, and what your engineer should know about you."
      />

      {/* Avatar block */}
      <SectionCard>
        <div className="flex items-start gap-5">
          <Avatar src={shownAvatar} name={name} email={email} size="lg" tone="brand" />
          <div className="flex flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                iconLeft={<Camera className="size-4" />}
                onClick={() => fileInputRef.current?.click()}
              >
                {shownAvatar ? "Change photo" : "Upload photo"}
              </Button>
              {stagedFile && (
                <Button
                  variant="ghost"
                  size="sm"
                  iconLeft={<Trash2 className="size-4" />}
                  onClick={onClearStaged}
                >
                  Discard
                </Button>
              )}
            </div>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              JPG, PNG, or WebP · up to 2 MB
              {stagedFile && (
                <span className="ml-1" style={{ color: "var(--primary)" }}>
                  · preview shown, not yet saved
                </span>
              )}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept={AVATAR_INPUT_ACCEPT}
              className="hidden"
              onChange={onPickFile}
            />
          </div>
        </div>
      </SectionCard>

      {/* Name + email */}
      <SectionCard>
        <div className="flex flex-col gap-5">
          <Input
            label="Name"
            value={name}
            onChange={(e) => onName(e.target.value)}
            placeholder="Your name"
            autoComplete="name"
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium" style={{ color: "var(--text)" }}>
              Email address
            </span>
            <div
              className="flex h-11 items-center gap-2 rounded-lg border px-3.5 text-[15px]"
              style={{
                borderColor: "var(--border)",
                backgroundColor: "var(--surface-raised)",
                color: "var(--text-muted)",
              }}
            >
              <Mail className="size-4 shrink-0" />
              <span className="truncate">{email || "—"}</span>
            </div>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              Email can&apos;t be changed.
            </p>
          </div>
        </div>
      </SectionCard>

      {/* Technical expertise (read-only) */}
      <SectionCard>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium" style={{ color: "var(--text)" }}>
            Level of technical expertise
          </span>
          <div>
            <Chip static active={!!expertise}>{techComfortLabel(expertise)}</Chip>
          </div>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            Set from your first intake and used to right-size every session.
          </p>
        </div>
      </SectionCard>

      <SectionHead
        title="Field of interest"
        blurb="What you spend most of your time on. Helps us route you to the right engineer."
      />

      <SectionCard>
        <div className="flex flex-col gap-4">
          <ChipGroup
            options={FIELD_OF_INTEREST_OPTIONS}
            value={interests}
            multi
            onChange={onInterests}
            label="Field of interest"
          />
          {interests.includes(OTHER) && (
            <Input
              label="Tell us more"
              value={interestOther}
              onChange={(e) => onInterestOther(e.target.value)}
              placeholder="e.g. Healthcare, Education, Logistics…"
            />
          )}
        </div>
      </SectionCard>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Wallet tab — balance card up top + Recharge CTA + bundle preview.
// ──────────────────────────────────────────────────────────────────────────
function WalletTab({
  wallet,
  onRecharge,
  onSeeBilling,
}: {
  wallet: WalletState | null;
  onRecharge: () => void;
  /** Jump to the Billing tab to see the full purchase history. */
  onSeeBilling: () => void;
}) {
  if (!wallet) {
    return (
      <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
        <Loader2 className="size-4 animate-spin" /> Loading balance…
      </div>
    );
  }

  const isEmployee = wallet.employment?.isEmployee;

  return (
    <div className="flex flex-col gap-6">
      <SectionHead
        title="Wallet"
        blurb={isEmployee
          ? "Your minutes are managed by your organization."
          : "Buy minutes once — no subscription, no auto-renew."}
      />

      {/* Hero balance card — large, clear amount + plan + CTA */}
      <div
        className="relative overflow-hidden rounded-2xl border p-6"
        style={{
          borderColor: "var(--border)",
          background:
            "linear-gradient(135deg, color-mix(in srgb, var(--primary) 10%, var(--surface-raised)) 0%, var(--surface-raised) 60%)",
        }}
      >
        {isEmployee && wallet.employment?.isEmployee ? (
          <div className="flex items-start gap-4">
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
              style={{ backgroundColor: "var(--primary-soft)", color: "var(--primary)" }}
            >
              <Building2 className="size-6" />
            </div>
            <div className="flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                Enterprise plan
              </div>
              <div className="mt-1 text-[28px] font-semibold leading-tight" style={{ color: "var(--text)", fontFamily: "var(--font-source-serif)" }}>
                {wallet.employment.remainingMinutes > 0
                  ? `${Math.round(wallet.employment.remainingMinutes).toLocaleString()} min`
                  : "Out of credits"}
              </div>
              <div className="mt-1 text-[13px]" style={{ color: "var(--text-muted)" }}>
                {wallet.employment.departmentName ? `${wallet.employment.departmentName} · ` : ""}
                {wallet.employment.enterpriseName}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-4">
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
              style={{ backgroundColor: "var(--primary-soft)", color: "var(--primary)" }}
            >
              <Wallet className="size-6" />
            </div>
            <div className="flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                {wallet.paidMinutes > 0 ? "Paid plan" : "Free plan"}
              </div>
              <div className="mt-1 text-[28px] font-semibold leading-tight" style={{ color: "var(--text)", fontFamily: "var(--font-source-serif)" }}>
                {wallet.paidMinutes > 0
                  ? `${wallet.paidMinutes.toFixed(2)} min`
                  : wallet.freeConsumed
                    ? "0 min"
                    : "10 min free"}
              </div>
              <div className="mt-1 text-[13px]" style={{ color: "var(--text-muted)" }}>
                {wallet.paidMinutes > 0
                  ? "Remaining balance"
                  : wallet.freeConsumed
                    ? "Free session used — recharge to keep going"
                    : "Available on your first session"}
              </div>
            </div>
            <Button
              variant="primary"
              iconLeft={<CreditCard className="size-4" />}
              onClick={onRecharge}
            >
              Recharge
            </Button>
          </div>
        )}
      </div>

      {/* Plan highlights — visible only for non-employee customers, so
          the message lines up with what Recharge actually changes. */}
      {!isEmployee && (
        <SectionCard>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Highlight
              title="No subscription"
              body="Buy minutes when you need them. They never expire."
            />
            <Highlight
              title="No auto-renew"
              body="Your card is only charged when you confirm a top-up."
            />
            <Highlight
              title="Minimum 10 min"
              body="Each session bills in 10-minute blocks so engineers have room to actually solve the problem."
            />
          </div>
        </SectionCard>
      )}

      {/* Saved payment methods — sits between the highlights and the
          Past-purchases pivot so it's adjacent to the Recharge button.
          Card-on-file is set up via a Stripe SetupIntent with
          usage="off_session" (see /api/billing/payment-methods/setup-intent),
          which makes future top-ups merchant-initiated (no re-3DS prompt
          for SCA-region cards).

          Suppressed for employees — their wallet runs on org-billed
          minutes, not personal cards. */}
      {!isEmployee && (
        <SectionCard>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <div>
              <h3 className="text-[13px] font-semibold" style={{ color: "var(--text)" }}>
                Payment methods
              </h3>
              <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                Saved with Stripe so future top-ups skip card entry.
              </p>
            </div>
          </div>
          <PaymentMethodsCard />
        </SectionCard>
      )}

      {/* Pivot to Billing — wallet shows current balance; for the full
          purchase history (dates, amounts, receipts) the customer jumps
          to the dedicated Billing tab. Keeps the Wallet card lean. */}
      {!isEmployee && (
        <button
          type="button"
          onClick={onSeeBilling}
          className="flex w-full items-center justify-between rounded-2xl border px-5 py-4 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-raised)" }}
        >
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
              style={{
                backgroundColor: "color-mix(in srgb, var(--text) 5%, transparent)",
                color: "var(--text-muted)",
              }}
            >
              <Receipt size={16} />
            </div>
            <div>
              <p className="text-[13px] font-medium" style={{ color: "var(--text)" }}>
                Past purchases &amp; receipts
              </p>
              <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                Every recharge in one place, with downloadable receipts.
              </p>
            </div>
          </div>
          <ChevronRight size={16} style={{ color: "var(--text-muted)" }} />
        </button>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Billing tab — full purchase history. Top-line stats card (lifetime
// minutes + lifetime spent + recharge count) followed by a transaction
// table grouped by year. Each row links out to its Stripe receipt when
// the session id is recorded.
//
// Data model assumptions (validated in webhook + RPC code):
//   - credit_transactions is the immutable ledger; purchase rows have
//     reason='purchase' (legacy path) or reason='relay_plan:{code}'
//     (new direct-write path). Per-row cash amount is NOT stored —
//     we recover it by joining credit_packages on the parsed code.
//   - When package lookup misses (custom amount, retired package code),
//     we render the amount cell as "—" instead of inventing a number.
//   - Top-line totalPaidCents pulls from customer_entitlements which
//     IS authoritative for cash — every webhook adds to it directly.
// ──────────────────────────────────────────────────────────────────────────
function BillingTab({
  state,
  loading,
  error,
  onRecharge,
}: {
  state: BillingState | null;
  loading: boolean;
  error: string | null;
  onRecharge: () => void;
}) {
  if (loading && !state) {
    return (
      <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
        <Loader2 className="size-4 animate-spin" /> Loading billing history…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-6">
        <SectionHead title="Billing" blurb="Past purchases and receipts." />
        <SectionCard>
          <div className="flex items-start gap-3">
            <AlertTriangle size={16} style={{ color: "var(--accent-red)" }} />
            <div className="flex-1">
              <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
                Couldn&apos;t load your billing history
              </p>
              <p className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
                {error}
              </p>
            </div>
          </div>
        </SectionCard>
      </div>
    );
  }

  if (!state) return null;

  const { purchases, totalPaidCents, lifetimeMinutes } = state;
  const hasHistory = purchases.length > 0;

  // Group by year for a clear visual rhythm — last year's purchases
  // shouldn't blur into this year's. ISO sort already gave us DESC,
  // so we walk the list and emit a header whenever the year flips.
  const groups: { year: number; rows: PurchaseRow[] }[] = [];
  for (const row of purchases) {
    const y = new Date(row.createdAt).getFullYear();
    const last = groups[groups.length - 1];
    if (!last || last.year !== y) groups.push({ year: y, rows: [row] });
    else last.rows.push(row);
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHead
        title="Billing"
        blurb="Every recharge you've made, with receipts."
      />

      {/* Payment methods used to live here; they were promoted to the
          Wallet tab in commit feat(wallet): saved payment methods on
          Wallet + mandate disclosure. The Billing tab is now purely
          "what happened in the past" — recharges + receipts. */}

      {/* Top-line stats — three small cards in a row. Numbers come from
          authoritative cumulative columns, not summed-from-purchases,
          so they survive ledger gaps cleanly. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Lifetime spent"
          value={formatCurrency(totalPaidCents, "USD")}
          Icon={CreditCard}
        />
        <StatCard
          label="Lifetime minutes"
          value={`${Math.round(lifetimeMinutes).toLocaleString()} min`}
          Icon={Clock}
        />
        <StatCard
          label="Recharges"
          value={`${purchases.length}`}
          Icon={Receipt}
        />
      </div>

      {/* History list — or empty state with a clear Recharge CTA when
          the customer hasn't bought yet. */}
      {!hasHistory ? (
        <SectionCard>
          <div className="flex flex-col items-start gap-3 py-4 text-left sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
                No purchases yet
              </p>
              <p className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
                Your past recharges and downloadable receipts will appear here.
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              iconLeft={<CreditCard className="size-4" />}
              onClick={onRecharge}
            >
              Recharge
            </Button>
          </div>
        </SectionCard>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map(({ year, rows }) => (
            <section key={year} className="flex flex-col gap-2">
              <div
                className="px-1 text-[10px] font-semibold uppercase tracking-[0.08em]"
                style={{ color: "var(--text-faint)" }}
              >
                {year}
              </div>
              <div
                className="overflow-hidden rounded-2xl border"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-raised)" }}
              >
                {rows.map((row, i) => (
                  <PurchaseRowItem
                    key={row.id}
                    row={row}
                    isLast={i === rows.length - 1}
                  />
                ))}
              </div>
            </section>
          ))}

          {/* Disclaimer about retrieval — Stripe receipts can be opened
              from the row's overflow but we don't host them ourselves. */}
          <p className="px-1 text-[11px]" style={{ color: "var(--text-faint)" }}>
            Receipts are hosted by Stripe and remain accessible from your
            bank statement record. For an invoice or VAT receipt, contact
            <span className="mx-1" style={{ color: "var(--text-muted)" }}>support@relay.green</span>.
          </p>
        </div>
      )}
    </div>
  );
}

// One row in the purchase list — a stripe of (icon · plan · meta · amount).
// Stripe checkout sessions don't have stable receipt URLs reachable from
// the session id alone, so we don't link out by default. When the user has
// a real stripe payment_intent we could open the customer-portal — for
// now we just surface the id as supporting text. Easy to upgrade later.
function PurchaseRowItem({ row, isLast }: { row: PurchaseRow; isLast: boolean }) {
  const amountText = row.priceCents != null ? formatCurrency(row.priceCents, row.currency) : "—";

  return (
    <div
      className="flex items-center gap-4 px-4 py-3"
      style={{
        borderBottom: isLast ? "none" : "1px solid var(--border)",
      }}
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
        style={{
          backgroundColor: "var(--primary-soft)",
          color: "var(--primary)",
        }}
      >
        <CreditCard size={15} />
      </div>

      {/* Plan + meta */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium" style={{ color: "var(--text)" }}>
            {row.planLabel}
          </span>
          <span
            className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
            style={{
              backgroundColor: "color-mix(in srgb, var(--primary) 14%, transparent)",
              color: "var(--primary)",
            }}
          >
            +{Math.round(row.minutes)} min
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
          <span>{formatDateLong(row.createdAt)}</span>
          {row.stripeSessionId && (
            <>
              <span aria-hidden>·</span>
              <span
                className="font-mono text-[10px]"
                title={row.stripeSessionId}
                style={{ color: "var(--text-faint)" }}
              >
                {row.stripeSessionId.length > 18
                  ? `${row.stripeSessionId.slice(0, 12)}…${row.stripeSessionId.slice(-4)}`
                  : row.stripeSessionId}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Amount + status — amount column right-aligned for fast
          vertical scanning of "how much have I spent here." */}
      <div className="flex flex-col items-end gap-0.5">
        <span className="text-[14px] font-semibold tabular-nums" style={{ color: "var(--text)" }}>
          {amountText}
        </span>
        <span
          className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider"
          style={{ color: "var(--primary)" }}
        >
          <Check size={9} />
          Paid
        </span>
      </div>
    </div>
  );
}

function StatCard({
  label, value, Icon,
}: { label: string; value: string; Icon: typeof Receipt }) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-raised)" }}
    >
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
        <Icon size={11} />
        {label}
      </div>
      <div
        className="mt-1.5 text-[20px] font-semibold leading-tight"
        style={{ color: "var(--text)", fontFamily: "var(--font-source-serif)" }}
      >
        {value}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Security tab — password reset + placeholders for 2FA and sessions.
// ──────────────────────────────────────────────────────────────────────────
function SecurityTab({
  email,
  resetting,
  onResetPassword,
}: {
  email: string;
  resetting: boolean;
  onResetPassword: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <SectionHead
        title="Security"
        blurb="Keep your account safe."
      />

      <SectionCard>
        <div className="flex items-start gap-4">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: "var(--primary-soft)", color: "var(--primary)" }}
          >
            <ShieldCheck className="size-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
              Password
            </p>
            <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-muted)" }}>
              We&apos;ll email a secure link to {email || "your address"} to set a new one.
            </p>
          </div>
          <Button
            variant="secondary"
            iconLeft={<KeyRound className="size-4" />}
            loading={resetting}
            onClick={onResetPassword}
          >
            Reset password
          </Button>
        </div>
      </SectionCard>

      <SectionCard variant="muted">
        <ComingSoonRow
          title="Two-factor authentication"
          body="Add a second step to sign-in via TOTP authenticator app."
        />
      </SectionCard>

      <SectionCard variant="muted">
        <ComingSoonRow
          title="Active sessions"
          body="See every device signed in to your account. Sign out remotely from here."
        />
      </SectionCard>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Notifications tab — live email toggle (default ON, opt-out per ToS) +
// a "download the desktop app" CTA for OS-level push notifications.
//
// Why no in-app web push: customers want push when they're NOT actively
// on /room (engineer just joined, session is about to expire). Web
// PushManager is fiddly, requires VAPID keys + service workers + Safari
// has limited support. Cleaner answer: pull this into a native desktop
// shell where the OS handles the notification surface and lifecycle.
// The browser tab continues to use in-flow toasts (those don't need a
// preference — they're contextual to the session that's already open).
// ──────────────────────────────────────────────────────────────────────────
function NotificationsTab({
  emailEnabled,
  emailSaving,
  onToggleEmail,
}: {
  emailEnabled: boolean;
  emailSaving: boolean;
  onToggleEmail: (next: boolean) => void;
}) {
  // Best-effort detection of the desktop app. The native shell sets
  // `window.__RELAY_DESKTOP__ = true` at load — when present we hide the
  // download CTA and show an "installed" status pill instead.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const desktopInstalled = typeof window !== "undefined" && Boolean((window as any).__RELAY_DESKTOP__);

  return (
    <div className="flex flex-col gap-6">
      <SectionHead
        title="Notifications"
        blurb="How we get in touch about your sessions."
      />

      {/* Email — live toggle */}
      <SectionCard>
        <div className="flex items-start gap-4">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: "var(--primary-soft)", color: "var(--primary)" }}
          >
            <Mail className="size-5" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
                Email notifications
              </p>
              <StatusPill on={emailEnabled} />
            </div>
            <p className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
              Session summaries, engineer assignments, recharge receipts, and
              account safety messages. On by default per the{" "}
              <a
                href="/legal/terms-of-use"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
                style={{ color: "var(--text-muted)" }}
              >
                Terms
              </a>
              {" "}and{" "}
              <a
                href="/legal/privacy-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
                style={{ color: "var(--text-muted)" }}
              >
                Privacy Policy
              </a>
              {" "}— you can turn them off here whenever you like.
            </p>
            <p className="mt-2 text-[11px]" style={{ color: "var(--text-faint)" }}>
              Account-critical security emails (password resets, suspicious
              sign-in alerts) still come through even when this is off.
            </p>
          </div>
          <Toggle
            checked={emailEnabled}
            disabled={emailSaving}
            onChange={onToggleEmail}
            ariaLabel="Toggle email notifications"
          />
        </div>
      </SectionCard>

      {/* In-app — desktop app download or installed status */}
      <SectionCard>
        <div className="flex items-start gap-4">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: "var(--primary-soft)", color: "var(--primary)" }}
          >
            <BellRing className="size-5" />
          </div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
                In-app &amp; system notifications
              </p>
              {desktopInstalled ? (
                <StatusPill on label="Installed" />
              ) : (
                <span
                  className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                  style={{
                    backgroundColor: "color-mix(in srgb, var(--text) 8%, transparent)",
                    color: "var(--text-muted)",
                  }}
                >
                  Desktop only
                </span>
              )}
            </div>
            <p className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
              {desktopInstalled
                ? "You'll get OS-level notifications when an engineer joins, when your free minutes are running low, and when a session summary is ready — even when the browser tab is closed."
                : "Get OS-level push when an engineer joins, when minutes run low, and when a session summary is ready. Available exclusively through the Relay desktop app — install it once and notifications work even when the browser tab is closed."}
            </p>

            {!desktopInstalled && (
              <a
                href="/download-relay-desktop"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition-opacity hover:opacity-90"
                style={{
                  borderColor: "var(--primary)",
                  color: "var(--primary)",
                  backgroundColor: "transparent",
                }}
              >
                <DownloadIcon className="size-3.5" />
                Download Relay desktop
              </a>
            )}
          </div>
        </div>
      </SectionCard>

      {/* In-room toast preference — toasts that fire while you're already
          on /room don't need a server toggle, but worth surfacing so users
          understand the full notification landscape. */}
      <SectionCard variant="muted">
        <div className="flex items-start gap-4">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            style={{
              backgroundColor: "color-mix(in srgb, var(--text) 5%, transparent)",
              color: "var(--text-muted)",
            }}
          >
            <Monitor className="size-4" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
              In-room toasts
            </p>
            <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-muted)" }}>
              Banner messages that show up while you&apos;re actively on Relay
              (engineer joined, free time running out). Always on while
              you&apos;re in a session — they&apos;re part of the flow.
            </p>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

// Tiny dependency-free toggle. We don't want to pull in a switch component
// for one use — this gives us the right look (filled green when on, muted
// gray when off) using just var(--*) tokens so themes still apply.
function Toggle({
  checked, disabled, onChange, ariaLabel,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60"
      style={{
        backgroundColor: checked
          ? "var(--primary)"
          : "color-mix(in srgb, var(--text) 15%, transparent)",
      }}
    >
      <span
        className="inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform"
        style={{
          transform: checked ? "translateX(22px)" : "translateX(2px)",
        }}
      />
    </button>
  );
}

function StatusPill({ on, label }: { on: boolean; label?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
      style={{
        backgroundColor: on
          ? "color-mix(in srgb, var(--primary) 14%, transparent)"
          : "color-mix(in srgb, var(--text) 8%, transparent)",
        color: on ? "var(--primary)" : "var(--text-muted)",
      }}
    >
      {on ? <Check size={9} /> : null}
      {label ?? (on ? "On" : "Off")}
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Building blocks
// ──────────────────────────────────────────────────────────────────────────

function SectionHead({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h2
        className="text-[20px] font-semibold tracking-tight"
        style={{ color: "var(--text)", fontFamily: "var(--font-source-serif)" }}
      >
        {title}
      </h2>
      <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
        {blurb}
      </p>
    </div>
  );
}

function SectionCard({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "default" | "muted";
}) {
  return (
    <div
      className="rounded-2xl border p-5"
      style={{
        borderColor: "var(--border)",
        backgroundColor: variant === "muted"
          ? "color-mix(in srgb, var(--surface-raised) 60%, transparent)"
          : "var(--surface-raised)",
      }}
    >
      {children}
    </div>
  );
}

function Highlight({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="rounded-xl border p-3"
      style={{
        borderColor: "var(--border)",
        backgroundColor: "var(--surface)",
      }}
    >
      <div className="flex items-center gap-2">
        <Check size={13} style={{ color: "var(--primary)" }} />
        <div className="text-[12px] font-semibold" style={{ color: "var(--text)" }}>
          {title}
        </div>
      </div>
      <div className="mt-1 text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
        {body}
      </div>
    </div>
  );
}

function ComingSoonRow({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex items-start gap-4">
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
        style={{
          backgroundColor: "color-mix(in srgb, var(--text) 5%, transparent)",
          color: "var(--text-muted)",
        }}
      >
        <ChevronRight className="size-4" />
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
            {title}
          </p>
          <span
            className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
            style={{
              backgroundColor: "color-mix(in srgb, var(--text) 8%, transparent)",
              color: "var(--text-muted)",
            }}
          >
            Soon
          </span>
        </div>
        <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-muted)" }}>
          {body}
        </p>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Payment methods (saved cards)
// ──────────────────────────────────────────────────────────────────────
// Customer's saved Stripe cards. The list lives in the BillingTab
// above the lifetime stats. Adding a card opens a modal that wraps
// the Stripe PaymentElement in SetupIntent mode — no charge happens,
// just card-on-file attachment.
function PaymentMethodsCard() {
  const [items, setItems]     = useState<SavedPaymentMethod[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/payment-methods", { cache: "no-store" });
      const json = await res.json() as { paymentMethods?: SavedPaymentMethod[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to load payment methods");
      setItems(json.paymentMethods ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load payment methods.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleRemove = useCallback(async (id: string) => {
    if (removingId) return;
    if (typeof window !== "undefined" && !window.confirm("Remove this card?")) return;
    setRemovingId(id);
    try {
      const res = await fetch(`/api/billing/payment-methods?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to remove card");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove card.");
    } finally {
      setRemovingId(null);
    }
  }, [removingId, load]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h3
            className="text-[15px] font-semibold tracking-tight"
            style={{ color: "var(--text)" }}
          >
            Payment methods
          </h3>
          <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-muted)" }}>
            Saved cards skip checkout entry on future top-ups.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          iconLeft={<Plus className="size-4" />}
          onClick={() => setShowAdd(true)}
        >
          Add payment method
        </Button>
      </div>

      {error && (
        <div
          className="rounded-md border px-3 py-2 text-[12px]"
          style={{
            borderColor: "color-mix(in srgb, var(--accent-red) 30%, transparent)",
            backgroundColor: "color-mix(in srgb, var(--accent-red) 8%, transparent)",
            color: "var(--accent-red)",
          }}
        >
          {error}
        </div>
      )}

      {loading && !items && (
        <div
          className="rounded-2xl border p-4 text-[13px]"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-raised)", color: "var(--text-muted)" }}
        >
          <Loader2 className="mr-2 inline-block size-4 animate-spin" />
          Loading saved cards…
        </div>
      )}

      {items && items.length === 0 && !loading && (
        <div
          className="rounded-2xl border p-4 text-[13px]"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-raised)", color: "var(--text-muted)" }}
        >
          No saved cards yet. Add one to make future recharges one-click.
        </div>
      )}

      {items && items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {items.map((pm) => (
            <li
              key={pm.id}
              className="flex items-center gap-3 rounded-2xl border p-3"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-raised)" }}
            >
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
                style={{
                  backgroundColor: "var(--primary-soft)",
                  color: "var(--primary)",
                }}
              >
                <CreditCard className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium" style={{ color: "var(--text)" }}>
                    {brandLabel(pm.brand)} •••• {pm.last4}
                  </span>
                  {pm.isDefault && (
                    <span
                      className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                      style={{
                        backgroundColor: "color-mix(in srgb, var(--primary) 14%, transparent)",
                        color: "var(--primary)",
                      }}
                    >
                      Default
                    </span>
                  )}
                </div>
                <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  Expires {formatExp(pm.expMonth, pm.expYear) || "—"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleRemove(pm.id)}
                disabled={removingId === pm.id}
                aria-label={`Remove ${brandLabel(pm.brand)} ending ${pm.last4}`}
                title="Remove"
                className="flex h-8 w-8 items-center justify-center rounded-full transition-opacity hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/5"
                style={{ color: "var(--text-muted)" }}
              >
                {removingId === pm.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Trust strip — the explicit "where your card lives" line. Shown
          regardless of whether the customer has cards yet so the framing
          is set BEFORE they add one. Lock icon + plain prose; no
          color-shouting (this is reassurance, not a CTA). */}
      <div
        className="mt-1 flex items-start gap-1.5 px-1 text-[10.5px] leading-snug"
        style={{ color: "var(--text-muted)" }}
      >
        <Lock className="mt-0.5 size-3 shrink-0" />
        <span>
          Cards are held by Stripe (PCI DSS Level&nbsp;1) — Relay never sees the
          full card number. You can remove a card any time.
        </span>
      </div>

      {showAdd && (
        <AddPaymentMethodModal
          onClose={() => setShowAdd(false)}
          onAdded={() => {
            setShowAdd(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

// Modal wrapper. Fetches the SetupIntent client_secret, then mounts
// Stripe's <Elements> with the appropriate theme. Inner form does the
// confirmSetup call.
function AddPaymentMethodModal({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: () => void;
}) {
  const { theme } = useTheme();
  const stripePromise = getStripePromise();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/billing/payment-methods/setup-intent", {
          method: "POST",
        });
        const json = await res.json() as { clientSecret?: string; error?: string };
        if (!alive) return;
        if (!res.ok || !json.clientSecret) {
          throw new Error(json.error ?? "Couldn't initialize card setup.");
        }
        setClientSecret(json.clientSecret);
      } catch (e) {
        if (!alive) return;
        setFetchError(e instanceof Error ? e.message : "Couldn't initialize card setup.");
      }
    })();
    return () => { alive = false; };
  }, []);

  // Theme-aware Elements appearance. The key={theme} on <Elements>
  // forces a remount on theme switch so the appearance re-resolves.
  const appearance = useMemo(() => buildStripeAppearance(), [theme]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div
        className="fixed inset-0 z-[60]"
        style={{ backgroundColor: "var(--scrim)" }}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="fixed left-1/2 top-1/2 z-[61] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border shadow-2xl"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "var(--surface)",
          boxShadow: "0 24px 64px rgba(0, 0, 0, 0.5)",
        }}
      >
        <div className="flex items-start gap-3 border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <div
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            style={{
              backgroundColor: "var(--primary-soft)",
              color: "var(--primary)",
            }}
          >
            <CreditCard size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold" style={{ color: "var(--text)" }}>
              Add a payment method
            </h2>
            <p className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
              No charge happens now — your card is held on file so future top-ups skip
              card entry. Downloadable receipts land in Account → Billing after every
              recharge.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-md transition-opacity hover:bg-black/5 dark:hover:bg-white/5"
            style={{ color: "var(--text-muted)" }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4">
          {/* Card-on-file mandate disclosure. Submitting the form is the
              consent act — this is the PSD2-compliant pattern Stripe
              itself recommends for "save card for future use" flows. The
              India/Brazil caveat warns users whose issuers don't permit
              cross-border tokenization (RBI etc.); without it they'd
              hit a confusing Stripe-side decline at confirm-time. */}
          <div
            className="mb-4 rounded-lg border px-3 py-2.5 text-[11.5px] leading-relaxed"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--surface-raised)",
              color: "var(--text-muted)",
            }}
          >
            By saving this card, you authorize{" "}
            <span style={{ color: "var(--text)", fontWeight: 600 }}>Relay</span>{" "}
            to charge it for top-ups you confirm in your Wallet. We never store
            your full card number — your card is held by Stripe (PCI DSS
            Level&nbsp;1). You can remove the card at any time.
            <br />
            <span style={{ display: "block", marginTop: 6 }}>
              Card-on-file rules vary by country. Cards issued in{" "}
              <span style={{ color: "var(--text)", fontWeight: 500 }}>India, Brazil</span>{" "}
              and a few other markets may need to be re-entered each top-up due
              to local regulator (e.g. RBI) tokenization rules — your card
              issuer will decline the save if so.
            </span>
          </div>

          {fetchError && (
            <div
              className="rounded-md border px-3 py-2 text-[12px]"
              style={{
                borderColor: "color-mix(in srgb, var(--accent-red) 30%, transparent)",
                backgroundColor: "color-mix(in srgb, var(--accent-red) 8%, transparent)",
                color: "var(--accent-red)",
              }}
            >
              {fetchError}
            </div>
          )}
          {!fetchError && !clientSecret && (
            <div className="flex items-center gap-2 py-6 text-[13px]" style={{ color: "var(--text-muted)" }}>
              <Loader2 className="size-4 animate-spin" /> Preparing the card form…
            </div>
          )}
          {!fetchError && clientSecret && stripePromise && (
            <Elements
              key={theme}
              stripe={stripePromise}
              options={{ clientSecret, appearance }}
            >
              <AddPaymentMethodForm onCancel={onClose} onSuccess={onAdded} />
            </Elements>
          )}
          {!fetchError && clientSecret && !stripePromise && (
            <div
              className="rounded-md border px-3 py-2 text-[12px]"
              style={{
                borderColor: "color-mix(in srgb, var(--warn) 30%, transparent)",
                backgroundColor: "color-mix(in srgb, var(--warn) 8%, transparent)",
                color: "var(--warn)",
              }}
            >
              Stripe publishable key isn&apos;t configured for this build.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// Inner form — runs inside <Elements>. Uses Stripe's PaymentElement +
// confirmSetup to attach the card to the customer.
function AddPaymentMethodForm({
  onCancel,
  onSuccess,
}: {
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const stripe   = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    if (!stripe || !elements || submitting) return;
    setSubmitting(true);
    setErrMsg(null);
    const { error } = await stripe.confirmSetup({
      elements,
      // No redirect — we want to stay on the page. Stripe only redirects
      // for 3DS / wallet methods where it's required.
      redirect: "if_required",
    });
    if (error) {
      setErrMsg(error.message ?? "Couldn't save the card.");
      setSubmitting(false);
      return;
    }
    onSuccess();
  }, [stripe, elements, submitting, onSuccess]);

  return (
    <div className="flex flex-col gap-3">
      <PaymentElement options={{ layout: { type: "tabs", defaultCollapsed: false } }} />
      {errMsg && (
        <div
          className="rounded-md border px-3 py-2 text-[12px]"
          style={{
            borderColor: "color-mix(in srgb, var(--accent-red) 30%, transparent)",
            backgroundColor: "color-mix(in srgb, var(--accent-red) 8%, transparent)",
            color: "var(--accent-red)",
          }}
        >
          {errMsg}
        </div>
      )}
      <div className="mt-1 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/5"
          style={{ color: "var(--text-muted)" }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!stripe || !elements || submitting}
          className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ backgroundColor: "var(--primary)" }}
        >
          {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {submitting ? "Saving…" : "Save card"}
        </button>
      </div>
    </div>
  );
}
