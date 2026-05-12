"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Copy,
  Check,
  Wallet,
  TrendingUp,
  CheckCircle2,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const MALAYSIAN_BANKS = [
  "Maybank", "CIMB Bank", "Public Bank", "RHB Bank", "Hong Leong Bank",
  "AmBank", "Bank Islam", "Bank Rakyat", "BSN", "Affin Bank",
  "Alliance Bank", "OCBC Bank", "HSBC Bank", "Standard Chartered", "UOB Bank",
  "Bank Muamalat", "Agrobank", "MBSB Bank", "Al-Rajhi Bank",
];

const MIN_CASHOUT = 50;

type Commission = {
  id: string;
  referred_user_id: string;
  payment_amount: number;
  commission_rate: number;
  commission_amount: number;
  commission_type: string;
  created_at: string;
};

type Cashout = {
  id: string;
  amount: number;
  bank_name: string;
  bank_account_name: string;
  bank_account_number: string;
  status: "pending" | "approved" | "rejected" | "paid";
  admin_note: string | null;
  created_at: string;
  paid_at: string | null;
};

type ReferredUser = {
  id: string;
  full_name: string | null;
  plan: string | null;
  plan_expires_at: string | null;
  created_at: string;
};

type Profile = {
  referral_code: string | null;
  wallet_balance: number;
  full_name: string | null;
};

type Tab = "overview" | "commissions" | "referrals" | "cashout";

