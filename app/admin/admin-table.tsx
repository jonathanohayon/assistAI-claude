"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface AdminRow {
  id: string;
  email: string;
  displayName: string;
  role: string;
  subscriptionPlan: string;
  subscriptionStatus: string;
  createdAt: Date | string;
  numbers: Array<{ id: string; phoneNumber: string; label: string }>;
}

const PLAN_LABEL: Record<string, string> = {
  whatsapp: "Permanence",
  global: "Réceptionniste",
  premium: "Call Center",
};
const PLAN_BADGE: Record<string, string> = {
  whatsapp: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  global: "bg-violet-100 text-violet-800 ring-violet-200",
  premium: "bg-gradient-to-br from-[#d4a574] to-[#b8864e] text-white ring-amber-300",
};
const STATUS_LABEL: Record<string, string> = {
  trialing: "Essai",
  active: "Actif",
  expired: "Expiré",
  cancelled: "Annulé",
};

export function AdminTable({
  rows,
  currentUserId,
}: {
  rows: AdminRow[];
  currentUserId: string;
}) {
  return (
    <div className="overflow-hidden rounded-3xl border border-[var(--color-border)] bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-[var(--color-muted)]/50 text-left text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
          <tr>
            <th className="px-6 py-3 font-medium">Tenant</th>
            <th className="px-6 py-3 font-medium">Rôle</th>
            <th className="px-6 py-3 font-medium">Formule</th>
            <th className="px-6 py-3 font-medium">Numéros assignés</th>
            <th className="px-6 py-3 font-medium">Inscription</th>
            <th className="px-6 py-3 font-medium text-right">Config</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]/60">
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={6}
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
                <div className="flex flex-col items-start gap-1">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
                      PLAN_BADGE[r.subscriptionPlan] ||
                      "bg-zinc-100 text-zinc-800 ring-zinc-200"
                    }`}
                  >
                    {PLAN_LABEL[r.subscriptionPlan] || r.subscriptionPlan}
                  </span>
                  <span className="text-[10px] text-[var(--color-muted-foreground)]">
                    {STATUS_LABEL[r.subscriptionStatus] ||
                      r.subscriptionStatus}
                  </span>
                </div>
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
                <div className="inline-flex items-center gap-2">
                  <Link
                    href={`/admin/users/${r.id}`}
                    className="inline-flex items-center gap-1 rounded-full bg-[var(--color-foreground)] px-3 py-1 text-xs font-medium text-white hover:bg-[var(--color-primary)]"
                  >
                    Éditer →
                  </Link>
                  <DeleteTenantButton
                    userId={r.id}
                    email={r.email}
                    displayName={r.displayName}
                    disabled={r.id === currentUserId}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DeleteTenantButton({
  userId,
  email,
  displayName,
  disabled,
}: {
  userId: string;
  email: string;
  displayName: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    if (disabled) return;
    const label = displayName || email;
    // Two-step confirm: typing the email forces deliberate intent on prod
    // tenants. Cheap insurance against fat-finger deletes that cascade
    // agent_configs / calls / phone_numbers.
    const typed = window.prompt(
      `Supprimer définitivement le tenant "${label}" ?\n\nTape l'email (${email}) pour confirmer.\nCette action supprime aussi sa config, ses appels, ses numéros — irréversible.`,
    );
    if (typed == null) return;
    if (typed.trim().toLowerCase() !== email.toLowerCase()) {
      setError("L'email tapé ne matche pas — annulé.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? `Erreur ${res.status}`);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || isPending}
        title={
          disabled
            ? "Tu ne peux pas te supprimer toi-même"
            : "Supprimer ce tenant"
        }
        className="inline-flex items-center gap-1 rounded-full border border-[var(--color-destructive)]/40 px-3 py-1 text-xs font-medium text-[var(--color-destructive)] transition-colors hover:bg-[var(--color-destructive)] hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--color-destructive)]"
      >
        {isPending ? "…" : "Supprimer"}
      </button>
      {error && (
        <span className="text-[10px] text-[var(--color-destructive)]">
          {error}
        </span>
      )}
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
  const [channel, setChannel] = useState<"pstn" | "whatsapp">("pstn");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const addNumber = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/admin/numbers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, phoneNumber: phone, label, channel }),
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
      setChannel("pstn");
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
              <span dir="ltr" className="font-mono text-[var(--color-foreground)]">
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
            <select
              value={channel}
              onChange={(e) =>
                setChannel(e.target.value === "whatsapp" ? "whatsapp" : "pstn")
              }
              title="Canal du numéro"
              className="rounded-md border border-[var(--color-border)] bg-white px-2 py-1 text-xs"
            >
              <option value="pstn">Téléphone</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
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
