"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";

interface VerifyFormProps {
  email: string;
}

export function VerifyForm({ email }: VerifyFormProps) {
  const t = useTranslations("VerifyEmail");
  const [digits, setDigits] = useState<string[]>(["", "", "", ""]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  const code = digits.join("");

  // Auto-focus le 1er input au mount.
  useEffect(() => {
    inputsRef.current[0]?.focus();
  }, []);

  // Décrémente le cooldown resend.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const tick = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(tick);
  }, [resendCooldown]);

  const setDigitAt = (i: number, value: string) => {
    const clean = value.replace(/\D/g, "").slice(0, 1);
    setDigits((prev) => {
      const next = [...prev];
      next[i] = clean;
      return next;
    });
    if (clean && i < 3) {
      inputsRef.current[i + 1]?.focus();
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 4);
    if (!pasted) return;
    const next = pasted.split("").concat(["", "", "", ""]).slice(0, 4);
    setDigits(next);
    inputsRef.current[Math.min(pasted.length, 3)]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, i: number) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      inputsRef.current[i - 1]?.focus();
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 4) {
      setError(t("errBadLength"));
      return;
    }
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        // L'API renvoie un message d'erreur localisé/structuré côté serveur
        // (ex: "Code expiré"). On l'affiche brut s'il est présent ; sinon
        // fallback générique. Pas idéal i18n côté serveur — TODO plus tard.
        setError(data.error ?? t("errFallback"));
        setDigits(["", "", "", ""]);
        inputsRef.current[0]?.focus();
        return;
      }
      setInfo(t("successRedirect"));
      window.location.href = "/onboarding";
    });
  };

  const resend = async () => {
    setError(null);
    setInfo(null);
    const res = await fetch("/api/auth/resend-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      error?: string;
      cooldownSeconds?: number;
    };
    if (!res.ok || !data.ok) {
      if (data.cooldownSeconds) setResendCooldown(data.cooldownSeconds);
      setError(data.error ?? t("errResendFallback"));
      return;
    }
    setInfo(t("resendSuccess"));
    setResendCooldown(60);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {error}
        </p>
      )}
      {info && (
        <p
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"
        >
          {info}
        </p>
      )}

      <div className="flex items-center justify-center gap-2">
        {[0, 1, 2, 3].map((i) => (
          <input
            key={i}
            ref={(el) => {
              inputsRef.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={1}
            value={digits[i] ?? ""}
            onChange={(e) => setDigitAt(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            onPaste={onPaste}
            className="h-14 w-12 rounded-xl border border-[var(--color-border)] bg-white text-center font-display text-2xl tracking-tight shadow-xs transition-colors hover:border-[var(--color-primary)]/40 focus:border-[var(--color-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--color-primary)]/15"
            aria-label={t("digitAriaLabel", { n: i + 1 })}
          />
        ))}
      </div>

      <button
        type="submit"
        disabled={isPending || code.length !== 4}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white shadow-md transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? t("verifying") : t("submitButton")}
      </button>

      <div className="flex items-center justify-center gap-1.5 text-xs text-[var(--color-muted-foreground)]">
        <span>{t("notReceived")}</span>
        <button
          type="button"
          onClick={resend}
          disabled={resendCooldown > 0}
          className="font-medium text-[var(--color-primary)] hover:underline disabled:cursor-not-allowed disabled:text-[var(--color-muted-foreground)] disabled:no-underline"
        >
          {resendCooldown > 0
            ? t("resendIn", { seconds: resendCooldown })
            : t("resendButton")}
        </button>
      </div>
    </form>
  );
}
