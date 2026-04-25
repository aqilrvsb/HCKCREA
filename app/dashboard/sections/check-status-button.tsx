"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, XCircle, Clock } from "lucide-react";

type Status = "pending" | "paid" | "failed" | "refunded";

const STATUS_DISPLAY: Record<Status, { label: string; cls: string; Icon: any }> = {
  paid: {
    label: "Paid",
    cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
    Icon: CheckCircle2,
  },
  pending: {
    label: "Pending",
    cls: "bg-amber-50 text-amber-700 border-amber-200",
    Icon: Clock,
  },
  failed: {
    label: "Failed",
    cls: "bg-red-50 text-red-700 border-red-200",
    Icon: XCircle,
  },
  refunded: {
    label: "Refunded",
    cls: "bg-gray-50 text-gray-600 border-gray-200",
    Icon: RefreshCw,
  },
};

export default function CheckStatusButton({
  chipPurchaseId,
  initialStatus,
  onUpdate,
}: {
  chipPurchaseId: string;
  initialStatus: Status;
  onUpdate?: (newStatus: Status) => void;
}) {
  const [status, setStatus] = useState<Status>(initialStatus);
  const [loading, setLoading] = useState(false);
  const display = STATUS_DISPLAY[status];
  const Icon = display.Icon;

  async function check() {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/payments/webhook?id=${encodeURIComponent(chipPurchaseId)}`
      );
      const data = await res.json();
      if (data?.status && data.status !== status) {
        setStatus(data.status);
        onUpdate?.(data.status);
      }
    } catch (e) {
      // silent
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-bold ${display.cls}`}
      >
        <Icon className="w-3 h-3" strokeWidth={2.5} />
        {display.label}
      </span>
      {status !== "paid" && status !== "refunded" && (
        <button
          onClick={check}
          disabled={loading}
          title="Check status with Chip"
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white border border-[var(--color-border)] hover:border-violet-300 transition text-xs font-semibold disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
          Check
        </button>
      )}
    </div>
  );
}
