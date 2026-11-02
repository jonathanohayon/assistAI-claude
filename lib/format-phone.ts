// E.164 → the grouping people expect to read for the countries we sell in
// (IL, FR, US/CA). Anything else, or any unexpected length, is returned as
// stored: a raw number is better than a wrongly grouped one.
// CLIENT-SAFE (no I/O).

export function formatPhone(e164: string): string {
  const raw = e164.replace(/[\s-]/g, "");

  if (raw.startsWith("+972")) {
    const n = raw.slice(4);
    // Mobile (05x) and VoIP (07x): 9 digits, two-digit prefix.
    if (/^[57]\d{8}$/.test(n)) {
      return `+972 ${n.slice(0, 2)}-${n.slice(2, 5)}-${n.slice(5)}`;
    }
    // Landline: 8 digits, one-digit area code (2, 3, 4, 8, 9).
    if (/^[23489]\d{7}$/.test(n)) {
      return `+972 ${n[0]}-${n.slice(1, 4)}-${n.slice(4)}`;
    }
    return e164;
  }

  if (raw.startsWith("+33")) {
    const n = raw.slice(3);
    if (/^\d{9}$/.test(n)) {
      return `+33 ${n[0]} ${n.slice(1).match(/\d{2}/g)!.join(" ")}`;
    }
    return e164;
  }

  if (raw.startsWith("+1")) {
    const n = raw.slice(2);
    if (/^\d{10}$/.test(n)) {
      return `+1 ${n.slice(0, 3)}-${n.slice(3, 6)}-${n.slice(6)}`;
    }
    return e164;
  }

  return e164;
}
