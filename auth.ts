import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { cookies } from "next/headers";

import { provisionTenant } from "@/lib/auth/provision-tenant";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import { DEFAULT_PLAN_KEY, isValidPlanKey } from "@/lib/plans";

const SUPPORTED_LOCALES = ["fr", "he", "en"];

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Mounted under /api/admin/auth/* to avoid colliding with the existing
  // /api/auth/login + /api/auth/callback Google OAuth flow used by
  // Calendar/Sheets refresh-token auth.
  basePath: "/api/admin/auth",
  // Trust the proxy's host header (Railway, Vercel). Combined with AUTH_URL
  // env var (canonical public origin), Auth.js generates correct redirects.
  trustHost: true,
  // Idle timeout : 1h sans activité = logout. updateAge plus court (5min)
  // → la session se renouvelle à chaque request si le user est actif, sans
  // burn de DB writes. Couvre les sessions inactives côté serveur. Le
  // composant IdleWatcher complète avec un timer côté client (pour les
  // onglets ouverts sans interaction).
  session: { strategy: "jwt", maxAge: 60 * 60, updateAge: 60 * 5 },
  pages: { signIn: "/login", error: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (creds) => {
        const email = String(creds?.email ?? "").trim().toLowerCase();
        const password = String(creds?.password ?? "");
        if (!email || !password) return null;

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);
        if (!user) {
          await logEvent({
            source: "auth",
            event: "login_failed",
            message: `Login refusé — email inconnu (${email})`,
            level: "warn",
            metadata: { email },
          });
          return null;
        }

        // passwordHash vide = compte Google sans mot de passe défini
        // (sentinelle posée par provisionTenant). On refuse explicitement le
        // login email/mdp. Le code d'erreur dédié laisse la page login
        // afficher « connectez-vous avec Google » plutôt que « identifiants
        // incorrects ». Voir handleLogin (app/[locale]/login/page.tsx).
        if (user.passwordHash === "") {
          await logEvent({
            source: "auth",
            event: "login_no_password",
            message: `Login email refusé — compte sans mot de passe (Google) : ${email}`,
            level: "warn",
            userId: user.id,
            metadata: { email },
          });
          return null;
        }

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) {
          await logEvent({
            source: "auth",
            event: "login_failed",
            message: `Login refusé — mot de passe incorrect`,
            level: "warn",
            userId: user.id,
            metadata: { email },
          });
          return null;
        }

        await logEvent({
          source: "auth",
          event: "login_success",
          message: `Login réussi : ${email}`,
          userId: user.id,
        });
        return { id: user.id, email: user.email };
      },
    }),
    // Sign-in / sign-up via Google. Reutilise le meme OAuth client que le flux
    // Calendar/Sheets (GOOGLE_CLIENT_ID/SECRET) mais sur un redirect URI propre
    // (/api/admin/auth/callback/google) et avec les scopes par defaut
    // (openid email profile) — aucun refresh-token offline demande ici.
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    // Find-or-create du tenant pour Google. Stratégie JWT sans adapter DB →
    // on gère la creation/liaison nous-memes ici. La liaison se fait par email
    // VERIFIE (email_verified de Google), pattern standard et sur.
    signIn: async ({ account, profile }) => {
      if (account?.provider !== "google") return true;

      const email = String(profile?.email ?? "")
        .trim()
        .toLowerCase();
      if (!email) return false;
      // Refuse un email Google non verifie (rare, mais on ne cree pas de
      // compte pre-verifie sur un email douteux).
      if ((profile as { email_verified?: boolean })?.email_verified === false) {
        return false;
      }

      // Cookies poses par le bouton "Continuer avec Google" de la page signup
      // (absents depuis la page login). On les consomme one-shot : leur seule
      // presence signale une INTENTION d'inscription, ce qui permet de
      // distinguer un signup-sur-compte-existant (→ popup) d'un simple login.
      const cookieStore = await cookies();
      const planCookie = cookieStore.get("signup_plan")?.value;
      const localeCookie = cookieStore.get("signup_locale")?.value;
      const isSignupIntent = planCookie !== undefined;
      const locale =
        localeCookie && SUPPORTED_LOCALES.includes(localeCookie)
          ? localeCookie
          : "fr";
      cookieStore.delete("signup_plan");
      cookieStore.delete("signup_locale");

      const [existing] = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (existing) {
        if (isSignupIntent) {
          // L'user a cliqué "S'inscrire avec Google" mais un compte existe
          // déjà → on NE le connecte PAS, on le renvoie vers /login avec un
          // popup "déjà inscrit". Retourner une string = redirect sans créer
          // de session (cf. @auth/core handleAuthorized).
          await logEvent({
            source: "auth",
            event: "signup_google_exists",
            message: `Signup Google refusé — compte déjà existant : ${email}`,
            userId: existing.id,
          });
          return `/${locale}/login?notice=exists`;
        }
        // Intention login → on relie par email vérifié et on connecte.
        if (!existing.emailVerified) {
          await db
            .update(users)
            .set({ emailVerified: true })
            .where(eq(users.id, existing.id));
        }
        await logEvent({
          source: "auth",
          event: "login_success",
          message: `Login Google : ${email}`,
          userId: existing.id,
        });
        return true;
      }

      // Nouveau tenant. Email déjà vérifié → pas de gate /verify-email ; il
      // sera routé vers /onboarding (redirectTo) pour choisir son numéro.
      const plan = isValidPlanKey(planCookie) ? planCookie : DEFAULT_PLAN_KEY;
      const created = await provisionTenant({
        email,
        displayName: String(profile?.name ?? "").trim(),
        plan,
        locale,
        emailVerified: true,
      });
      await logEvent({
        source: "auth",
        event: "signup_google",
        message: `Signup Google : ${email} (plan ${plan})`,
        userId: created.id,
      });
      return true;
    },
    jwt: async ({ token, user, account }) => {
      // Le `user` Google ne porte pas notre id DB → on resout par email pour
      // que token.sub (et donc session.user.id) pointe sur notre tenant.
      if (account?.provider === "google" && token.email) {
        const [dbu] = await db
          .select()
          .from(users)
          .where(eq(users.email, token.email.toLowerCase()))
          .limit(1);
        if (dbu) token.sub = dbu.id;
      } else if (user) {
        token.sub = user.id;
      }
      return token;
    },
    session: ({ session, token }) => {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
