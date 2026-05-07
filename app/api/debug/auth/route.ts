import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

// Temporary diagnostic endpoint. Gated behind AUTH_SECRET so it can ship to
// prod without leaking. Remove once deployment is verified.
//
// GET /api/debug/auth?token=<AUTH_SECRET>           → env + user state
// GET /api/debug/auth?token=...&password=Choisis... → also bcrypt-tests
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const expected = process.env.AUTH_SECRET;
  if (!expected || token !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const env = {
    AUTH_URL: process.env.AUTH_URL ?? null,
    AUTH_TRUST_HOST: process.env.AUTH_TRUST_HOST ?? null,
    AUTH_SECRET: process.env.AUTH_SECRET ? "<set>" : null,
    DATABASE_URL: process.env.DATABASE_URL
      ? `<set, host=${new URL(process.env.DATABASE_URL).hostname}>`
      : null,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL ?? null,
    ADMIN_PASSWORD_SET: Boolean(process.env.ADMIN_PASSWORD),
    APP_URL: process.env.APP_URL ?? null,
    nodeEnv: process.env.NODE_ENV ?? null,
  };

  const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const [user] = adminEmail
    ? await db.select().from(users).where(eq(users.email, adminEmail)).limit(1)
    : [];

  let bcryptMatch: boolean | null = null;
  const probePassword = url.searchParams.get("password");
  if (user && probePassword) {
    bcryptMatch = await bcrypt.compare(probePassword, user.passwordHash);
  }

  // Also test the env-bound password to detect a mismatch between what migrate
  // hashed and what's actually in DB.
  let bcryptMatchEnvPassword: boolean | null = null;
  if (user && process.env.ADMIN_PASSWORD) {
    bcryptMatchEnvPassword = await bcrypt.compare(
      process.env.ADMIN_PASSWORD,
      user.passwordHash,
    );
  }

  return NextResponse.json({
    env,
    user: user
      ? {
          id: user.id,
          email: user.email,
          createdAt: user.createdAt,
          passwordHashPrefix: user.passwordHash.slice(0, 7),
        }
      : null,
    bcryptMatch,
    bcryptMatchEnvPassword,
    headers: {
      host: req.headers.get("host"),
      xForwardedHost: req.headers.get("x-forwarded-host"),
      xForwardedProto: req.headers.get("x-forwarded-proto"),
    },
  });
}
