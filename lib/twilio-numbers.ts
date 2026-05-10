// Twilio phone-number provisioning helpers. Used during onboarding to give
// each new tenant their own dedicated phone line, attached to the shared
// SIP trunk that forwards to LiveKit.

const TWILIO_API = "https://api.twilio.com/2010-04-01";

interface TwilioCreds {
  accountSid: string;
  authToken: string;
}

const requireCreds = (): TwilioCreds => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new Error(
      "Twilio non configuré (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN manquant)",
    );
  }
  return { accountSid, authToken };
};

const authHeader = (creds: TwilioCreds): string =>
  `Basic ${Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64")}`;

export interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string;
  locality: string;
  region: string;
  capabilities: { voice?: boolean; sms?: boolean; mms?: boolean };
}

/**
 * Search for an available local phone number to purchase.
 * countryCode is ISO 3166-1 alpha-2 (e.g. "US", "IL", "FR").
 */
export async function searchAvailableNumbers(opts: {
  countryCode: string;
  areaCode?: string;
  limit?: number;
  voiceEnabled?: boolean;
}): Promise<AvailableNumber[]> {
  const creds = requireCreds();
  const params = new URLSearchParams({
    PageSize: String(opts.limit ?? 5),
  });
  if (opts.areaCode) params.set("AreaCode", opts.areaCode);
  if (opts.voiceEnabled !== false) params.set("VoiceEnabled", "true");

  const url = `${TWILIO_API}/Accounts/${creds.accountSid}/AvailablePhoneNumbers/${opts.countryCode}/Local.json?${params}`;
  const res = await fetch(url, { headers: { Authorization: authHeader(creds) } });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Twilio search ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    available_phone_numbers?: Array<{
      phone_number: string;
      friendly_name: string;
      locality: string;
      region: string;
      capabilities?: Record<string, boolean>;
    }>;
  };
  return (data.available_phone_numbers ?? []).map((n) => ({
    phoneNumber: n.phone_number,
    friendlyName: n.friendly_name,
    locality: n.locality ?? "",
    region: n.region ?? "",
    capabilities: n.capabilities ?? {},
  }));
}

export interface PurchasedNumber {
  sid: string;
  phoneNumber: string;
  friendlyName: string;
}

/**
 * Buy a Twilio number and attach it to our shared SIP trunk so all calls
 * forward to LiveKit. The trunk's Origination URI handles SIP routing.
 */
export async function purchaseNumber(opts: {
  phoneNumber: string;
  trunkSid?: string;
  friendlyName?: string;
}): Promise<PurchasedNumber> {
  const creds = requireCreds();
  const trunkSid = opts.trunkSid ?? process.env.TWILIO_TRUNK_SID;
  if (!trunkSid) {
    throw new Error("TWILIO_TRUNK_SID manquant — impossible d'attacher au trunk");
  }

  const body = new URLSearchParams({
    PhoneNumber: opts.phoneNumber,
    TrunkSid: trunkSid,
    VoiceMethod: "POST",
  });
  if (opts.friendlyName) body.set("FriendlyName", opts.friendlyName);

  const url = `${TWILIO_API}/Accounts/${creds.accountSid}/IncomingPhoneNumbers.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader(creds),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Twilio purchase ${res.status}: ${err.slice(0, 400)}`);
  }
  const data = (await res.json()) as {
    sid: string;
    phone_number: string;
    friendly_name: string;
  };
  return {
    sid: data.sid,
    phoneNumber: data.phone_number,
    friendlyName: data.friendly_name,
  };
}

/**
 * Release a number back to Twilio (stops billing). Idempotent — silently
 * succeeds if the number is already gone.
 */
export async function releaseNumber(sid: string): Promise<void> {
  if (!sid) return;
  const creds = requireCreds();
  const url = `${TWILIO_API}/Accounts/${creds.accountSid}/IncomingPhoneNumbers/${sid}.json`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: authHeader(creds) },
  });
  if (!res.ok && res.status !== 404) {
    const err = await res.text();
    throw new Error(`Twilio release ${res.status}: ${err.slice(0, 300)}`);
  }
}
