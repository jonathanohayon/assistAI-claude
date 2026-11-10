// Regenerates lib/voice/contract.json from lib/voice/contract.ts.
// Run with:  npx tsx scripts/voice-contract-json.ts   (then copy it to the worker's src/voice/contract.json)
import { writeFileSync } from "node:fs";
import { voiceContractRules } from "../lib/voice/contract";
writeFileSync(new URL("../lib/voice/contract.json", import.meta.url), JSON.stringify(voiceContractRules(), null, 2) + "\n");
console.log("lib/voice/contract.json written");
