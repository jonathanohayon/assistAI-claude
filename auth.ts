import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";

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
  ],
  callbacks: {
    jwt: ({ token, user }) => {
      if (user) token.sub = user.id;
      return token;
    },
    session: ({ session, token }) => {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
