// The dark "command centre" surface: the OutboundCalling section and the
// /sales hero share it. Light text only on it: white, or the brand tints
// #f472b6 / #22d3ee (AA on every stop of the gradient).

/** Slate-blue gradient, lighter than --color-dark-bg (#1e2937 was judged too dark). */
export const COMMAND_CENTRE_BG = "bg-gradient-to-b from-[#2e3d55] via-[#2a374c] to-[#243043]";

/** The blurred brand glows of the command centre (decorative). */
export function CommandCentreGlows() {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute start-[-12%] top-[10%] h-[28rem] w-[28rem] rounded-full bg-[#db2777]/25 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-[5%] end-[-10%] h-96 w-96 rounded-full bg-[#22d3ee]/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute start-1/3 top-2/3 h-72 w-72 rounded-full bg-[#be185d]/15 blur-3xl"
      />
    </>
  );
}
