// Content object of the unlisted /connect landing page (L4): give an
// existing AI agent a voice and a phone number. Rendered by the home's
// skeleton (HomePage).
//
// PREVIEW: the capability is not live on calls yet. The page says so (badge,
// FAQ) and never claims otherwise.
//
// The contract is the "Tamara leads the conversation" mode, exactly as the
// worker sends it (worker src/client-agent.ts; web lib/tools/client-agent-test.ts):
//   POST JSON { call_id, turn_id, language, question, caller_said, history }
//   history = the last 6 turns ({ role: "user" | "agent", text });
//   reply { "answer": "…" }; budget 2500 ms; past it (or no answer) Tamara
//   says she can't check right now and offers to take a message, never
//   guesses; X-Tamara-Signature = hex HMAC-SHA256 of the raw body, ONLY when
//   a secret is set.
// The "voice only" mode (the agent decides every word) exists too
// (lib/agent-brain.ts) but uses its own request shape and a 2 s budget, so
// the page scopes the contract to the first mode.

import type { HomeContent } from "@/lib/marketing/home-content";

import { sixModules } from "./modules";
import type { LandingLocale, LandingMeta, LandingSwitches, Localized } from "./switches";
import { LANDING_SWITCHES } from "./switches";

/** Every CTA of this page opens sign-up through the "connect" door. */
export const CONNECT_SIGNUP_HREF = "/signup?door=connect";

const pick = (l: LandingLocale) => (s: Localized) => s[l];

export function connectMeta(l: LandingLocale): LandingMeta {
  const t = pick(l);
  return {
    title: t({
      fr: "Tamara — Une voix et un numéro pour votre agent IA",
      en: "Tamara — A voice and a phone number for your AI agent",
      he: "תמרה — קול ומספר טלפון לסוכן ה-AI שלכם",
    }),
    description: t({
      fr: "Vous avez déjà un agent conversationnel. Tamara lui apporte le téléphone.",
      en: "You already have a conversational agent. Tamara brings it the phone.",
      he: "כבר יש לכם סוכן שיחה. תמרה מביאה לו את הטלפון.",
    }),
  };
}

// Mock values only (public repo).
const SAMPLE: Record<LandingLocale, { question: string; said: string; hello: string; listen: string; answer: string }> = {
  fr: {
    question: "Quels sont vos horaires le samedi ?",
    said: "Vous êtes ouverts samedi ?",
    hello: "Bonjour",
    listen: "Bonjour, je vous écoute.",
    answer: "Le samedi, de 9 h à 13 h.",
  },
  en: {
    question: "What are your opening hours on Saturday?",
    said: "Are you open on Saturday?",
    hello: "Hello",
    listen: "Hello, how can I help?",
    answer: "On Saturday, from 9 am to 1 pm.",
  },
  he: {
    question: "מה שעות הפתיחה בשבת?",
    said: "אתם פתוחים בשבת?",
    hello: "שלום",
    listen: "שלום, במה אפשר לעזור?",
    answer: "בשבת אנחנו סגורים.",
  },
};

export function sampleRequest(l: LandingLocale): string {
  const s = SAMPLE[l];
  const q = (v: string | number) => JSON.stringify(v);
  // Pretty-printed by hand: one line per history turn keeps the sample short.
  return [
    "{",
    `  "call_id": ${q("call_mock_0001")},`,
    `  "turn_id": 3,`,
    `  "language": ${q(l)},`,
    `  "question": ${q(s.question)},`,
    `  "caller_said": ${q(s.said)},`,
    `  "history": [`,
    `    { "role": "user", "text": ${q(s.hello)} },`,
    `    { "role": "agent", "text": ${q(s.listen)} }`,
    "  ]",
    "}",
  ].join("\n");
}

export function sampleReply(l: LandingLocale): string {
  return `{ "answer": ${JSON.stringify(SAMPLE[l].answer)} }`;
}

const VERIFY_SNIPPET = `import { createHmac, timingSafeEqual } from "node:crypto";

// rawBody: the request body exactly as received (bytes, not re-serialized).
const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
const received = String(req.headers["x-tamara-signature"] ?? "");
const valid =
  received.length === expected.length &&
  timingSafeEqual(Buffer.from(received), Buffer.from(expected));`;

