/**
 * Aurora mesh background — animé en continu (20s loop), respecte
 * `prefers-reduced-motion`. Composition rose + cyan + magenta + teal qui
 * matérialise la signature marque Tamara (chaleur + voice tech).
 *
 * Positionné en `fixed inset-0 -z-10` : reste visible pendant tout le scroll
 * sans faire partie du flow document. Pour scope local (e.g. derrière une
 * card), passer `position="absolute"`.
 */

type Props = {
  position?: "fixed" | "absolute";
  className?: string;
};

export function AuroraBackground({
  position = "fixed",
  className = "",
}: Props) {
  return (
    <>
      <div
        aria-hidden
        className={`pointer-events-none ${position} inset-0 z-0 motion-safe:animate-[aurora_20s_ease-in-out_infinite] ${className}`}
        style={{
          // Base cream warm (Light Background officiel marque) — le mesh
          // se mélange par dessus. Séparer backgroundColor et backgroundImage
          // évite que le shorthand `background:` override le color base.
          backgroundColor: "#FAF7F2",
          // 5 radials : rose top-left, cyan top-right, magenta center-bottom,
          // cyan bottom-right, teal bottom-left. Aligné sur la preview wow.
          backgroundImage: `
            radial-gradient(at 15% 20%, rgba(236, 72, 153, 0.35) 0px, transparent 50%),
            radial-gradient(at 85% 12%, rgba(34, 211, 238, 0.32) 0px, transparent 55%),
            radial-gradient(at 50% 85%, rgba(190, 24, 93, 0.25) 0px, transparent 60%),
            radial-gradient(at 90% 70%, rgba(34, 211, 238, 0.22) 0px, transparent 50%),
            radial-gradient(at 10% 75%, rgba(14, 116, 144, 0.18) 0px, transparent 55%)
          `,
        }}
      />
      {/* Keyframes globales — déclarées une seule fois via <style>. Si plusieurs
       * AuroraBackground sont montés, c'est sans impact (CSS idempotent). */}
      <style>{`
        @keyframes aurora {
          0%, 100% { transform: scale(1) translate(0, 0); }
          33% { transform: scale(1.05) translate(2%, -1%); }
          66% { transform: scale(0.98) translate(-1%, 2%); }
        }
      `}</style>
    </>
  );
}
