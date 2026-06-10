"use client";

import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

type SetupChecklistProps = {
  hasPhone: boolean;
  googleConnected: boolean;
  businessFilled: boolean;
  whatsappSet: boolean;
};

type SvgProps = { className?: string };

function PhoneIcon({ className }: SvgProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" />
    </svg>
  );
}

function WaveIcon({ className }: SvgProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M2 12h2" />
      <path d="M7 6v12" />
      <path d="M12 3v18" />
      <path d="M17 7v10" />
      <path d="M22 12h-2" />
    </svg>
  );
}

function GlobeIcon({ className }: SvgProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z" />
    </svg>
  );
}

function CalendarIcon({ className }: SvgProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4" />
      <path d="M8 2v4" />
      <path d="M3 10h18" />
    </svg>
  );
}

function ChatIcon({ className }: SvgProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />
    </svg>
  );
}

function CheckIcon({ className }: SvgProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function ArrowIcon({ className }: SvgProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

type ChecklistItem = {
  id: string;
  done: boolean;
  icon: (props: SvgProps) => React.JSX.Element;
  title: string;
  desc: string;
  ctaLabel: string;
  href: string;
};

export function SetupChecklist({
  hasPhone,
  googleConnected,
  businessFilled,
  whatsappSet,
}: SetupChecklistProps) {
  const t = useTranslations("DashboardSetup");

  const items: ChecklistItem[] = [
    {
      id: "number",
      done: hasPhone,
      icon: PhoneIcon,
      title: t("numberTitle"),
      desc: t("numberDesc"),
      ctaLabel: t("numberCta"),
      href: "/onboarding",
    },
    {
      id: "testCall",
      done: hasPhone,
      icon: WaveIcon,
      title: t("testCallTitle"),
      desc: t("testCallDesc"),
      ctaLabel: t("testCallCta"),
      href: "/onboarding",
    },
    {
      id: "scan",
      done: businessFilled,
      icon: GlobeIcon,
      title: t("scanTitle"),
      desc: t("scanDesc"),
      ctaLabel: t("scanCta"),
      href: "/dashboard?tile=business",
    },
    {
      id: "calendar",
      done: googleConnected,
      icon: CalendarIcon,
      title: t("calendarTitle"),
      desc: t("calendarDesc"),
      ctaLabel: t("calendarCta"),
      href: "/dashboard/calendar",
    },
    {
      id: "whatsapp",
      done: whatsappSet,
      icon: ChatIcon,
      title: t("whatsappTitle"),
      desc: t("whatsappDesc"),
      ctaLabel: t("whatsappCta"),
      href: "/dashboard?tile=notifs",
    },
  ];

  const total = items.length;
  const done = items.filter((i) => i.done).length;
  const allDone = done === total;

  // Tout est configuré → état compact, discret.
  if (allDone) {
    return (
      <section
        className="mb-6 flex items-center gap-3 rounded-3xl border border-[var(--color-border)] bg-white/85 px-5 py-4 backdrop-blur-sm"
        aria-label={t("title")}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <CheckIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="font-display text-sm font-semibold text-[var(--color-foreground)]">
            {t("allDoneTitle")}
          </p>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            {t("allDoneSubtitle")}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      className="mb-6 overflow-hidden rounded-3xl border border-[var(--color-border)] bg-white/85 backdrop-blur-sm"
      aria-label={t("title")}
    >
      <header className="flex flex-col gap-3 border-b border-[var(--color-border)] px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold text-[var(--color-foreground)]">
            {t("title")}
          </h2>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            {t("subtitle")}
          </p>
        </div>
        <div className="shrink-0">
          <p className="text-xs font-medium text-[var(--color-muted-foreground)]">
            {t("progress", { done, total })}
          </p>
          <div
            className="mt-1.5 h-1.5 w-40 overflow-hidden rounded-full bg-[var(--color-muted)]"
            role="progressbar"
            aria-valuenow={done}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-label={t("progress", { done, total })}
          >
            <div
              className="h-full rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] transition-[width] duration-500"
              style={{ width: `${(done / total) * 100}%` }}
            />
          </div>
        </div>
      </header>

      <ul className="divide-y divide-[var(--color-border)]">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <li
              key={item.id}
              className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-4 sm:px-6"
            >
              <span
                className={
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl " +
                  (item.done
                    ? "bg-emerald-100 text-emerald-600"
                    : "bg-[var(--color-muted)] text-[var(--color-primary)]")
                }
              >
                <Icon className="h-5 w-5" />
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[var(--color-foreground)]">
                  {item.title}
                </p>
                <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
                  {item.desc}
                </p>
              </div>

              <div className="shrink-0">
                {item.done ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                    <CheckIcon className="h-3.5 w-3.5" />
                    {t("done")}
                  </span>
                ) : (
                  <Link
                    href={item.href}
                    className="group inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
                  >
                    {item.ctaLabel}
                    <ArrowIcon className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default SetupChecklist;
