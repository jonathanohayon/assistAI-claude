import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { cookies } from "next/headers";

import { googleSignIn } from "@/lib/auth/google-sign-in";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import { emailFields } from "@/lib/event-pii";

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
  // Calendar/Sheets refresh-token auth (/api/auth/callback: local dev only).
  basePath: "/api/admin/auth",
  // Trust the proxy's host header (Railway). Combined with AUTH_URL
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
            message: "Login refusé — email inconnu",
            level: "warn",
            metadata: emailFields(email),
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
            message: "Login email refusé — compte sans mot de passe (Google)",
            level: "warn",
            userId: user.id,
            metadata: emailFields(email),
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
            metadata: emailFields(email),
          });
          return null;
        }

        await logEvent({
          source: "auth",
          event: "login_success",
          message: "Login réussi",
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
    // Google find-or-create (and the sign-up cookies: plan, locale, door):
    // lib/auth/google-sign-in.ts. Credentials sign-ins pass straight through.
    signIn: async ({ account, profile }) => googleSignIn({ account, profile }, await cookies()),
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
