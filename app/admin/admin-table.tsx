"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

interface AdminRow {
  id: string;
  email: string;
  displayName: string;
  role: string;
  createdAt: Date | string;
  numbers: Array<{ id: string; phoneNumber: string; label: string }>;
}

export function AdminTable({ rows }: { rows: AdminRow[] }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-[var(--color-border)] bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-[var(--color-muted)]/50 text-left text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
          <tr>
            <th className="px-6 py-3 font-medium">Tenant</th>
            <th className="px-6 py-3 font-medium">Rôle</th>
            <th className="px-6 py-3 font-medium">Numéros assignés</th>
            <th className="px-6 py-3 font-medium">Inscription</th>
            <th className="px-6 py-3 font-medium text-right">Config</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]/60">
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={5}
                className="px-6 py-10 text-center text-sm text-[var(--color-muted-foreground)]"
              >
                Aucun tenant.
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-[var(--color-muted)]/30">
              <td className="px-6 py-4 align-top">
                <Link
                  href={`/admin/users/${r.id}`}
                  className="block hover:underline"
                >
                  <div className="font-medium text-[var(--color-foreground)]">
                    {r.displayName || "(sans nom)"}
                  </div>
                  <div className="text-xs text-[var(--color-muted-foreground)]">
                    {r.email}
                  </div>
                </Link>
              </td>
              <td className="px-6 py-4 align-top">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                    r.role === "admin"
                      ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                      : "bg-[var(--color-muted)] text-[var(--color-foreground)]"
                  }`}
                >
                  {r.role}
                </span>
              </td>
              <td className="px-6 py-4 align-top">
                <NumbersCell userId={r.id} numbers={r.numbers} />
              </td>
              <td className="px-6 py-4 align-top text-xs text-[var(--color-muted-foreground)]">
                {new Date(r.createdAt).toLocaleDateString("fr-FR", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </td>
              <td className="px-6 py-4 align-top text-right">
                <Link
                  href={`/admin/users/${r.id}`}
                  className="inline-flex items-center gap-1 rounded-full bg-[var(--color-foreground)] px-3 py-1 text-xs font-medium text-white hover:bg-[var(--color-primary)]"
                >
                  Éditer →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NumbersCell({
  userId,
  numbers: initial,
}: {
  userId: string;
  numbers: Array<{ id: string; phoneNumber: string; label: string }>;
}) {
  const [numbers, setNumbers] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [phone, setPhone] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const addNumber = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/admin/numbers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, phoneNumber: phone, label }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Erreur");
        return;
      }
      const created = (await res.json()) as {
        id: string;
        phoneNumber: string;
        label: string;
      };
      setNumbers([...numbers, created]);
      setPhone("");
      setLabel("");
      setAdding(false);
    });
  };

  const removeNumber = (id: string) => {
    startTransition(async () => {
      const res = await fetch(`/api/admin/numbers?id=${id}`, {
        method: "DELETE",
      });
      if (res.ok) setNumbers(numbers.filter((n) => n.id !== id));
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {numbers.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {numbers.map((n) => (
            <li
              key={n.id}
              className="inline-flex items-center gap-2 self-start rounded-full bg-[var(--color-muted)] py-1 pl-3 pr-1 text-xs"
            >
              <span className="font-mono text-[var(--color-foreground)]">
                {n.phoneNumber}
              </span>
              {n.label && (
                <span className="text-[var(--color-muted-foreground)]">
                  · {n.label}
                </span>
              )}
              <button
                onClick={() => removeNumber(n.id)}
                aria-label="Retirer ce numéro"
                className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-[var(--color-muted-foreground)] hover:bg-white hover:text-[var(--color-destructive)]"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <form onSubmit={addNumber} className="flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-1.5">
            <input
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+97223764700"
              className="rounded-md border border-[var(--color-border)] bg-white px-2 py-1 font-mono text-xs"
            />
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label (optionnel)"
              className="rounded-md border border-[var(--color-border)] bg-white px-2 py-1 text-xs"
            />
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-[var(--color-foreground)] px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              {isPending ? "…" : "Ajouter"}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setError(null);
              }}
              className="rounded-md px-2 py-1 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            >
              Annuler
            </button>
          </div>
          {error && <p className="text-xs text-[var(--color-destructive)]">{error}</p>}
        </form>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 self-start rounded-full border border-dashed border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-muted-foreground)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
        >
          + Ajouter un numéro
        </button>
      )}
    </div>
  );
}
