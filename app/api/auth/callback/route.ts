import { NextRequest, NextResponse } from "next/server";
import { getOAuthClient } from "@/lib/google";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");

  if (!code) {
    return new NextResponse("Code d'autorisation manquant", { status: 400 });
  }

  try {
    const auth = getOAuthClient();
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
    <pre>${tokens.refresh_token ?? "(déjà utilisé — relance le flux OAuth avec prompt=consent)"}</pre>
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
