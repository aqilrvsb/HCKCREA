"use client";

import { useEffect, useState } from "react";
import { Copy, Check } from "lucide-react";

type KeyRow = {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
};

type CreatedKey = {
  id: string;
  name: string;
  prefix: string;
  plaintext: string;
};

function fmtMY(ts: string | null): string {
  if (!ts) return "Never";
  try {
    return new Date(ts).toLocaleString("en-GB", { timeZone: "Asia/Kuala_Lumpur" });
  } catch {
    return ts;
  }
}

export default function McpKeysCard({ email }: { email: string }) {
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreatedKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which value was just copied — drives the ✓ feedback on the copy buttons.
  const [copied, setCopied] = useState<string | null>(null);

  async function copyText(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 1500);
    } catch {
      alert("Copy failed — select and copy manually.");
    }
  }

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/user/mcp-keys", { cache: "no-store" });
      const d = await r.json();
      if (d?.ok) setKeys(d.keys || []);
      else setError(d?.error || "Failed to load keys");
    } catch (e: any) {
      setError(e?.message || "Failed to load keys");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function generate() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/user/mcp-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const d = await r.json();
      if (d?.ok && d?.key) {
        setCreated({
          id: d.id,
          name: d.name,
          prefix: d.prefix,
          plaintext: d.key,
        });
        setNewName("");
        await load();
      } else {
        setError(d?.error || "Generate failed");
      }
    } catch (e: any) {
      setError(e?.message || "Generate failed");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string, name: string) {
    const ok = window.confirm(
      `Revoke key "${name}"? Any project using this key will immediately stop working until you replace it. This cannot be undone.`
    );
    if (!ok) return;
    try {
      const r = await fetch(`/api/user/mcp-keys/${id}`, { method: "DELETE" });
      const d = await r.json();
      if (d?.ok) await load();
      else setError(d?.error || "Revoke failed");
    } catch (e: any) {
      setError(e?.message || "Revoke failed");
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border-2 border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {error}
        </div>
      )}

      {/* Plaintext shown once */}
      {created && (
        <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4">
          <div className="text-xs font-bold text-amber-900 mb-2">
            ⚠ Copy this now — it will not be shown again
          </div>
          <div className="text-xs text-amber-900 mb-2">
            <strong>{created.name}</strong> (prefix <code>{created.prefix}…</code>)
          </div>
          <code className="block break-all text-xs bg-white p-3 rounded border border-amber-200 text-amber-950 font-mono">
            {created.plaintext}
          </code>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => void copyText("created", created.plaintext)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold"
            >
              {copied === "created" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied === "created" ? "Copied!" : "Copy to clipboard"}
            </button>
            <button
              onClick={() => setCreated(null)}
              className="px-3 py-1.5 rounded bg-gray-200 hover:bg-gray-300 text-gray-800 text-xs font-bold"
            >
              I&apos;ve saved it — dismiss
            </button>
          </div>
        </div>
      )}

      {/* Generate new key */}
      <div className="card p-6 border-2 border-cyan-100 bg-cyan-50/40">
        <h2 className="font-display font-bold text-lg mb-3">Generate a new key</h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Key name (e.g. 'My laptop', 'Project X')"
            maxLength={80}
            className="input flex-1"
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === "Enter") void generate();
            }}
          />
          <button
            onClick={() => void generate()}
            disabled={busy}
            className="btn-primary text-sm disabled:opacity-50 whitespace-nowrap"
          >
            {busy ? "Generating…" : "Generate Key"}
          </button>
        </div>
        <p className="text-[11px] text-[var(--color-text-muted)] mt-2">
          Keys are bcrypt-hashed on the server and not recoverable if lost.
          Paste the plaintext into your MCP client&apos;s config (see docs at
          <code className="mx-1">peninglab-mcp</code>).
        </p>
      </div>

      {/* List existing keys */}
      <div>
        <h2 className="font-display font-bold text-lg mb-3">Your keys ({keys.length})</h2>
        {loading ? (
          <div className="text-sm text-[var(--color-text-muted)]">Loading…</div>
        ) : keys.length === 0 ? (
          <div className="text-sm text-[var(--color-text-muted)] italic">
            No keys yet — generate one above to get started.
          </div>
        ) : (
          <div className="space-y-2">
            {keys.map((k) => (
              <div
                key={k.id}
                className="card p-4 flex items-center justify-between gap-4 border border-[var(--color-border)]"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm truncate">{k.name}</div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-xs font-mono text-[var(--color-text-muted)]">
                      {k.prefix}…
                    </span>
                    <button
                      onClick={() => void copyText(k.id, k.prefix)}
                      title="Copy key prefix (the full key is shown only once at creation)"
                      aria-label="Copy key prefix"
                      className="inline-flex items-center justify-center w-6 h-6 rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-muted)] transition-colors"
                    >
                      {copied === k.id ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                  <div className="flex gap-4 text-[11px] text-[var(--color-text-muted)] mt-2">
                    <span>Created: {fmtMY(k.created_at)}</span>
                    <span>Last used: {fmtMY(k.last_used_at)}</span>
                  </div>
                </div>
                <button
                  onClick={() => void revoke(k.id, k.name)}
                  className="px-3 py-1.5 rounded border border-red-300 text-red-700 hover:bg-red-50 text-xs font-bold whitespace-nowrap"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-[11px] text-[var(--color-text-muted)] mt-6">
        Signed in as <strong>{email}</strong>. All MCP calls made with these keys
        deduct from this account&apos;s credit balance.
      </p>
    </div>
  );
}
