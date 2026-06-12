"use client";

import { useState } from "react";

type Row = { id: string; email: string; displayName: string };

type Item = {
  id: string;
  direction: "inbound" | "outbound";
  subject: string;
  name: string | null;
  phone: string;
  language: string;
  durationSeconds: number;
  date: string;
  summary: string;
  transcript: Array<{ role: "user" | "assistant"; text: string }>;
};

const SUBJECTS = [
  "",
  "appointment",
  "cancellation",
  "reschedule",
  "message",
  "info",
  "other",
];

export function ApiTranscriptsExplorer({ rows }: { rows: Row[] }) {
  const [userId, setUserId] = useState(rows[0]?.id ?? "");
  const [phone, setPhone] = useState("");
  const [direction, setDirection] = useState("all");
  const [subject, setSubject] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [order, setOrder] = useState("desc");
  const [limit, setLimit] = useState("50");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ count: number; items: Item[] } | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const run = async () => {
    setError(null);
    setLoading(true);
    setResult(null);
    try {
      const params = new URLSearchParams({ userId, phone, direction, order, limit });
      if (subject) params.set("subject", subject);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(`/api/admin/transcripts-preview?${params}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? `HTTP ${res.status}`);
        return;
      }
      setResult({ count: data.count, items: data.items });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const inputCls =
    "rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-sm text-[#18181b] focus:border-[#0e7490] focus:outline-none";

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#475569]">
        Prévisualise la sortie de l’API publique{" "}
        <code className="rounded bg-[#f1f5f9] px-1 py-0.5 font-mono text-xs">
          GET /api/v1/transcripts
        </code>{" "}
        pour un tenant donné (sans clé API). Le numéro est obligatoire.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-[#475569]">
          Tenant
          <select value={userId} onChange={(e) => setUserId(e.target.value)} className={inputCls}>
            {rows.map((r) => (
              <option key={r.id} value={r.id}>
                {r.displayName || r.email}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-[#475569]">
          Numéro (phone) *
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+972585001007"
            dir="ltr"
            className={`${inputCls} font-mono`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-[#475569]">
          Direction
          <select value={direction} onChange={(e) => setDirection(e.target.value)} className={inputCls}>
            <option value="all">all</option>
            <option value="inbound">inbound</option>
            <option value="outbound">outbound</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-[#475569]">
          Sujet
          <select value={subject} onChange={(e) => setSubject(e.target.value)} className={inputCls}>
            {SUBJECTS.map((s) => (
              <option key={s} value={s}>
                {s || "(tous)"}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-[#475569]">
          Du
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-[#475569]">
          Au
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-[#475569]">
          Ordre
          <select value={order} onChange={(e) => setOrder(e.target.value)} className={inputCls}>
            <option value="desc">desc</option>
            <option value="asc">asc</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-[#475569]">
          Limit
          <input type="number" value={limit} onChange={(e) => setLimit(e.target.value)} className={inputCls} />
        </label>
      </div>

      <button
        type="button"
        onClick={run}
        disabled={loading || !userId || !phone}
        className="rounded-full bg-gradient-to-br from-[#be185d] to-[#ec4899] px-5 py-2 text-sm font-semibold text-white shadow-md disabled:opacity-50"
      >
        {loading ? "Chargement…" : "Lancer la requête"}
      </button>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {result && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-[#18181b]">
              {result.count} résultat(s) · {result.items.length} affiché(s)
            </p>
            <button
              type="button"
              onClick={() => setShowRaw((v) => !v)}
              className="rounded-full border border-[#e2e8f0] bg-white px-3 py-1.5 text-xs font-medium hover:bg-[#f8fafc]"
            >
              {showRaw ? "Vue lisible" : "JSON brut"}
            </button>
          </div>

          {showRaw ? (
            <pre dir="ltr" className="max-h-[480px] overflow-auto rounded-xl bg-[#0f172a] p-4 font-mono text-[11px] leading-relaxed text-[#e2e8f0]">
{JSON.stringify(result, null, 2)}
            </pre>
          ) : result.items.length === 0 ? (
            <p className="rounded-lg bg-[#f1f5f9] px-3 py-2 text-sm text-[#64748b]">
              Aucune conversation pour ce numéro/période.
            </p>
          ) : (
            <ul className="space-y-3">
              {result.items.map((it) => (
                <li key={it.id} className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={`rounded-full px-2 py-0.5 font-semibold ${
                        it.direction === "inbound"
                          ? "bg-[#ecfeff] text-[#0e7490]"
                          : "bg-[#fdf2f8] text-[#be185d]"
                      }`}
                    >
                      {it.direction}
                    </span>
                    <span className="rounded-full bg-[#f1f5f9] px-2 py-0.5 font-medium text-[#475569]">
                      {it.subject}
                    </span>
                    <span dir="ltr" className="font-mono text-[#64748b]">{it.phone}</span>
                    {it.name && <span className="text-[#64748b]">· {it.name}</span>}
                    <span className="text-[#94a3b8]">· {it.language}</span>
                    <span className="ml-auto text-[#94a3b8]">
                      {new Date(it.date).toLocaleString()} · {it.durationSeconds}s
                    </span>
                  </div>
                  {it.summary && (
                    <p className="mb-2 text-sm text-[#18181b]">{it.summary}</p>
                  )}
                  <div className="space-y-1 rounded-lg bg-[#f8fafc] p-2.5">
                    {it.transcript.map((t, i) => (
                      <p key={i} className="text-xs text-[#334155]">
                        <span className="font-semibold text-[#94a3b8]">
                          {t.role === "user" ? "Client" : "Agent"} ·{" "}
                        </span>
                        {t.text}
                      </p>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
