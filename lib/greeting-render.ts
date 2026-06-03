// Synthèse offline de l'opener via l'API Realtime OpenAI (GA), avec la MÊME
// voix que le live → match exact (les voix marin/cedar n'existent pas dans le
// TTS standalone). Server-only. Renvoie un PCM16 24kHz mono normalisé.
//
// Protocole GA vérifié empiriquement (2026-06-04) :
//   - wss://api.openai.com/v1/realtime?model=<model>, header Authorization seul
//     (PAS de header OpenAI-Beta — la shape beta est désactivée).
//   - session.update : { session: { type:"realtime", output_modalities:["audio"],
//       audio:{ output:{ voice, format:{ type:"audio/pcm", rate:24000 } } } } }
//   - conversation.item.create (role user, input_text) + response.create.
//   - audio = events `response.output_audio.delta` (delta base64 PCM16) ;
//     fin = `response.done`.

import WebSocket from "ws";

const OPENAI_WS = "wss://api.openai.com/v1/realtime";
const SAMPLE_RATE = 24000;

export async function renderOpenerAudio(opts: {
  text: string;
  voice: string;
  model: string;
}): Promise<{ pcm: Buffer; sampleRate: number }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY manquant");

  const url = `${OPENAI_WS}?model=${encodeURIComponent(opts.model)}`;
  const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${key}` } });
  const chunks: Buffer[] = [];

  return await new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* noop */
      }
      fn();
    };
    const fail = (e: unknown) =>
      done(() => reject(e instanceof Error ? e : new Error(String(e))));
    const timer = setTimeout(() => fail(new Error("render timeout")), 20000);

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "session.update",
          session: {
            type: "realtime",
            output_modalities: ["audio"],
            audio: {
              output: {
                voice: opts.voice,
                format: { type: "audio/pcm", rate: SAMPLE_RATE },
              },
            },
            // Contrainte forte : l'agent ne fait QUE lire le texte fourni.
            instructions:
              "Tu lis À VOIX HAUTE, mot pour mot, exactement le texte que l'utilisateur te donne. N'ajoute rien, ne reformule pas, ne commente pas.",
          },
        }),
      );
      ws.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Lis ceci textuellement :\n"""\n${opts.text}\n"""`,
              },
            ],
          },
        }),
      );
      ws.send(JSON.stringify({ type: "response.create" }));
    });

    ws.on("message", (raw) => {
      let ev: { type?: string; delta?: string };
      try {
        ev = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (ev.type === "response.output_audio.delta" && ev.delta) {
        chunks.push(Buffer.from(ev.delta, "base64"));
      } else if (ev.type === "response.done") {
        if (!chunks.length) return fail(new Error("aucun audio généré"));
        done(() =>
          resolve({
            pcm: normalizeLoudness(Buffer.concat(chunks)),
            sampleRate: SAMPLE_RATE,
          }),
        );
      } else if (ev.type === "error") {
        fail(new Error("realtime error: " + raw.toString().slice(0, 200)));
      }
    });

    ws.on("error", fail);
    ws.on("close", () => fail(new Error("WS fermée avant la fin de l'audio")));
  });
}

/**
 * Normalise le RMS du PCM16 vers une cible (évite un saut de volume entre
 * l'amorce pré-générée et l'audio live du modèle).
 */
function normalizeLoudness(pcm: Buffer, targetRms = 3000): Buffer {
  const n = Math.floor(pcm.length / 2);
  if (n === 0) return pcm;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = pcm.readInt16LE(i * 2);
    sum += s * s;
  }
  const rms = Math.sqrt(sum / n);
  if (rms < 1) return pcm;
  const gain = Math.min(8, targetRms / rms);
  if (Math.abs(gain - 1) < 0.05) return pcm;
  const out = Buffer.alloc(pcm.length);
  for (let i = 0; i < n; i++) {
    const v = Math.max(
      -32768,
      Math.min(32767, Math.round(pcm.readInt16LE(i * 2) * gain)),
    );
    out.writeInt16LE(v, i * 2);
  }
  return out;
}