export default function AffiliateSection() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [cashouts, setCashouts] = useState<Cashout[]>([]);
  const [referrals, setReferrals] = useState<ReferredUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Cashout form
  const [cashoutAmount, setCashoutAmount] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccountName, setBankAccountName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cashoutError, setCashoutError] = useState<string | null>(null);
  const [cashoutOk, setCashoutOk] = useState<string | null>(null);

  useEffect(() => {
    void loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const sb = createClient();
      const {
        data: { user },
      } = await sb.auth.getUser();
      if (!user) return;

      const [profileRes, commRes, cashRes] = await Promise.all([
        sb
          .from("profiles")
          .select("referral_code, wallet_balance, full_name")
          .eq("id", user.id)
          .single(),
        sb
          .from("referral_commissions")
          .select("*")
          .eq("referrer_id", user.id)
          .order("created_at", { ascending: false })
          .limit(100),
        sb
          .from("cashout_requests")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);

      const prof = profileRes.data as Profile | null;
      setProfile(prof);
      setCommissions((commRes.data as Commission[]) || []);
      setCashouts((cashRes.data as Cashout[]) || []);

      // Referred users — read profiles where referred_by = my code.
      if (prof?.referral_code) {
        const { data: refData } = await sb
          .from("profiles")
          .select("id, full_name, plan, plan_expires_at, created_at")
          .eq("referred_by", prof.referral_code)
          .order("created_at", { ascending: false })
          .limit(100);
        setReferrals((refData as ReferredUser[]) || []);
      }
    } finally {
      setLoading(false);
    }
  }

  const totalEarned = useMemo(
    () => commissions.reduce((s, c) => s + Number(c.commission_amount || 0), 0),
    [commissions]
  );
  const totalCashedOut = useMemo(
    () =>
      cashouts
        .filter((c) => c.status === "paid")
        .reduce((s, c) => s + Number(c.amount || 0), 0),
    [cashouts]
  );
  const reservedAmount = useMemo(
    () =>
      cashouts
        .filter((c) => c.status === "pending" || c.status === "approved")
        .reduce((s, c) => s + Number(c.amount || 0), 0),
    [cashouts]
  );
  const walletBalance = Number(profile?.wallet_balance || 0);
  const availableBalance = Number((walletBalance - reservedAmount).toFixed(2));

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined" || !profile?.referral_code) return "";
    return `${window.location.origin}/?ref=${profile.referral_code}`;
  }, [profile?.referral_code]);

  function copyText(value: string, kind: "code" | "link") {
    void navigator.clipboard.writeText(value);
    if (kind === "code") {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1500);
    } else {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 1500);
    }
  }

  async function submitCashout() {
    setCashoutError(null);
    setCashoutOk(null);
    const amount = parseFloat(cashoutAmount);
    if (!Number.isFinite(amount) || amount < MIN_CASHOUT) {
      setCashoutError(`Minimum cashout is RM ${MIN_CASHOUT}`);
      return;
    }
    if (amount > availableBalance) {
      setCashoutError(
        `Amount exceeds available balance (RM ${availableBalance.toFixed(2)})`
      );
      return;
    }
    if (!bankName || !bankAccountName || !bankAccountNumber.trim()) {
      setCashoutError("Please fill in all bank details");
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch("/api/affiliate/cashout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount,
          bank_name: bankName,
          bank_account_name: bankAccountName,
          bank_account_number: bankAccountNumber.trim(),
        }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) {
        setCashoutError(d?.error || "Cashout submission failed");
        return;
      }
      setCashoutOk("Request submitted. Admin will process within 1–3 days.");
      setCashoutAmount("");
      setBankAccountName("");
      setBankAccountNumber("");
      await loadAll();
    } catch (e: any) {
      setCashoutError(e?.message || "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--color-text-muted)]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-extrabold text-3xl tracking-tight">
          Affiliate
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Manage your referral earnings and cashout
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Wallet Balance"
          value={`RM ${walletBalance.toFixed(2)}`}
          icon={<Wallet className="w-4 h-4" />}
          tint="emerald"
        />
        <StatCard
          label="Total Earned"
          value={`RM ${totalEarned.toFixed(2)}`}
          icon={<TrendingUp className="w-4 h-4" />}
          tint="blue"
        />
        <StatCard
          label="Total Cashed Out"
          value={`RM ${totalCashedOut.toFixed(2)}`}
          icon={<CheckCircle2 className="w-4 h-4" />}
          tint="violet"
        />
        <StatCard
          label="Referrals"
          value={String(referrals.length)}
          icon={<Users className="w-4 h-4" />}
          tint="amber"
        />
      </div>

      {/* Referral code + share link */}
      {profile?.referral_code && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-1">
                Your Referral Code
              </p>
              <p className="text-2xl font-mono font-extrabold text-orange">
                {profile.referral_code}
              </p>
            </div>
            <button
              onClick={() => copyText(profile.referral_code!, "code")}
              className="px-4 py-2 rounded-lg text-sm font-bold inline-flex items-center gap-2"
              style={{
                background: "rgba(245,158,11,0.12)",
                border: "1px solid rgba(245,158,11,0.4)",
                color: "#d97706",
              }}
            >
              {copiedCode ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copiedCode ? "Copied" : "Copy Code"}
            </button>
          </div>

          <div
            className="rounded-lg p-3"
            style={{
              background: "var(--color-bg-card)",
              border: "1px solid var(--color-border)",
            }}
          >
            <p className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-2">
              Share this link to invite friends
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={shareUrl}
                className="flex-1 bg-transparent text-xs font-mono outline-none"
              />
              <button
                onClick={() => copyText(shareUrl, "link")}
                className="px-3 py-2 rounded-lg text-xs font-bold text-white inline-flex items-center gap-1.5"
                style={{ background: "#16a34a" }}
              >
                {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedLink ? "Copied" : "Copy Link"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-[var(--color-bg-card)] max-w-xl">
        {(
          [
            { key: "overview" as const, label: "Overview" },
            { key: "commissions" as const, label: "Commissions" },
            { key: "referrals" as const, label: "Referrals" },
            { key: "cashout" as const, label: "Cash Out" },
          ]
        ).map((t) => {
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className="flex-1 py-2 rounded-lg text-xs font-bold transition"
              style={
                active
                  ? {
                      background: "var(--color-orange)",
                      color: "white",
                      boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
                    }
                  : { background: "transparent", color: "var(--color-text-muted)" }
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === "overview" && (
        <OverviewTab
          referrals={referrals.length}
          commissions={commissions.length}
          totalEarned={totalEarned}
          availableBalance={availableBalance}
          reservedAmount={reservedAmount}
        />
      )}

      {activeTab === "commissions" && <CommissionsTab commissions={commissions} />}

      {activeTab === "referrals" && <ReferralsTab referrals={referrals} />}

      {activeTab === "cashout" && (
        <CashoutTab
          cashouts={cashouts}
          availableBalance={availableBalance}
          amount={cashoutAmount}
          setAmount={setCashoutAmount}
          bankName={bankName}
          setBankName={setBankName}
          bankAccountName={bankAccountName}
          setBankAccountName={setBankAccountName}
          bankAccountNumber={bankAccountNumber}
          setBankAccountNumber={setBankAccountNumber}
          submitting={submitting}
          onSubmit={submitCashout}
          error={cashoutError}
          ok={cashoutOk}
        />
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  tint,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tint: "emerald" | "blue" | "violet" | "amber";
}) {
  const tints: Record<string, { bg: string; fg: string; bd: string }> = {
    emerald: { bg: "rgba(16,185,129,0.08)", fg: "#047857", bd: "rgba(16,185,129,0.3)" },
    blue:    { bg: "rgba(59,130,246,0.08)", fg: "#1d4ed8", bd: "rgba(59,130,246,0.3)" },
    violet:  { bg: "rgba(139,92,246,0.08)", fg: "#6d28d9", bd: "rgba(139,92,246,0.3)" },
    amber:   { bg: "rgba(245,158,11,0.10)", fg: "#b45309", bd: "rgba(245,158,11,0.3)" },
  };
  const t = tints[tint];
  return (
    <div
      className="rounded-xl p-4"
      style={{ background: t.bg, border: `1px solid ${t.bd}`, color: t.fg }}
    >
      <div className="flex items-center gap-1.5 text-xs font-bold mb-1">
        {icon}
        {label}
      </div>
      <p className="text-xl font-extrabold">{value}</p>
    </div>
  );
}

function OverviewTab({
  referrals,
  commissions,
  totalEarned,
  availableBalance,
  reservedAmount,
}: {
  referrals: number;
  commissions: number;
  totalEarned: number;
  availableBalance: number;
  reservedAmount: number;
}) {
  return (
    <div className="card p-5 space-y-3">
      <h2 className="font-display font-bold text-lg">How affiliate works</h2>
      <ul className="text-sm text-[var(--color-text-secondary)] list-disc pl-5 space-y-1.5">
        <li>Share your link or referral code with friends</li>
        <li>When they subscribe through your link, you earn a commission on every payment (first purchase + renewals)</li>
        <li>Wallet balance updates the moment the payment clears</li>
        <li>Withdraw via the Cash Out tab — minimum RM 50, paid to your Malaysian bank account within 1–3 days</li>
      </ul>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pt-3">
        <SummaryRow label="Total referrals" value={String(referrals)} />
        <SummaryRow label="Commission events" value={String(commissions)} />
        <SummaryRow label="Total earned" value={`RM ${totalEarned.toFixed(2)}`} />
        <SummaryRow label="Available to withdraw" value={`RM ${availableBalance.toFixed(2)}`} />
        <SummaryRow label="Reserved (pending cashouts)" value={`RM ${reservedAmount.toFixed(2)}`} />
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-lg p-3"
      style={{
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
      }}
    >
      <p className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-1">
        {label}
      </p>
      <p className="text-sm font-bold">{value}</p>
    </div>
  );
}

function CommissionsTab({ commissions }: { commissions: Commission[] }) {
  if (commissions.length === 0) {
    return <EmptyState text="No commissions yet. Share your code to start earning." />;
  }
  return (
    <div className="card p-5">
      <h2 className="font-display font-bold text-lg mb-3">My Commissions ({commissions.length})</h2>
      <div className="space-y-2">
        {commissions.map((c) => (
          <div
            key={c.id}
            className="flex items-center justify-between p-3 rounded-lg"
            style={{
              background: "var(--color-bg-card)",
              border: "1px solid var(--color-border)",
            }}
          >
            <div>
              <p className="text-sm font-bold">
                +RM {Number(c.commission_amount).toFixed(2)}
              </p>
              <p className="text-[11px] text-[var(--color-text-muted)]">
                {c.commission_rate}% of RM {Number(c.payment_amount).toFixed(2)} · {c.commission_type}
              </p>
            </div>
            <p className="text-[11px] font-mono text-[var(--color-text-muted)]">
              {new Date(c.created_at).toLocaleDateString("en-MY")}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReferralsTab({ referrals }: { referrals: ReferredUser[] }) {
  if (referrals.length === 0) {
    return <EmptyState text="No referrals yet. Share your code to get started!" />;
  }
  return (
    <div className="card p-5">
      <h2 className="font-display font-bold text-lg mb-3">
        My Referrals ({referrals.length})
      </h2>
      <div className="space-y-2">
        {referrals.map((r) => (
          <div
            key={r.id}
            className="flex items-center justify-between p-3 rounded-lg"
            style={{
              background: "var(--color-bg-card)",
              border: "1px solid var(--color-border)",
            }}
          >
            <div>
              <p className="text-sm font-bold">{r.full_name || "(no name)"}</p>
              <p className="text-[11px] text-[var(--color-text-muted)]">
                {r.plan ? r.plan.toUpperCase() : "no plan"}
                {r.plan_expires_at &&
                  ` · until ${new Date(r.plan_expires_at).toLocaleDateString("en-MY")}`}
              </p>
            </div>
            <p className="text-[11px] font-mono text-[var(--color-text-muted)]">
              joined {new Date(r.created_at).toLocaleDateString("en-MY")}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function CashoutTab({
  cashouts,
  availableBalance,
  amount,
  setAmount,
  bankName,
  setBankName,
  bankAccountName,
  setBankAccountName,
  bankAccountNumber,
  setBankAccountNumber,
  submitting,
  onSubmit,
  error,
  ok,
}: {
  cashouts: Cashout[];
  availableBalance: number;
  amount: string;
  setAmount: (v: string) => void;
  bankName: string;
  setBankName: (v: string) => void;
  bankAccountName: string;
  setBankAccountName: (v: string) => void;
  bankAccountNumber: string;
  setBankAccountNumber: (v: string) => void;
  submitting: boolean;
  onSubmit: () => void;
  error: string | null;
  ok: string | null;
}) {
  return (
    <div className="space-y-4">
      <div className="card p-5">
        <h2 className="font-display font-bold text-lg mb-1">Request Cashout</h2>
        <p className="text-xs text-[var(--color-text-secondary)] mb-4">
          Minimum RM {MIN_CASHOUT}. Available balance:{" "}
          <strong>RM {availableBalance.toFixed(2)}</strong>.
        </p>

        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold mb-1.5">Amount (RM)</label>
            <input
              type="number"
              min={MIN_CASHOUT}
              max={availableBalance}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={`${MIN_CASHOUT}.00`}
              className="input"
            />
          </div>
          <div>
            <label className="block text-xs font-bold mb-1.5">Bank</label>
            <select
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              className="input"
            >
              <option value="">— Select bank —</option>
              {MALAYSIAN_BANKS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold mb-1.5">Account Holder Name</label>
            <input
              type="text"
              value={bankAccountName}
              onChange={(e) => setBankAccountName(e.target.value)}
              placeholder="As per bank record"
              className="input"
            />
          </div>
          <div>
            <label className="block text-xs font-bold mb-1.5">Account Number</label>
            <input
              type="text"
              value={bankAccountNumber}
              onChange={(e) => setBankAccountNumber(e.target.value)}
              placeholder="Numbers only"
              className="input"
            />
          </div>
        </div>

        <button
          onClick={onSubmit}
          disabled={submitting || availableBalance < MIN_CASHOUT}
          className="btn-primary mt-4 disabled:opacity-50"
        >
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          Submit Cashout Request
        </button>

        {error && (
          <div
            className="mt-3 px-4 py-2.5 rounded-lg text-xs font-semibold"
            style={{
              background: "rgba(244,67,54,0.08)",
              border: "1px solid rgba(244,67,54,0.4)",
              color: "#c62828",
            }}
          >
            {error}
          </div>
        )}
        {ok && (
          <div
            className="mt-3 px-4 py-2.5 rounded-lg text-xs font-semibold"
            style={{
              background: "rgba(16,185,129,0.08)",
              border: "1px solid rgba(16,185,129,0.4)",
              color: "#047857",
            }}
          >
            {ok}
          </div>
        )}
      </div>

      <div className="card p-5">
        <h2 className="font-display font-bold text-lg mb-3">
          Cashout History ({cashouts.length})
        </h2>
        {cashouts.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No cashout requests yet.</p>
        ) : (
          <div className="space-y-2">
            {cashouts.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between p-3 rounded-lg"
                style={{
                  background: "var(--color-bg-card)",
                  border: "1px solid var(--color-border)",
                }}
              >
                <div>
                  <p className="text-sm font-bold">
                    RM {Number(c.amount).toFixed(2)} → {c.bank_name}
                  </p>
                  <p className="text-[11px] text-[var(--color-text-muted)]">
                    {c.bank_account_name} · {c.bank_account_number}
                  </p>
                  {c.admin_note && (
                    <p className="text-[11px] text-[var(--color-text-secondary)] mt-1 italic">
                      Note: {c.admin_note}
                    </p>
                  )}
                </div>
                <StatusBadge status={c.status} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Cashout["status"] }) {
  const map: Record<Cashout["status"], { bg: string; fg: string; label: string }> = {
    pending:  { bg: "rgba(245,158,11,0.12)", fg: "#b45309", label: "Pending" },
    approved: { bg: "rgba(59,130,246,0.12)", fg: "#1d4ed8", label: "Approved" },
    paid:     { bg: "rgba(16,185,129,0.12)", fg: "#047857", label: "Paid" },
    rejected: { bg: "rgba(244,67,54,0.12)",  fg: "#c62828", label: "Rejected" },
  };
  const s = map[status];
  return (
    <span
      className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-1 rounded"
      style={{ background: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="card p-10 text-center">
      <p className="text-sm text-[var(--color-text-muted)]">{text}</p>
    </div>
  );
}