// The switches are not used by this page today (no booking / transfer line);
// the parameter keeps the same builder signature as the other landings.
export function buildConnectContent(l: LandingLocale, _sw: LandingSwitches = LANDING_SWITCHES): HomeContent {
  void _sw;
  const t = pick(l);
  const talkLabel = t({ fr: "Parler à l'équipe", en: "Talk to us", he: "לדבר עם הצוות" });
  const connectLabel = t({ fr: "Brancher mon agent", en: "Connect my agent", he: "לחבר את הסוכן שלי" });

  return {
    nav: {
      links: [
        { href: "#how", label: t({ fr: "Comment ça marche", en: "How it works", he: "איך זה עובד" }) },
        { href: "#contract", label: t({ fr: "Le contrat", en: "The contract", he: "החוזה" }) },
        { href: "#modules", label: t({ fr: "Modules", en: "Modules", he: "מודולים" }) },
        { href: "#faq", label: t({ fr: "FAQ", en: "FAQ", he: "שאלות" }) },
      ],
      signupHref: CONNECT_SIGNUP_HREF,
    },
    hero: {
      stats: [],
      copy: {
        badge: t({ fr: "Aperçu · Pour les agents IA", en: "Preview · For AI agents", he: "תצוגה מקדימה · לסוכני AI" }),
        title: t({
          fr: "Donnez une voix et un numéro à {emphasis}.",
          en: "Give {emphasis} a voice and a phone number.",
          he: "תנו {emphasis} קול ומספר טלפון.",
        }),
        emphasis: t({ fr: "votre agent IA", en: "your AI agent", he: "לסוכן ה-AI שלכם" }),
        subtitle: t({
          fr: "Vous avez déjà un agent conversationnel. Tamara lui apporte le téléphone : elle mène la conversation avec naturel et interroge votre agent en direct.",
          en: "You already have a conversational agent. Tamara brings it the phone: she leads the conversation naturally and asks your agent live.",
          he: "כבר יש לכם סוכן שיחה. תמרה מביאה לו את הטלפון: היא מנהלת את השיחה בטבעיות ושואלת את הסוכן שלכם תוך כדי השיחה.",
        }),
        primary: { label: connectLabel, href: CONNECT_SIGNUP_HREF },
        secondary: { label: t({ fr: "Lire le contrat", en: "Read the contract", he: "לקרוא את החוזה" }), href: "#contract" },
      },
    },
    proofStrip: {
      label: t({ fr: "En bref", en: "At a glance", he: "בקצרה" }),
      facts: [
        t({ fr: "Une adresse https", en: "One https address", he: "כתובת https אחת" }),
        t({ fr: "Votre agent a 2,5 s pour répondre", en: "Your agent has 2.5 s to answer", he: "לסוכן שלכם יש 2.5 שניות לענות" }),
        t({
          fr: "Chaque requête signée avec votre secret",
          en: "Every request signed with your secret",
          he: "כל בקשה חתומה בסוד שלכם",
        }),
      ],
    },
    showcase: {
      baked: "ConnectDiagram",
      copy: {
        kicker: t({ fr: "Comment ça circule", en: "How it flows", he: "איך זה זורם" }),
        title: t({ fr: "Trois acteurs, une conversation.", en: "Three actors, one conversation.", he: "שלושה משתתפים, שיחה אחת." }),
        subtitle: t({
          fr: "L'appelant parle à Tamara. Quand la réponse doit venir de votre agent, Tamara la lui demande, puis la dit avec sa voix.",
          en: "The caller talks to Tamara. When the answer has to come from your agent, Tamara asks it, then says it in her own voice.",
          he: "המתקשר מדבר עם תמרה. כשהתשובה צריכה להגיע מהסוכן שלכם, תמרה שואלת אותו ואומרת את התשובה בקול שלה.",
        }),
        actors: {
          caller: t({ fr: "L'appelant", en: "The caller", he: "המתקשר" }),
          tamara: t({ fr: "Tamara", en: "Tamara", he: "תמרה" }),
          agent: t({ fr: "Votre agent", en: "Your agent", he: "הסוכן שלכם" }),
        },
        links: {
          voice: t({ fr: "La voix", en: "Voice", he: "קול" }),
          ask: t({ fr: "Question", en: "Question", he: "שאלה" }),
          answer: t({ fr: "Réponse", en: "Answer", he: "תשובה" }),
        },
        requestLabel: t({ fr: "Tamara envoie", en: "Tamara sends", he: "תמרה שולחת" }),
        request: sampleRequest(l),
        replyLabel: t({ fr: "Votre agent répond", en: "Your agent answers", he: "הסוכן שלכם עונה" }),
        reply: sampleReply(l),
      },
    },
    how: {
      kicker: t({ fr: "Comment ça marche", en: "How it works", he: "איך זה עובד" }),
      title: t({ fr: "Trois étapes, un numéro.", en: "Three steps, one number.", he: "שלושה שלבים, מספר אחד." }),
      steps: [
        {
          title: t({ fr: "Collez l'adresse de votre agent", en: "Paste your agent's address", he: "הדביקו את הכתובת של הסוכן" }),
          body: t({
            fr: "Une adresse https qui reçoit nos requêtes.",
            en: "An https address that receives our requests.",
            he: "כתובת https שמקבלת את הבקשות שלנו.",
          }),
        },
        {
          title: t({ fr: "Choisissez le mode", en: "Choose the mode", he: "בחרו מצב" }),
          body: t({
            fr: "Tamara mène la conversation, ou prête seulement sa voix.",
            en: "Tamara leads the conversation, or only lends her voice.",
            he: "תמרה מנהלת את השיחה, או רק משאילה את הקול שלה.",
          }),
        },
        {
          title: t({ fr: "Recevez un numéro", en: "Get a phone number", he: "קבלו מספר טלפון" }),
          body: t({
            fr: "Vos appelants le composent et parlent à Tamara.",
            en: "Your callers dial it and talk to Tamara.",
            he: "המתקשרים שלכם מחייגים אליו ומדברים עם תמרה.",
          }),
        },
      ],
    },
    contract: {
      kicker: t({ fr: "Le contrat", en: "The contract", he: "החוזה" }),
      title: t({ fr: "Une requête, une réponse.", en: "One request, one answer.", he: "בקשה אחת, תשובה אחת." }),
      subtitle: t({
        fr: "Ce que Tamara envoie à votre agent, et ce qu'elle attend en retour.",
        en: "What Tamara sends your agent, and what she expects back.",
        he: "מה תמרה שולחת לסוכן שלכם, ומה היא מצפה לקבל בחזרה.",
      }),
      scope: t({
        fr: "Ce contrat est celui du mode où Tamara mène la conversation. Le mode « voix seule » a sa propre forme de requête : on vous la donne sur demande.",
        en: "This is the contract of the mode where Tamara leads the conversation. The voice-only mode has its own request shape: ask us for it.",
        he: "זה החוזה של המצב שבו תמרה מנהלת את השיחה. למצב \"קול בלבד\" יש מבנה בקשה משלו: בקשו אותו מאיתנו.",
      }),
      request: {
        title: t({ fr: "Ce que Tamara envoie", en: "What Tamara sends", he: "מה תמרה שולחת" }),
        body: t({
          fr: "Un POST JSON à l'adresse de votre agent, chaque fois que Tamara a besoin de lui.",
          en: "A JSON POST to your agent's address, each time Tamara needs it.",
          he: "בקשת POST עם JSON לכתובת של הסוכן שלכם, בכל פעם שתמרה צריכה אותו.",
        }),
        code: sampleRequest(l),
        fields: [
          { name: "call_id", body: t({ fr: "l'identifiant de l'appel", en: "the call's id", he: "מזהה השיחה" }) },
          { name: "turn_id", body: t({ fr: "le numéro du tour", en: "the turn number", he: "מספר התור בשיחה" }) },
          { name: "language", body: t({ fr: "la langue de l'appel : fr, en ou he", en: "the call's language: fr, en or he", he: "שפת השיחה: fr, en או he" }) },
          { name: "question", body: t({ fr: "ce que Tamara demande à votre agent", en: "what Tamara asks your agent", he: "מה שתמרה שואלת את הסוכן שלכם" }) },
          { name: "caller_said", body: t({ fr: "les mots de l'appelant", en: "the caller's words", he: "המילים של המתקשר" }) },
          {
            name: "history",
            body: t({
              fr: "les 6 derniers tours, chacun { role: user | agent, text }",
              en: "the last 6 turns, each { role: user | agent, text }",
              he: "6 חילופי הדברים האחרונים בשיחה, כל אחד { role: user | agent, text }",
            }),
          },
        ],
      },
      reply: {
        title: t({ fr: "Ce que votre agent répond", en: "What your agent answers", he: "מה הסוכן שלכם עונה" }),
        body: t({
          fr: "Un JSON avec un seul champ, answer : une réponse courte, en texte. Tamara la dit dans la langue de l'appelant, sans changer les prix, dates, heures, nombres ni noms.",
          en: "JSON with one field, answer: a short answer, in text. Tamara says it in the caller's language, without changing prices, dates, times, numbers or names.",
          he: "JSON עם שדה אחד, answer: תשובה קצרה בטקסט. תמרה אומרת אותה בשפה של המתקשר, בלי לשנות מחירים, תאריכים, שעות, מספרים או שמות.",
        }),
        code: sampleReply(l),
      },
      budget: {
        title: t({ fr: "2 500 ms pour répondre", en: "2,500 ms to answer", he: "2,500 מילישניות לענות" }),
        body: t({
          fr: "Passé ce délai, ou sans réponse valide, Tamara dit à l'appelant qu'elle ne peut pas vérifier pour l'instant et propose de prendre un message. Elle n'invente jamais la réponse.",
          en: "Past that, or without a valid answer, Tamara tells the caller she can't check right now and offers to take a message. She never makes the answer up.",
          he: "אחרי הזמן הזה, או בלי תשובה תקינה, תמרה אומרת למתקשר שהיא לא יכולה לבדוק כרגע ומציעה להשאיר הודעה. היא אף פעם לא ממציאה תשובה.",
        }),
      },
      signature: {
        title: t({ fr: "La signature", en: "The signature", he: "החתימה" }),
        body: t({
          fr: "Si vous définissez un secret, chaque requête porte l'en-tête X-Tamara-Signature : le HMAC-SHA256, en hexadécimal, du corps brut calculé avec votre secret. Sans secret, la requête part sans signature et votre agent ne peut pas vérifier qu'elle vient de Tamara. Définissez-en un.",
          en: "If you set a secret, every request carries the X-Tamara-Signature header: the hex HMAC-SHA256 of the raw body, computed with your secret. Without a secret, the request is sent unsigned and your agent can't check that it comes from Tamara. Set one.",
          he: "אם הגדרתם סוד, כל בקשה נושאת את הכותרת X-Tamara-Signature: חתימת HMAC-SHA256 בהקסדצימלי של גוף הבקשה הגולמי, מחושבת עם הסוד שלכם. בלי סוד, הבקשה נשלחת בלי חתימה והסוכן שלכם לא יכול לוודא שהיא הגיעה מתמרה. מומלץ להגדיר סוד.",
        }),
        code: VERIFY_SNIPPET,
      },
    },
    modules: sixModules(l),
    useCases: {
      kicker: t({ fr: "Exemples", en: "Examples", he: "דוגמאות" }),
      title: t({ fr: "Pour qui ?", en: "Who it's for", he: "למי זה מתאים?" }),
      subtitle: t({ fr: "Trois exemples d'usage.", en: "Three ways to use it.", he: "שלוש דוגמאות לשימוש." }),
      items: [
        {
          title: t({
            fr: "Un assistant qui répond déjà par écrit",
            en: "An assistant that already answers in writing",
            he: "עוזר שכבר עונה בכתב",
          }),
          body: t({ fr: "Les mêmes réponses, au téléphone.", en: "The same answers, on the phone.", he: "אותן תשובות, בטלפון." }),
        },
        {
          title: t({ fr: "Un agent métier interne", en: "An internal business agent", he: "סוכן עסקי פנימי" }),
          body: t({
            fr: "Vos équipes l'appellent au lieu d'ouvrir un outil.",
            en: "Your teams call it instead of opening a tool.",
            he: "הצוותים שלכם מתקשרים אליו במקום לפתוח כלי.",
          }),
        },
        {
          title: t({
            fr: "Un produit IA qui veut une ligne",
            en: "An AI product that wants a phone line",
            he: "מוצר AI שרוצה קו טלפון",
          }),
          body: t({
            fr: "Votre produit gagne un numéro, sans infrastructure vocale à construire.",
            en: "Your product gets a phone number, with no voice stack to build.",
            he: "המוצר שלכם מקבל מספר טלפון, בלי לבנות תשתית קולית.",
          }),
        },
      ],
    },
    talk: {
      kicker: t({ fr: "Parlons-en", en: "Let's talk", he: "בואו נדבר" }),
      title: t({ fr: "Un agent à brancher ?", en: "Have an agent to connect?", he: "יש לכם סוכן לחבר?" }),
      subtitle: t({
        fr: "Dites-nous ce que fait votre agent et comment il répond aujourd'hui. On vous répond sur WhatsApp.",
        en: "Tell us what your agent does and how it answers today. We answer on WhatsApp.",
        he: "ספרו לנו מה הסוכן שלכם עושה ואיך הוא עונה היום. נענה לכם ב-WhatsApp.",
      }),
      button: talkLabel,
    },
    faq: {
      kicker: t({ fr: "Questions fréquentes", en: "Frequently asked", he: "שאלות נפוצות" }),
      title: t({ fr: "Avant de brancher votre agent.", en: "Before you connect your agent.", he: "לפני שמחברים את הסוכן." }),
      subtitle: t({
        fr: "Des réponses courtes, sur ce qui existe aujourd'hui.",
        en: "Short answers about what exists today.",
        he: "תשובות קצרות על מה שקיים היום.",
      }),
      items: [
        {
          id: "change",
          question: t({ fr: "Faut-il changer mon agent ?", en: "Do I need to change my agent?", he: "צריך לשנות את הסוכן שלי?" }),
          answer: t({
            fr: "Non. Il lui faut seulement une adresse https qui reçoit la requête ci-dessus et renvoie { \"answer\": \"…\" }.",
            en: "No. It only needs an https address that takes the request above and returns { \"answer\": \"…\" }.",
            he: "לא. הוא צריך רק כתובת https שמקבלת את הבקשה שלמעלה ומחזירה { \"answer\": \"…\" }.",
          }),
        },
        {
          id: "slow",
          question: t({ fr: "Et s'il est lent ?", en: "What if it's slow?", he: "ומה אם הוא איטי?" }),
          answer: t({
            fr: "Votre agent a 2,5 secondes. Au-delà, Tamara dit à l'appelant qu'elle ne peut pas vérifier pour l'instant et propose de prendre un message. Elle n'invente pas la réponse.",
            en: "Your agent has 2.5 seconds. Past that, Tamara tells the caller she can't check right now and offers to take a message. She does not make the answer up.",
            he: "לסוכן שלכם יש 2.5 שניות. אחרי זה תמרה אומרת למתקשר שהיא לא יכולה לבדוק כרגע ומציעה להשאיר הודעה. היא לא ממציאה תשובה.",
          }),
        },
        {
          id: "data",
          question: t({ fr: "Mes données ?", en: "What about my data?", he: "ומה עם הנתונים שלי?" }),
          answer: t({
            fr: "Tamara envoie à votre agent seulement les champs du contrat : identifiants de l'appel et du tour, langue, question, mots de l'appelant et les 6 derniers tours.",
            en: "Tamara sends your agent only the contract's fields: call and turn ids, language, question, the caller's words and the last 6 turns.",
            he: "תמרה שולחת לסוכן שלכם רק את השדות שבחוזה: מזהי השיחה והתור, שפה, שאלה, המילים של המתקשר ו-6 חילופי הדברים האחרונים.",
          }),
        },
        {
          id: "voice",
          question: t({ fr: "Puis-je garder ma voix ?", en: "Can I keep my own voice?", he: "אפשר לשמור על הקול שלי?" }),
          answer: t({
            fr: "Vous choisissez parmi les voix de Tamara.",
            en: "You pick one of Tamara's voices.",
            he: "אתם בוחרים מבין הקולות של תמרה.",
          }),
        },
        {
          id: "available",
          question: t({ fr: "C'est disponible aujourd'hui ?", en: "Is it available today?", he: "זה זמין היום?" }),
          answer: t({
            fr: "Pas encore sur les appels : cette page en est l'aperçu. Parlez-nous de votre agent, on vous prévient dès que c'est ouvert.",
            en: "Not on calls yet: this page is a preview. Tell us about your agent and we'll let you know as soon as it opens.",
            he: "עדיין לא בשיחות: הדף הזה הוא תצוגה מקדימה. ספרו לנו על הסוכן שלכם ונעדכן אתכם ברגע שזה ייפתח.",
          }),
        },
      ],
    },
    cta: {
      copy: {
        kicker: t({ fr: "Prêt à brancher ?", en: "Ready to connect?", he: "מוכנים לחבר?" }),
        title: t({ fr: "Donnez-lui le téléphone.", en: "Give it the phone.", he: "תנו לו את הטלפון." }),
        subtitle: t({
          fr: "Créez votre compte : on vous prévient dès que votre agent peut prendre ses premiers appels.",
          en: "Create your account: we'll tell you as soon as your agent can take its first calls.",
          he: "פתחו חשבון, ונעדכן אתכם ברגע שהסוכן שלכם יוכל לקבל את השיחות הראשונות.",
        }),
        primary: { label: connectLabel, href: CONNECT_SIGNUP_HREF },
        secondary: { label: talkLabel, href: "#talk" },
      },
    },
  };
}
