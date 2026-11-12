// Content object of the unlisted /sales landing page (L3): outbound calls
// for sales teams, rendered by the home's skeleton (HomePage).
//
// Truth rule: only what the product does today. Facts behind the lines:
//   - "up to 20 calls at once": MAX_CONCURRENCY (lib/campaigns/constants.ts),
//     a per-campaign setting;
//   - "by file or copy-paste": the import step's paste / file / sheets tabs
//     (app/[locale]/dashboard/campaigns/contacts-import-step.tsx);
//   - call days and hours: the campaign's call window (DEFAULT_CALL_WINDOW);
//   - no audio recording; each call's transcript + summary are in the
//     campaign results (lib/campaigns/results-call-view.ts);
//   - AI disclosure on outbound: exists, OFF by default, admin-only switch
//     (lib/persona/outbound-disclosure.ts, OUTBOUND_DISCLOSURE_TENANT_EDITABLE).
// Booking and transfer lines sit behind LANDING_SWITCHES (./switches.ts).

import type { HomeContent } from "@/lib/marketing/home-content";

import { sixModules } from "./modules";
import { LANDING_SWITCHES, type LandingLocale, type LandingMeta, type LandingSwitches, type Localized } from "./switches";

/** Every CTA of this page opens sign-up through the "sales" door. */
export const SALES_SIGNUP_HREF = "/signup?door=sales";

const pick = (l: LandingLocale) => (s: Localized) => s[l];

export function salesMeta(l: LandingLocale): LandingMeta {
  const t = pick(l);
  return {
    title: t({
      fr: "Tamara — Appels sortants pour vos leads",
      en: "Tamara — Outbound calls for your leads",
      he: "תמרה — שיחות יוצאות ללידים שלכם",
    }),
    description: t({
      fr: "Tamara appelle vos leads, les qualifie et vous dit qui est prêt.",
      en: "Tamara calls your leads, qualifies them and tells you who is ready.",
      he: "תמרה מתקשרת ללידים שלכם, מסננת אותם ואומרת לכם מי מוכן.",
    }),
  };
}

