// Reconcile the LiveKit inbound SIP trunk with what we actually own.
//
//   npx tsx scripts/livekit-trunk-cleanup.ts                 # dry run (default)
//   npx tsx scripts/livekit-trunk-cleanup.ts --apply         # writes, needs an explicit OK
//
// Env: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, TWILIO_ACCOUNT_SID,
//      TWILIO_AUTH_TOKEN, optional LIVEKIT_INBOUND_TRUNK_SID (else the only
//      inbound trunk).
// Options:
//   --keep=+1…,+1…               extra numbers to keep even if not on Twilio
//   --exclude=+1…                numbers to drop even if on Twilio
//   --allowed-addresses=cidr,…   set the trunk's source-IP allowlist. Take the
//       ranges from Twilio's "IP addresses for SIP signaling" page for the
//       edge in use; they are NOT hardcoded here on purpose (they change and
//       a wrong list rejects every call). Omitted = allowlist left untouched.
//
// Desired numbers = Twilio incoming numbers of this account that are attached
// to an Elastic SIP trunk (trunk_sid set), ± --keep / --exclude.
// Idempotent: a second run on a reconciled trunk prints "nothing to do".

import { ListUpdate } from "@livekit/protocol";
import { SipClient } from "livekit-server-sdk";

import { planTrunk } from "../lib/trunk-reconcile";

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const list = (v: string | undefined) =>
  (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const apply = process.argv.includes("--apply");

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

async function twilioTrunkedNumbers(): Promise<string[]> {
  const sid = need("TWILIO_ACCOUNT_SID");
  const auth = "Basic " + Buffer.from(`${sid}:${need("TWILIO_AUTH_TOKEN")}`).toString("base64");
  const out: string[] = [];
  let url: string | null = `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PageSize=1000`;
  while (url) {
    const res: Response = await fetch(url, { headers: { Authorization: auth } });
    if (!res.ok) throw new Error(`Twilio IncomingPhoneNumbers → ${res.status}`);
    const page = (await res.json()) as {
      incoming_phone_numbers: Array<{ phone_number: string; trunk_sid: string | null }>;
      next_page_uri: string | null;
    };
    for (const n of page.incoming_phone_numbers) if (n.trunk_sid) out.push(n.phone_number);
    url = page.next_page_uri ? `https://api.twilio.com${page.next_page_uri}` : null;
  }
  return out;
}

async function main() {
  const lk = new SipClient(
    need("LIVEKIT_URL").replace(/^wss:/, "https:"),
    need("LIVEKIT_API_KEY"),
    need("LIVEKIT_API_SECRET"),
  );
  const trunks = await lk.listSipInboundTrunk();
  const wanted = process.env.LIVEKIT_INBOUND_TRUNK_SID;
  const trunk = wanted ? trunks.find((t) => t.sipTrunkId === wanted) : trunks.length === 1 ? trunks[0] : undefined;
  if (!trunk) {
    throw new Error(
      `Inbound trunk not found (${trunks.length} trunks; set LIVEKIT_INBOUND_TRUNK_SID).`,
    );
  }

  const exclude = new Set(list(arg("exclude")));
  const desired = [...new Set([...(await twilioTrunkedNumbers()), ...list(arg("keep"))])].filter(
    (n) => !exclude.has(n),
  );
  const allowedArg = arg("allowed-addresses");
  const plan = planTrunk({
    current: trunk.numbers ?? [],
    desired,
    currentAllowed: trunk.allowedAddresses ?? [],
    desiredAllowed: allowedArg === undefined ? null : list(allowedArg),
  });

  console.log(`Trunk ${trunk.sipTrunkId} (${trunk.name}) — ${apply ? "APPLY" : "dry run"}`);
  console.log(`  numbers now:      ${(trunk.numbers ?? []).length}`);
  console.log(`  remove (${plan.remove.length}): ${plan.remove.join(" ") || "—"}`);
  console.log(`  add (${plan.add.length}):    ${plan.add.join(" ") || "—"}`);
  console.log(
    `  allowed_addresses: ${
      plan.setAllowedAddresses
        ? `${(trunk.allowedAddresses ?? []).length} → ${plan.setAllowedAddresses.join(" ")}`
        : `unchanged (${(trunk.allowedAddresses ?? []).length})`
    }`,
  );
  if (desired.length === 0) {
    throw new Error("Refusing: the desired number list is empty (would reject every call).");
  }
  if (plan.noop) return console.log("Nothing to do.");
  if (!apply) return console.log("\nDry run: nothing written. Re-run with --apply after approval.");

  await lk.updateSipInboundTrunkFields(trunk.sipTrunkId, {
    ...(plan.remove.length || plan.add.length
      ? { numbers: new ListUpdate({ remove: plan.remove, add: plan.add }) }
      : {}),
    ...(plan.setAllowedAddresses
      ? { allowedAddresses: new ListUpdate({ set: plan.setAllowedAddresses }) }
      : {}),
  });
  console.log("Applied. Re-run without --apply: it should print \"Nothing to do.\"");
}

main().catch((e) => {
  console.error(`ERROR: ${(e as Error).message}`);
  process.exit(1);
});
