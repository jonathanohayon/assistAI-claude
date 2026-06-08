"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import type { CostRates } from "./types";

// Fallback local si l'API ne répond pas (mêmes ordres de grandeur que
// DEFAULT_COST_RATES côté serveur).
const FALLBACK_RATES: CostRates = {
  openaiUsdPerMinute: 0.3,
  openaiUsdPerInputToken: 0.00004,
  openaiUsdPerOutputToken: 0.00008,
  openaiUsdPerCachedInputToken: 0.0000004,
  twilioInboundUsdPerMinute: 0.0085,
  twilioOutboundUsdPerMinute: 0.14,
  twilioNumberUsdPerMonth: 1.15,
  whatsappUsdPerMessage: 0.02,
  infraUsdPerMonth: 0,
  eurToUsd: 1.08,
  ilsToUsd: 0.27,
};

type FieldDef = {
  key: keyof CostRates;
  label: string;
  hint?: string;
  step?: number;
};

type Group = { title: string; icon: string; fields: FieldDef[] };

const GROUPS: Group[] = [
  {
    title: "OpenAI Realtime",
    icon: "🤖",
    fields: [
      {
        key: "openaiUsdPerMinute",
        label: "USD / minute (estimation)",
        hint: "Utilisé tant que les tokens réels ne sont pas remontés.",
        step: 0.01,
      },
      {
        key: "openaiUsdPerInputToken",
        label: "USD / token entrée",
        hint: "≈ coût audio in par token.",
        step: 0.000001,
      },
      {
        key: "openaiUsdPerOutputToken",
        label: "USD / token sortie",
        hint: "≈ coût audio out par token.",
        step: 0.000001,
      },
      {
        key: "openaiUsdPerCachedInputToken",
        label: "USD / token entrée caché",
        step: 0.0000001,
      },
    ],
  },
  {
    title: "Twilio voix",
    icon: "📞",
    fields: [
      {
        key: "twilioInboundUsdPerMinute",
        label: "USD / min entrante",
        step: 0.001,
      },
      {
        key: "twilioOutboundUsdPerMinute",
        label: "USD / min sortante",
        step: 0.001,
      },
      {
        key: "twilioNumberUsdPerMonth",
        label: "USD / numéro / mois",
        step: 0.01,
      },
    ],
  },
  {
    title: "WhatsApp",
    icon: "💬",
    fields: [
      { key: "whatsappUsdPerMessage", label: "USD / message", step: 0.001 },
    ],
  },
  {
    title: "Infra",
    icon: "🖥️",
    fields: [
      {
        key: "infraUsdPerMonth",
        label: "USD / mois (global)",
        hint: "LiveKit, hébergement… coût fixe réparti.",
        step: 1,
      },
    ],
  },
  {
    title: "Change (FX)",
    icon: "💱",
    fields: [
      { key: "eurToUsd", label: "EUR → USD", step: 0.01 },
      { key: "ilsToUsd", label: "ILS → USD", step: 0.01 },
    ],
  },
];

type SaveState = "idle" | "saving" | "saved" | "error";

export default function RateCardForm({ onSaved }: { onSaved?: () => void }) {
  const [open, setOpen] = useState(false);
  const [rates, setRates] = useState<CostRates | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch("/api/admin/cost-rates", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { rates?: Partial<CostRates> };
      setRates({ ...FALLBACK_RATES, ...(json.rates ?? {}) });
    } catch {
      setLoadError(true);
      setRates({ ...FALLBACK_RATES });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && rates === null && !loading) {
      // Fetch async au 1er dépliage : setState après l'await (synchro
      // système externe). Règle async non distinguée → désactivée ici.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load();
    }
  }, [open, rates, loading, load]);

  const update = (key: keyof CostRates, raw: string) => {
    setSaveState("idle");
    const n = Number(raw);
    setRates((prev) =>
      prev ? { ...prev, [key]: Number.isFinite(n) && n >= 0 ? n : 0 } : prev,
    );
  };

  const save = async () => {
    if (!rates) return;
    setSaveState("saving");
    setSaveError(null);
    try {
      const res = await fetch("/api/admin/cost-rates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rates }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaveState("saved");
      onSaved?.();
      window.setTimeout(() => setSaveState("idle"), 2500);
    } catch (e) {
      setSaveState("error");
      setSaveError(e instanceof Error ? e.message : "Erreur inconnue");
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="rounded-2xl border border-[var(--color-border)] bg-white shadow-sm"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="rate-card-panel"
        className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left"
      >
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-base">
            🧮
          </span>
          <div>
            <h3 className="font-display text-sm font-semibold text-[var(--color-foreground)]">
              Grille tarifaire (USD)
            </h3>
            <p className="text-[12px] text-[var(--color-muted-foreground)]">
              Taux utilisés pour estimer les coûts. Modifier recalcule tout.
            </p>
          </div>
        </div>
        <span
          aria-hidden
          className={`text-[var(--color-muted-foreground)] transition-transform ${
            open ? "rotate-180" : ""
          }`}
        >
          ▾
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id="rate-card-panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="border-t border-[var(--color-border)] p-4">
              {loading || !rates ? (
                <p className="py-6 text-center text-sm text-[var(--color-muted-foreground)]">
                  Chargement de la grille…
                </p>
              ) : (
                <>
                  {loadError ? (
                    <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                      Impossible de charger la grille enregistrée — valeurs par
                      défaut affichées.
                    </p>
                  ) : null}

                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {GROUPS.map((group) => (
                      <fieldset
                        key={group.title}
                        className="rounded-xl border border-[var(--color-border)] p-3"
                      >
                        <legend className="flex items-center gap-1.5 px-1 text-[12px] font-semibold text-[var(--color-foreground)]">
                          <span aria-hidden>{group.icon}</span>
                          {group.title}
                        </legend>
                        <div className="space-y-3 pt-1">
                          {group.fields.map((f) => (
                            <label key={f.key} className="block">
                              <span className="text-[12px] font-medium text-[var(--color-foreground)]">
                                {f.label}
                              </span>
                              <input
                                type="number"
                                inputMode="decimal"
                                min={0}
                                step={f.step ?? 0.01}
                                value={rates[f.key]}
                                onChange={(e) => update(f.key, e.target.value)}
                                aria-label={f.label}
                                className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-sm tabular-nums text-[var(--color-foreground)] outline-none transition-colors focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20"
                              />
                              {f.hint ? (
                                <span className="mt-0.5 block text-[11px] text-[var(--color-muted-foreground)]">
                                  {f.hint}
                                </span>
                              ) : null}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    ))}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={save}
                      disabled={saveState === "saving"}
                      className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {saveState === "saving"
                        ? "Enregistrement…"
                        : "Enregistrer la grille"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRates({ ...FALLBACK_RATES });
                        setSaveState("idle");
                      }}
                      className="text-[12px] font-medium text-[var(--color-muted-foreground)] underline-offset-2 hover:underline"
                    >
                      Réinitialiser aux défauts
                    </button>
                    <AnimatePresence mode="wait">
                      {saveState === "saved" ? (
                        <motion.span
                          key="saved"
                          initial={{ opacity: 0, x: -6 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0 }}
                          className="text-[12px] font-semibold text-[#059669]"
                        >
                          ✓ Grille enregistrée
                        </motion.span>
                      ) : null}
                      {saveState === "error" ? (
                        <motion.span
                          key="error"
                          initial={{ opacity: 0, x: -6 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0 }}
                          className="text-[12px] font-semibold text-[#dc2626]"
                        >
                          ✕ Échec : {saveError}
                        </motion.span>
                      ) : null}
                    </AnimatePresence>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}
