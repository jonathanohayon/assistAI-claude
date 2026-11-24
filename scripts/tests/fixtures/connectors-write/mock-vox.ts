// Test double for @/lib/connectors/tamaravox-numbers: the numbers the test
// put in globalThis.__voxNumbers (mock +1555 only).
const g = globalThis as { __voxNumbers?: string[] };
export async function loadTamaravoxNumbers(): Promise<string[]> {
  return g.__voxNumbers ?? [];
}
