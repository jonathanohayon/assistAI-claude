"use client";

/**
 * Tuile "Notifications" : cartes des canaux owner (WhatsApp branché en DB,
 * Email/SMS en state local "coming soon") + toggle du rappel de RDV J-1
 * envoyé automatiquement au client par WhatsApp (cron).
 *
 * Utilisé par : config-form.tsx (workspace de la tuile `notifs`).
 */

import { useState } from "react";

import { NotifChannelCard } from "./notif-channel-card";
import type { FormState, FormUpdater, Translator } from "./types";

export function NotifsPanel({
  form,
  update,
  t,
}: {
  form: FormState;
  update: FormUpdater;
  t: Translator;
}) {
  // Local-only state for SMS/Email (pas encore en DB)
  const [smsOn, setSmsOn] = useState(false);
  const [smsValue, setSmsValue] = useState("");
  const [emailOn, setEmailOn] = useState(false);
  const [emailValue, setEmailValue] = useState("");

  return (
    <div className="flex flex-col gap-3">
      <NotifChannelCard
        label="WhatsApp"
        color="#25D366"
        icon={
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.002-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.83 9.83 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.81 11.81 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.88 11.88 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.82 11.82 0 0 0-3.48-8.413Z" />
          </svg>
        }
        on={Boolean(form.ownerWhatsapp)}
        onToggle={(v) => {
          if (!v) update("ownerWhatsapp", "");
        }}
        value={form.ownerWhatsapp}
        onChangeValue={(v) => update("ownerWhatsapp", v)}
        placeholder="+972..."
        inputType="tel"
        hint={t("ownerWhatsappHint")}
        testEndpoint="/api/dashboard/notifications/whatsapp-test"
      />
      <NotifChannelCard
        label="Email"
        color="#0e7490"
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="m22 6-10 7L2 6" />
          </svg>
        }
        on={emailOn}
        onToggle={setEmailOn}
        value={emailValue}
        onChangeValue={setEmailValue}
        placeholder="contact@..."
        inputType="email"
        testEndpoint="/api/dashboard/notifications/email-test"
      />
      <NotifChannelCard
        label="SMS"
        color="#3B82F6"
        comingSoon
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        }
        on={smsOn}
        onToggle={setSmsOn}
        value={smsValue}
        onChangeValue={setSmsValue}
        placeholder="+972..."
        inputType="tel"
      />
      {/* Rappel de RDV J-1 — WhatsApp au client la veille (cron). Pas de
          champ contact : le numéro vient de l'événement Google Calendar. */}
      <div
        className={`flex flex-col gap-3 rounded-2xl border-2 p-4 transition-all duration-300 ${
          form.reminderEnabled
            ? "border-[#22d3ee]/40 bg-white shadow-[0_4px_20px_-8px_rgba(34,211,238,0.35)]"
            : "border-[#cbd5e1] bg-white hover:border-[#22d3ee]/30"
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all"
              style={{
                backgroundColor: form.reminderEnabled ? "#25D366" : "#f1f5f9",
                color: form.reminderEnabled ? "white" : "#94a3b8",
                boxShadow: form.reminderEnabled
                  ? "0 4px 16px -4px #25D36666"
                  : "none",
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[#18181b]">
                {t("reminderTitle")}
              </p>
              <p className="text-[11px] text-[#475569]">
                {form.reminderEnabled ? (
                  <span className="inline-flex items-center gap-1 font-medium text-[#0e7490]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#22d3ee] motion-safe:animate-pulse" />
                    {t("wowChannelActive")}
                  </span>
                ) : (
                  t("wowChannelInactive")
                )}
              </p>
            </div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={form.reminderEnabled}
            aria-label={t("wowToggleAria", {
              action: form.reminderEnabled
                ? t("wowToggleDisable")
                : t("wowToggleEnable"),
              label: t("reminderTitle"),
            })}
            onClick={() => update("reminderEnabled", !form.reminderEnabled)}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#22d3ee] focus-visible:ring-offset-2 ${
              form.reminderEnabled
                ? "bg-gradient-to-r from-[#22d3ee] to-[#0e7490] shadow-[0_0_16px_-2px_rgba(34,211,238,0.6)]"
                : "bg-[#94a3b8] hover:bg-[#64748b]"
            }`}
          >
            <span
              aria-hidden
              className="block h-6 w-6 rounded-full bg-white shadow-md transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
              style={{
                transform: form.reminderEnabled
                  ? "translateX(20px)"
                  : "translateX(0)",
              }}
            />
          </button>
        </div>
        <p className="text-[11px] leading-relaxed text-[#475569]">
          {t("reminderHint")}
        </p>
      </div>

      <p className="rounded-xl bg-[#ecfeff]/60 px-4 py-3 text-[11px] leading-relaxed text-[#475569]">
        {t("whatsappFooter")}
      </p>
    </div>
  );
}