export function buildSalesContent(l: LandingLocale, sw: LandingSwitches = LANDING_SWITCHES): HomeContent {
  const t = pick(l);
  const talkLabel = t({ fr: "Parler à l'équipe", en: "Talk to us", he: "לדבר עם הצוות" });
  const trialLabel = t({ fr: "Lancer une campagne d'essai", en: "Start a trial campaign", he: "להפעיל קמפיין ניסיון" });

  return {
    nav: {
      links: [
        { href: "#how", label: t({ fr: "Comment ça marche", en: "How it works", he: "איך זה עובד" }) },
        { href: "#modules", label: t({ fr: "Modules", en: "Modules", he: "מודולים" }) },
        { href: "#use-cases", label: t({ fr: "Exemples", en: "Examples", he: "דוגמאות" }) },
        { href: "#faq", label: t({ fr: "FAQ", en: "FAQ", he: "שאלות" }) },
      ],
      signupHref: SALES_SIGNUP_HREF,
    },
    hero: {
      stats: [],
      copy: {
        badge: t({ fr: "Appels sortants", en: "Outbound calls", he: "שיחות יוצאות" }),
        title: t({ fr: "Aucun lead ne reste {emphasis}.", en: "No lead goes {emphasis}.", he: "אף ליד לא נשאר {emphasis}." }),
        emphasis: t({ fr: "sans appel", en: "uncalled", he: "בלי שיחה" }),
        subtitle: sw.outboundBookingEffective
          ? t({
              fr: "Tamara appelle vos leads, les qualifie et réserve le rendez-vous dans l'agenda de vos vendeurs. Vos équipes ne parlent qu'aux prospects prêts.",
              en: "Tamara calls your leads, qualifies them and books the meeting in your sales team's calendar. Your people only talk to prospects who are ready.",
              he: "תמרה מתקשרת ללידים שלכם, מסננת אותם וקובעת את הפגישה ביומן של אנשי המכירות. הצוות שלכם מדבר רק עם לקוחות שמוכנים.",
            })
          : t({
              fr: "Tamara appelle vos leads, les qualifie et vous dit qui est prêt. Vos vendeurs ne parlent qu'aux bons prospects.",
              en: "Tamara calls your leads, qualifies them and tells you who is ready. Your sales team only talks to the right prospects.",
              he: "תמרה מתקשרת ללידים שלכם, מסננת אותם ואומרת לכם מי מוכן. אנשי המכירות שלכם מדברים רק עם הלקוחות הנכונים.",
            }),
        primary: { label: trialLabel, href: SALES_SIGNUP_HREF },
        secondary: { label: talkLabel, href: "#talk" },
      },
    },
    proofStrip: {
      label: t({ fr: "En bref", en: "At a glance", he: "בקצרה" }),
      facts: [
        t({ fr: "Jusqu'à 20 appels à la fois", en: "Up to 20 calls at once", he: "עד 20 שיחות במקביל" }),
        t({ fr: "Vos leads par fichier ou copier-coller", en: "Your leads by file or copy-paste", he: "הלידים שלכם מקובץ או בהעתק-הדבק" }),
        t({ fr: "Français, anglais, hébreu", en: "French, English, Hebrew", he: "צרפתית, אנגלית, עברית" }),
      ],
    },
    showcase: {
      baked: "OutboundCalling",
      copy: {
        kicker: t({ fr: "Vos campagnes", en: "Your campaigns", he: "הקמפיינים שלכם" }),
        title: t({ fr: "Tamara compose, vous suivez.", en: "Tamara dials, you follow along.", he: "תמרה מחייגת, אתם עוקבים." }),
        subtitle: t({
          fr: "Chaque appel passe de la file d'attente à son résultat, sous vos yeux.",
          en: "Every call moves from the queue to its result, in front of you.",
          he: "כל שיחה עוברת מהתור לתוצאה שלה, מול העיניים שלכם.",
        }),
      },
    },
    how: {
      kicker: t({ fr: "Comment ça marche", en: "How it works", he: "איך זה עובד" }),
      title: t({ fr: "Trois étapes, une campagne.", en: "Three steps, one campaign.", he: "שלושה שלבים, קמפיין אחד." }),
      steps: [
        {
          title: t({ fr: "Importez vos leads", en: "Import your leads", he: "ייבאו את הלידים" }),
          body: t({ fr: "Par fichier ou copier-coller.", en: "By file or copy-paste.", he: "מקובץ או בהעתק-הדבק." }),
        },
        {
          title: t({ fr: "Choisissez la mission", en: "Choose the mission", he: "בחרו את המשימה" }),
          body: sw.outboundBookingEffective
            ? t({
                fr: "Qualifier un prospect, annoncer une offre ou réserver un rendez-vous.",
                en: "Qualify a prospect, announce an offer or book a meeting.",
                he: "לסנן ליד, להכריז על הצעה או לקבוע פגישה.",
              })
            : t({
                fr: "Qualifier un prospect ou annoncer une offre.",
                en: "Qualify a prospect or announce an offer.",
                he: "לסנן ליד או להכריז על הצעה.",
              }),
        },
        {
          title: t({ fr: "Recevez les résultats", en: "Get the results", he: "קבלו את התוצאות" }),
          body: sw.outboundBookingEffective
            ? t({
                fr: "Qui est intéressé, qui rappeler, et les rendez-vous pris.",
                en: "Who is interested, who to call back, and the meetings booked.",
                he: "מי מעוניין, למי לחזור, ואילו פגישות נקבעו.",
              })
            : t({
                fr: "Qui est intéressé, qui rappeler.",
                en: "Who is interested, who to call back.",
                he: "מי מעוניין, למי לחזור.",
              }),
        },
      ],
    },
    modules: sixModules(l),
    useCases: {
      kicker: t({ fr: "Exemples", en: "Examples", he: "דוגמאות" }),
      title: t({ fr: "Pour qui ?", en: "Who it's for", he: "למי זה מתאים?" }),
      subtitle: t({ fr: "Trois exemples d'usage.", en: "Three ways to use it.", he: "שלוש דוגמאות לשימוש." }),
      items: [
        {
          title: t({ fr: "Énergie", en: "Energy", he: "אנרגיה" }),
          body: t({ fr: "Qualifier les demandes de devis.", en: "Qualify quote requests.", he: "לסנן בקשות להצעת מחיר." }),
        },
        {
          title: t({ fr: "Immobilier", en: "Real estate", he: "נדל״ן" }),
          body: t({
            fr: "Rappeler chaque demande de visite.",
            en: "Call back every viewing request.",
            he: "לחזור לכל בקשה לראות נכס.",
          }),
        },
        {
          title: t({ fr: "Formation", en: "Training", he: "הכשרות" }),
          body: t({
            fr: "Relancer les inscrits qui n'ont pas finalisé.",
            en: "Follow up with sign-ups who didn't finish.",
            he: "לחזור לנרשמים שלא השלימו את ההרשמה.",
          }),
        },
      ],
    },
    talk: {
      kicker: t({ fr: "Parlons-en", en: "Let's talk", he: "בואו נדבר" }),
      title: t({ fr: "Un projet de campagne ?", en: "Planning a campaign?", he: "מתכננים קמפיין?" }),
      subtitle: t({
        fr: "Dites-nous qui vous voulez appeler et ce que l'appel doit obtenir. On vous répond sur WhatsApp.",
        en: "Tell us who you want to call and what the call must achieve. We answer on WhatsApp.",
        he: "ספרו לנו למי תרצו להתקשר ומה השיחה צריכה להשיג. נענה לכם ב-WhatsApp.",
      }),
      button: talkLabel,
    },
    faq: {
      kicker: t({ fr: "Questions fréquentes", en: "Frequently asked", he: "שאלות נפוצות" }),
      title: t({ fr: "Avant de lancer une campagne.", en: "Before you launch a campaign.", he: "לפני שמפעילים קמפיין." }),
      subtitle: t({
        fr: "Des réponses courtes, sur ce que Tamara fait aujourd'hui.",
        en: "Short answers about what Tamara does today.",
        he: "תשובות קצרות על מה שתמרה עושה היום.",
      }),
      items: [
        {
          id: "who",
          question: t({ fr: "Qui appelle-t-on ?", en: "Who gets called?", he: "למי מתקשרים?" }),
          answer: t({
            fr: "Uniquement les leads que vous importez, les jours et aux heures que vous fixez pour la campagne.",
            en: "Only the leads you import, on the days and at the hours you set for the campaign.",
            he: "רק ללידים שאתם מייבאים, בימים ובשעות שאתם מגדירים לקמפיין.",
          }),
        },
        {
          id: "listen",
          question: t({ fr: "Peut-on écouter les appels ?", en: "Can we listen to the calls?", he: "אפשר להאזין לשיחות?" }),
          answer: t({
            fr: "Il n'y a pas d'enregistrement audio aujourd'hui. Pour chaque appel, les résultats de la campagne montrent la transcription écrite et un résumé.",
            en: "There is no audio recording today. For every call, the campaign results show the written transcript and a summary.",
            he: "כרגע אין הקלטת שמע. לכל שיחה, תוצאות הקמפיין מציגות תמלול כתוב וסיכום.",
          }),
        },
        {
          id: "ai",
          question: t({ fr: "L'agent dit-il qu'il est une IA ?", en: "Does the agent say it's an AI?", he: "הסוכן אומר שהוא בינה מלאכותית?" }),
          answer: t({
            fr: "Il peut l'annoncer dès sa première phrase. Sur les appels sortants, cette annonce est désactivée par défaut : notre équipe l'active pour votre compte, sur simple demande.",
            en: "It can say so in its very first sentence. On outbound calls this is off by default: our team turns it on for your account on request.",
            he: "הוא יכול לומר זאת כבר במשפט הראשון. בשיחות יוצאות ההודעה כבויה כברירת מחדל, והצוות שלנו מפעיל אותה בחשבון שלכם לפי בקשה.",
          }),
        },
        {
          id: "human",
          question: t({
            fr: "Et si la personne veut un humain ?",
            en: "What if the person wants a human?",
            he: "ומה אם האדם מבקש לדבר עם נציג?",
          }),
          answer:
            t({
              fr: "Tamara note sa demande et vous la retrouvez dans les résultats de la campagne.",
              en: "Tamara notes the request and you find it in the campaign results.",
              he: "תמרה רושמת את הבקשה, ואתם מוצאים אותה בתוצאות הקמפיין.",
            }) +
            (sw.outboundTransferEffective
              ? t({
                  fr: " Elle peut aussi transférer l'appel à votre équipe.",
                  en: " She can also transfer the call to your team.",
                  he: " היא יכולה גם להעביר את השיחה לצוות שלכם.",
                })
              : ""),
        },
        {
          id: "languages",
          question: t({ fr: "Quelles langues ?", en: "Which languages?", he: "באילו שפות?" }),
          answer: t({
            fr: "Français, anglais et hébreu. Vous choisissez la langue de chaque campagne.",
            en: "French, English and Hebrew. You choose the language of each campaign.",
            he: "צרפתית, אנגלית ועברית. אתם בוחרים את השפה של כל קמפיין.",
          }),
        },
      ],
    },
    cta: {
      copy: {
        kicker: t({ fr: "Prêt à essayer ?", en: "Ready to try?", he: "מוכנים לנסות?" }),
        title: t({ fr: "Lancez votre première campagne.", en: "Launch your first campaign.", he: "הפעילו את הקמפיין הראשון שלכם." }),
        subtitle: t({
          fr: "Créez votre compte, importez quelques leads et suivez les appels en direct.",
          en: "Create your account, import a few leads and follow the calls live.",
          he: "פתחו חשבון, ייבאו כמה לידים ועקבו אחרי השיחות בזמן אמת.",
        }),
        primary: { label: trialLabel, href: SALES_SIGNUP_HREF },
        secondary: { label: talkLabel, href: "#talk" },
      },
    },
  };
}
