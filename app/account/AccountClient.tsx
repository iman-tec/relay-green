"use client";

/*
 * Customer profile page (master-prompt §5).
 *
 * Fields:
 *   - Name                 editable   → customer_profiles.display_name
 *   - Email                read-only  → auth.users.email
 *   - Technical expertise  read-only  → mirrored from the durable Q1 intake
 *                          answer (never re-asked); seeded on first load
 *   - Field of interest    editable   → pills + "Other" free text
 *   - Profile image        editable   → upload (JPG/PNG/WebP ≤ 2 MB) with a
 *                          live preview before save → `avatars` bucket
 *   - Reset password       action     → Supabase recovery email → /set-password
 *
 * Persistence is the `customer_profiles` table; the localStorage profile
 * (lib/relay/profile.ts) is kept in sync so the intake/return flows stay
 * consistent on this device.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Building2, Camera, Check, CreditCard, KeyRound, Loader2, Mail,
  ShieldCheck, Trash2, Wallet,
} from "lucide-react";
import { Wordmark } from "@/app/_components/Wordmark";
import {
  Avatar, Button, Card, CardBody, CardHeader, Chip, ChipGroup, Input, Toast, cn,
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

type Auth =
  | { kind: "loading" }
  | { kind: "anonymous" }
  | { kind: "authed"; userId: string; email: string };

type Banner = { tone: "ok" | "risk" | "info"; text: string } | null;

// Mirrors /api/customer/me-employment. Employees draw minutes from a
// department pool, so they see an enterprise summary instead of a recharge.
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

const OTHER = "Other";

export function AccountClient() {
  const router = useRouter();
  const sbRef = useRef(createClient());

  const [auth, setAuth] = useState<Auth>({ kind: "loading" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [resetting, setResetting] = useState(false);

  // Wallet / recharge — same data + Stripe paywall the room uses.
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [paywallOpen, setPaywallOpen] = useState(false);

  // ── Editable form state ───────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const [interestOther, setInterestOther] = useState("");
  const [expertise, setExpertise] = useState<TechComfort | null>(null);

  // Persisted avatar URL + a staged (not-yet-uploaded) file with local preview.
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [stagedFile, setStagedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showBanner = useCallback((b: NonNullable<Banner>) => {
    setBanner(b);
    if (b.tone === "ok") setTimeout(() => setBanner(null), 4000);
  }, []);

  // ── Auth bootstrap ────────────────────────────────────────────────────────
  useEffect(() => {
    const sb = sbRef.current;
    let alive = true;
    sb.auth.getUser().then(({ data, error }) => {
      if (!alive) return;
      if (error || !data.user) {
        setAuth({ kind: "anonymous" });
        router.replace("/login");
        return;
      }
      setAuth({ kind: "authed", userId: data.user.id, email: data.user.email ?? "" });
    });
    return () => { alive = false; };
  }, [router]);

  // ── Load the profile row (+ seed expertise from intake / localStorage) ─────
  useEffect(() => {
    if (auth.kind !== "authed") return;
    const sb = sbRef.current;
    let alive = true;

    (async () => {
      setLoading(true);
      const local = readProfile();

      const { data: row } = await sb
        .from("customer_profiles")
        .select("*")
        .eq("user_id", auth.userId)
        .maybeSingle();
      const profile = (row as CustomerProfileRow | null) ?? null;

      // Resolve the read-only expertise: profile row → latest intake → local.
      let resolvedExpertise: TechComfort | null = profile?.technical_expertise ?? null;
      if (!resolvedExpertise) {
        const { data: intake } = await sb
          .from("client_intakes")
          .select("familiarity")
          .eq("customer_user_id", auth.userId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        resolvedExpertise =
          techComfortFromFamiliarity((intake as { familiarity?: string } | null)?.familiarity) ??
          local.techComfort ??
          null;
      }

      if (!alive) return;

      // Standard pills vs. a free-text value get split into pills + "Other".
      const stored = profile?.fields_of_interest ?? [];
      const known = stored.filter((s) =>
        (FIELD_OF_INTEREST_OPTIONS as readonly string[]).includes(s),
      );
      const customOther = profile?.interest_other ?? stored.find((s) =>
        !(FIELD_OF_INTEREST_OPTIONS as readonly string[]).includes(s),
      ) ?? "";

      setName(profile?.display_name ?? "");
      setInterests(known);
      setInterestOther(customOther);
      setExpertise(resolvedExpertise);
      setAvatarUrl(profile?.avatar_url ?? null);
      setLoading(false);

      // Durably backfill expertise the very first time we derive it, so Q1
      // truly is "stored permanently, never asked again".
      if (resolvedExpertise && !profile?.technical_expertise) {
        void sb.from("customer_profiles").upsert(
          { user_id: auth.userId, technical_expertise: resolvedExpertise },
          { onConflict: "user_id" },
        );
      }
    })();

    return () => { alive = false; };
  }, [auth]);

  // Load wallet balance + free status + employment for the Wallet section
  // (same sources useCustomerSession reads in /room).
  useEffect(() => {
    if (auth.kind !== "authed") return;
    const sb = sbRef.current;
    let alive = true;
    (async () => {
      const [walletRes, entRes, emp] = await Promise.all([
        sb.from("credit_wallets").select("balance").eq("user_id", auth.userId).maybeSingle(),
        sb.from("customer_entitlements").select("free_session_consumed_at").eq("customer_user_id", auth.userId).maybeSingle(),
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
  }, [auth]);

  // Revoke the object URL when the staged file changes / unmounts.
  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  const onPickFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
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

  const interestsSelected = useMemo(() => {
    const base = interests.filter((i) => i !== OTHER);
    const other = interests.includes(OTHER) && interestOther.trim()
      ? [interestOther.trim()]
      : [];
    return [...base, ...other];
  }, [interests, interestOther]);

  // ── Save ────────────────────────────────────────────────────────────────
  const onSave = useCallback(async () => {
    if (auth.kind !== "authed") return;
    setSaving(true);
    setBanner(null);
    const sb = sbRef.current;

    try {
      let nextAvatarUrl = avatarUrl;

      // Upload a freshly-staged avatar under <user_id>/… then resolve its
      // public URL (the bucket is public, so no signing needed).
      if (stagedFile) {
        const ext = stagedFile.type === "image/png" ? "png"
          : stagedFile.type === "image/webp" ? "webp" : "jpg";
        const path = `${auth.userId}/avatar-${Date.now()}.${ext}`;
        const { error: upErr } = await sb.storage
          .from("avatars")
          .upload(path, stagedFile, { upsert: true, contentType: stagedFile.type });
        if (upErr) throw new Error(`Photo upload failed: ${upErr.message}`);
        nextAvatarUrl = sb.storage.from("avatars").getPublicUrl(path).data.publicUrl;
      }

      const payload = {
        user_id: auth.userId,
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

      // Keep the on-device intake cache aligned.
      patchProfile({ techComfort: expertise });

      setAvatarUrl(nextAvatarUrl);
      clearStaged();
      showBanner({ tone: "ok", text: "Profile saved." });
    } catch (err) {
      showBanner({ tone: "risk", text: err instanceof Error ? err.message : "Could not save profile." });
    } finally {
      setSaving(false);
    }
  }, [auth, avatarUrl, stagedFile, name, interests, interestOther, expertise, clearStaged, showBanner]);

  // ── Reset password ────────────────────────────────────────────────────────
  const onResetPassword = useCallback(async () => {
    if (auth.kind !== "authed" || !auth.email) return;
    setResetting(true);
    setBanner(null);
    try {
      const redirectTo = `${window.location.origin}/set-password?mode=customer`;
      const { error } = await sbRef.current.auth.resetPasswordForEmail(auth.email, { redirectTo });
      if (error) throw new Error(error.message);
      showBanner({ tone: "ok", text: `We've sent a password reset link to ${auth.email}.` });
    } catch (err) {
      showBanner({ tone: "risk", text: err instanceof Error ? err.message : "Could not send reset link." });
    } finally {
      setResetting(false);
    }
  }, [auth, showBanner]);

  const email = auth.kind === "authed" ? auth.email : "";
  const shownAvatar = previewUrl ?? avatarUrl;

  if (loading || auth.kind === "loading") {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-[var(--background)]">
        <Loader2 className="size-6 animate-spin text-[var(--text-muted)]" />
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-[var(--background)]">
      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-5 py-3">
          <button
            type="button"
            onClick={() => router.push("/room")}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]"
          >
            <ArrowLeft className="size-4" /> Back to room
          </button>
          <Wordmark />
        </div>
      </header>

      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-8">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif text-3xl leading-tight tracking-tight text-[var(--text)]">
            Your profile
          </h1>
          <p className="text-sm text-[var(--text-muted)]">
            Keep these up to date so your engineer has the right context.
          </p>
        </div>

        {banner && <Toast tone={banner.tone}>{banner.text}</Toast>}

        {/* ── Identity ───────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <h2 className="font-serif text-lg text-[var(--text)]">Identity</h2>
          </CardHeader>
          <CardBody className="flex flex-col gap-6">
            {/* Avatar */}
            <div className="flex items-center gap-4">
              <Avatar src={shownAvatar} name={name} email={email} size="lg" tone="brand" />
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
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
                      onClick={clearStaged}
                    >
                      Discard
                    </Button>
                  )}
                </div>
                <p className="text-xs text-[var(--text-muted)]">
                  JPG, PNG, or WebP · up to 2 MB
                  {stagedFile && (
                    <span className="ml-1 text-[var(--primary)]">· preview shown, not yet saved</span>
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

            <Input
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              autoComplete="name"
            />

            {/* Email — read-only */}
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-[var(--text)]">Email address</span>
              <div className="flex h-11 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3.5 text-[15px] text-[var(--text-muted)]">
                <Mail className="size-4 shrink-0" />
                <span className="truncate">{email || "—"}</span>
              </div>
              <p className="text-xs text-[var(--text-muted)]">Email can&apos;t be changed.</p>
            </div>

            {/* Technical expertise — read-only, from Q1 */}
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-[var(--text)]">Level of technical expertise</span>
              <div>
                <Chip static active={!!expertise}>{techComfortLabel(expertise)}</Chip>
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                Set from your first intake and used to right-size every session.
              </p>
            </div>
          </CardBody>
        </Card>

        {/* ── Wallet / recharge ───────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <h2 className="font-serif text-lg text-[var(--text)]">Wallet</h2>
          </CardHeader>
          <CardBody>
            {!wallet ? (
              <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                <Loader2 className="size-4 animate-spin" /> Loading balance…
              </div>
            ) : wallet.employment?.isEmployee ? (
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--primary-soft)] text-[var(--primary)]">
                  <Building2 className="size-5" />
                </span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-[var(--text)]">Enterprise plan</p>
                  <p className="text-sm text-[var(--text-muted)]">
                    {wallet.employment.remainingMinutes > 0
                      ? `${Math.round(wallet.employment.remainingMinutes).toLocaleString()} min available`
                      : "Out of credits"}
                    {wallet.employment.departmentName ? ` · ${wallet.employment.departmentName}` : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--text-faint)]">
                    {wallet.employment.enterpriseName} — minutes are managed by your organization.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--primary-soft)] text-[var(--primary)]">
                    <Wallet className="size-5" />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-[var(--text)]">
                      {wallet.paidMinutes > 0 ? "Paid plan" : "Free plan"}
                    </p>
                    <p className="text-sm text-[var(--text-muted)]">
                      {wallet.paidMinutes > 0
                        ? `${wallet.paidMinutes.toFixed(2)} min remaining`
                        : wallet.freeConsumed
                          ? "Free session used — recharge to keep going"
                          : "10 min free available"}
                    </p>
                  </div>
                </div>
                <Button
                  variant={wallet.paidMinutes > 0 ? "secondary" : "primary"}
                  iconLeft={<CreditCard className="size-4" />}
                  onClick={() => setPaywallOpen(true)}
                >
                  Recharge
                </Button>
              </div>
            )}
          </CardBody>
        </Card>

        {/* ── Professional background ─────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <h2 className="font-serif text-lg text-[var(--text)]">Field of interest</h2>
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            <p className="text-sm text-[var(--text-muted)]">
              Pick what best describes your professional background.
            </p>
            <ChipGroup
              options={FIELD_OF_INTEREST_OPTIONS}
              value={interests}
              multi
              onChange={setInterests}
              label="Field of interest"
            />
            {interests.includes(OTHER) && (
              <Input
                label="Tell us more"
                value={interestOther}
                onChange={(e) => setInterestOther(e.target.value)}
                placeholder="e.g. Healthcare, Education, Logistics…"
              />
            )}
          </CardBody>
        </Card>

        {/* ── Security ────────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <h2 className="font-serif text-lg text-[var(--text)]">Security</h2>
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--primary-soft)] text-[var(--primary)]">
                <ShieldCheck className="size-5" />
              </span>
              <div className="flex-1">
                <p className="text-sm font-medium text-[var(--text)]">Password</p>
                <p className="text-sm text-[var(--text-muted)]">
                  We&apos;ll email a secure link to set a new password.
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
          </CardBody>
        </Card>

        {/* ── Save bar ────────────────────────────────────────────────────── */}
        <div className={cn(
          "sticky bottom-4 flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)]",
          "bg-[var(--surface)]/95 px-5 py-3 shadow-lg backdrop-blur",
        )}>
          <p className="text-xs text-[var(--text-muted)]">
            {interestsSelected.length > 0
              ? `${interestsSelected.length} interest${interestsSelected.length === 1 ? "" : "s"} selected`
              : "Changes apply to every session."}
          </p>
          <Button
            iconLeft={saving ? undefined : <Check className="size-4" />}
            loading={saving}
            onClick={onSave}
          >
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>

      <PaywallModal
        open={paywallOpen}
        reason="manual"
        onClose={() => setPaywallOpen(false)}
      />
    </main>
  );
}
