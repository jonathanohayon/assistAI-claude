// Connector write bodies (B4). Pure, zero I/O. The routes answer
// 400 { error, fields } on a refusal; the URL's SAFETY (DNS) and the voice's
// rules (lib/voice/store.ts planVoiceWrite) are checked by the write path.
//
// POST   { name, url, mode, phoneNumberId, voiceConfig?, enabled?, acknowledgeLegacyConversion? }
// PATCH  { name?, url?, mode?, voiceConfig?, enabled?, rotateSecret?, acknowledgeLegacyConversion? }
//   omitted = the stored value is kept. The number can't be changed in B4
//   (phoneNumberId in a PATCH → 400 number_not_editable). A secret is never
//   accepted from the client: it is generated server-side (an unknown key).

import type { ConnectorMode } from "./types";

export const CONNECTOR_NAME_MAX = 80;
const MODES: readonly string[] = ["lead", "voice"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isConnectorUuid = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);

export type ConnectorCreate = {
  name: string;
  url: string;
  mode: ConnectorMode;
  phoneNumberId: string;
  /** Absent = null (the account voice); an object = a voice patch onto the default voice. */
  voiceConfig?: Record<string, unknown> | null;
  enabled: boolean;
  acknowledgeLegacyConversion: boolean;
};

export type ConnectorPatch = {
  name?: string;
  url?: string;
  mode?: ConnectorMode;
  voiceConfig?: Record<string, unknown> | null;
  enabled?: boolean;
  rotateSecret: boolean;
  acknowledgeLegacyConversion: boolean;
};

export type BodyRefusal = { ok: false; error: "invalid_body" | "number_not_editable"; fields: string[] };

const isPlainObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

const CREATE_KEYS = ["name", "url", "mode", "phoneNumberId", "voiceConfig", "enabled", "acknowledgeLegacyConversion"];
const PATCH_KEYS = ["name", "url", "mode", "voiceConfig", "enabled", "rotateSecret", "acknowledgeLegacyConversion"];

function nameOk(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.trim().length <= CONNECTOR_NAME_MAX;
}
const urlOk = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const modeOk = (v: unknown): v is ConnectorMode => typeof v === "string" && MODES.includes(v);
const voiceOk = (v: unknown) => v === null || isPlainObject(v);

/** Every common field check; `bad` collects the offending field names. */
function common(b: Record<string, unknown>, bad: string[]) {
  if ("voiceConfig" in b && !voiceOk(b.voiceConfig)) bad.push("voiceConfig");
  if ("enabled" in b && typeof b.enabled !== "boolean") bad.push("enabled");
  if ("acknowledgeLegacyConversion" in b && typeof b.acknowledgeLegacyConversion !== "boolean") bad.push("acknowledgeLegacyConversion");
}

export function parseConnectorCreate(body: unknown): { ok: true; value: ConnectorCreate } | BodyRefusal {
  if (!isPlainObject(body)) return { ok: false, error: "invalid_body", fields: [] };
  const bad = Object.keys(body).filter((k) => !CREATE_KEYS.includes(k));
  if (!nameOk(body.name)) bad.push("name");
  if (!urlOk(body.url)) bad.push("url");
  if (!modeOk(body.mode)) bad.push("mode");
  if (!isConnectorUuid(body.phoneNumberId)) bad.push("phoneNumberId");
  common(body, bad);
  if (bad.length) return { ok: false, error: "invalid_body", fields: bad };
  return {
    ok: true,
    value: {
      name: (body.name as string).trim(),
      url: (body.url as string).trim(),
      mode: body.mode as ConnectorMode,
      phoneNumberId: (body.phoneNumberId as string).toLowerCase(),
      ...("voiceConfig" in body ? { voiceConfig: body.voiceConfig as Record<string, unknown> | null } : {}),
      enabled: body.enabled === undefined ? true : (body.enabled as boolean),
      acknowledgeLegacyConversion: body.acknowledgeLegacyConversion === true,
    },
  };
}

export function parseConnectorPatch(body: unknown): { ok: true; value: ConnectorPatch } | BodyRefusal {
  if (!isPlainObject(body)) return { ok: false, error: "invalid_body", fields: [] };
  if ("phoneNumberId" in body) return { ok: false, error: "number_not_editable", fields: ["phoneNumberId"] };
  const bad = Object.keys(body).filter((k) => !PATCH_KEYS.includes(k));
  if ("name" in body && !nameOk(body.name)) bad.push("name");
  if ("url" in body && !urlOk(body.url)) bad.push("url");
  if ("mode" in body && !modeOk(body.mode)) bad.push("mode");
  if ("rotateSecret" in body && typeof body.rotateSecret !== "boolean") bad.push("rotateSecret");
  common(body, bad);
  if (bad.length) return { ok: false, error: "invalid_body", fields: bad };
  const v: ConnectorPatch = {
    rotateSecret: body.rotateSecret === true,
    acknowledgeLegacyConversion: body.acknowledgeLegacyConversion === true,
  };
  if ("name" in body) v.name = (body.name as string).trim();
  if ("url" in body) v.url = (body.url as string).trim();
  if ("mode" in body) v.mode = body.mode as ConnectorMode;
  if ("voiceConfig" in body) v.voiceConfig = body.voiceConfig as Record<string, unknown> | null;
  if ("enabled" in body) v.enabled = body.enabled as boolean;
  return { ok: true, value: v };
}
