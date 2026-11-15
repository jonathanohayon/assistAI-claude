import { NextRequest, NextResponse } from "next/server";

// Minimal surface of google-auth-library's OAuth2Client used here.
type CodeExchanger = {
  getToken(code: string): Promise<{ tokens: { refresh_token?: string | null } }>;
};

export type DevOAuthCallbackDeps = {
  /** DEV_OAUTH_HELPER_ENABLED from lib/dev-only.mjs. */
  enabled: boolean;
  /** Only called when enabled, so production never builds a Google client. */
  loadOAuthClient: () => Promise<CodeExchanger>;
};

// Same body as the other disabled routes (e.g. /api/v1/demo-agent): no hint.
export const notFound = () => NextResponse.json({ error: "not_found" }, { status: 404 });

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Local-dev helper: exchanges a Google auth `code` for a refresh_token and
 * shows it so it can be copied into .env.local. In production: 404 before
 * anything else, Google is never contacted.
 */
export async function handleDevOAuthCallback(req: NextRequest, deps: DevOAuthCallbackDeps) {
  if (!deps.enabled) return notFound();

  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return new NextResponse("Code d'autorisation manquant", { status: 400 });
  }

  try {
    const auth = await deps.loadOAuthClient();
    const { tokens } = await auth.getToken(code);

    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <title>Authentification réussie</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 600px; margin: 80px auto; padding: 0 20px; }
    h1 { color: #16a34a; }
    pre { background: #f4f4f4; padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 13px; }
    .label { font-size: 12px; color: #666; margin-bottom: 4px; }
    .token-box { margin-top: 24px; }
  </style>
</head>
<body>
  <h1>✅ Authentification réussie</h1>
  <p>Copie le <strong>refresh_token</strong> ci-dessous dans ton fichier <code>.env.local</code> :</p>
  <div class="token-box">
    <p class="label">GOOGLE_REFRESH_TOKEN=</p>
    <pre>${tokens.refresh_token ? esc(tokens.refresh_token) : "(déjà utilisé — relance le flux OAuth avec prompt=consent)"}</pre>
  </div>
  <p style="margin-top:32px;color:#666;font-size:13px;">Tu peux fermer cette fenêtre.</p>
</body>
</html>`;

    return new NextResponse(html, { headers: { "Content-Type": "text/html" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur inconnue";
    return new NextResponse(`Erreur: ${msg}`, { status: 500 });
  }
}

// Minimal surface of google-auth-library's OAuth2Client used by the login step.
type ConsentUrlBuilder = {
  generateAuthUrl(opts: { access_type: string; prompt: string; scope: string[] }): string;
};

export type DevOAuthLoginDeps = {
  /** DEV_OAUTH_HELPER_ENABLED from lib/dev-only.mjs (same flag as the callback). */
  enabled: boolean;
  /** Only called when enabled, so production never builds a Google client. */
  loadOAuthClient: () => Promise<ConsentUrlBuilder>;
};

export const DEV_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/spreadsheets",
];

/**
 * Local-dev helper, first half of the flow: redirects to Google's consent
 * screen, which then lands on /api/auth/callback. In production: 404 before
 * anything else, no client is built and no redirect is sent.
 */
export async function handleDevOAuthLogin(deps: DevOAuthLoginDeps) {
  if (!deps.enabled) return notFound();

  const auth = await deps.loadOAuthClient();
  const url = auth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: DEV_OAUTH_SCOPES,
  });
  return NextResponse.redirect(url);
}
