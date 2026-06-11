/**
 * Feuille de style inline du formulaire de configuration (/dashboard) :
 * keyframes (wave, fade-up, bounce-in, shimmer…), classes d'animation des
 * icônes de sliders, sliders custom `.fancy-slider`, animations drawer/modal
 * et règles prefers-reduced-motion.
 *
 * Injectée telle quelle via <style>{CONFIG_FORM_CSS}</style> dans
 * config-form.tsx — les classes sont consommées par tous les panels
 * (tuiles, drawers, modals, sliders).
 */

export const CONFIG_FORM_CSS = `
        @keyframes wave {
          0%, 100% { transform: scaleY(1); }
          50% { transform: scaleY(0.3); }
        }
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes bounce-in {
          0% { opacity: 0; transform: scale(0.92); }
          60% { transform: scale(1.02); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .anim-fade-up { animation: fade-up 0.6s ease-out backwards; }
        .anim-bounce-in { animation: bounce-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) backwards; }
        .card-hover {
          transition: transform 350ms cubic-bezier(0.16, 1, 0.3, 1),
                      box-shadow 350ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .card-hover:hover {
          transform: translateY(-4px);
          box-shadow: 0 16px 48px -16px rgba(190, 24, 93, 0.30);
        }
        @keyframes bounce-soft { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
        @keyframes pulse-soft { 0%,100% { transform: scale(1); } 50% { transform: scale(1.15); } }
        @keyframes flash-soft {
          0%,100% { opacity: 1; transform: scale(1); }
          15% { opacity: 0.5; transform: scale(0.92); }
          30% { opacity: 1; transform: scale(1); }
        }
        @keyframes slide-x { 0%,100% { transform: translateX(0); } 50% { transform: translateX(3px); } }
        @keyframes tilt { 0%,100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
        @keyframes sparkle {
          0%,100% { transform: scale(1) rotate(0deg); opacity: 1; }
          50% { transform: scale(1.2) rotate(20deg); opacity: 0.85; }
        }
        @keyframes wiggle { 0%,100% { transform: rotate(0deg); } 25% { transform: rotate(-10deg); } 75% { transform: rotate(10deg); } }
        @keyframes pulse-quick {
          0%,100% { transform: scale(1); }
          25% { transform: scale(1.2); }
          50% { transform: scale(0.95); }
          75% { transform: scale(1.1); }
        }
        @keyframes spin-slow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .anim-bounce-soft { animation: bounce-soft 2.4s ease-in-out infinite; }
        .anim-pulse-soft  { animation: pulse-soft 1.6s ease-in-out infinite; }
        .anim-flash       { animation: flash-soft 3s ease-in-out infinite; }
        .anim-slide-x     { animation: slide-x 1.4s ease-in-out infinite; }
        .anim-tilt        { animation: tilt 4s ease-in-out infinite; }
        .anim-sparkle     { animation: sparkle 2.8s ease-in-out infinite; }
        .anim-wiggle      { animation: wiggle 2s ease-in-out infinite; }
        .anim-pulse-quick { animation: pulse-quick 1.2s ease-in-out infinite; }
        .anim-spin-slow   { animation: spin-slow 8s linear infinite; }
        @keyframes ripple-ring {
          0%   { transform: scale(0.85); opacity: 0.55; }
          70%  { opacity: 0; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        .ripple-ring {
          position: absolute; inset: 0; border-radius: 9999px;
          border: 2px solid #22d3ee; pointer-events: none;
          animation: ripple-ring 2.4s cubic-bezier(0.16, 1, 0.3, 1) infinite;
        }
        .ripple-ring--2 { animation-delay: 0.8s; }
        .ripple-ring--3 { animation-delay: 1.6s; }
        .fancy-slider {
          -webkit-appearance: none; appearance: none;
          height: 8px; width: 100%; border-radius: 9999px;
          outline: none; background: transparent;
        }
        .fancy-slider::-webkit-slider-runnable-track {
          height: 8px; border-radius: 9999px; background: inherit;
        }
        .fancy-slider::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 22px; height: 22px; margin-top: -7px;
          border-radius: 50%;
          background: linear-gradient(135deg, #22d3ee 0%, #0e7490 100%);
          border: 3px solid #ffffff;
          box-shadow: 0 2px 8px -1px rgba(14, 116, 144, 0.45),
                      0 0 0 1px rgba(14, 116, 144, 0.18);
          cursor: grab;
          transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1),
                      box-shadow 220ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .fancy-slider:hover::-webkit-slider-thumb {
          transform: scale(1.15);
          box-shadow: 0 4px 16px -2px rgba(14, 116, 144, 0.5),
                      0 0 0 6px rgba(34, 211, 238, 0.18);
        }
        .fancy-slider:active::-webkit-slider-thumb,
        .fancy-slider:focus::-webkit-slider-thumb {
          cursor: grabbing; transform: scale(1.25);
          box-shadow: 0 4px 20px -2px rgba(14, 116, 144, 0.6),
                      0 0 0 8px rgba(34, 211, 238, 0.22);
        }
        .fancy-slider::-moz-range-track {
          height: 8px; border-radius: 9999px; background: inherit; border: none;
        }
        .fancy-slider::-moz-range-thumb {
          width: 22px; height: 22px; border-radius: 50%;
          background: linear-gradient(135deg, #22d3ee 0%, #0e7490 100%);
          border: 3px solid #ffffff;
          box-shadow: 0 2px 8px -1px rgba(14, 116, 144, 0.45);
          cursor: grab; transition: transform 220ms, box-shadow 220ms;
        }
        .fancy-slider:disabled { opacity: 0.5; cursor: not-allowed; }
        .fancy-slider:disabled::-webkit-slider-thumb { cursor: not-allowed; }
        @keyframes drawer-slide-in {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
        .drawer-anim { animation: drawer-slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
        @keyframes modal-pop {
          from { opacity: 0; transform: scale(0.95); }
          to   { opacity: 1; transform: scale(1); }
        }
        .modal-anim { animation: modal-pop 0.2s ease-out; }
        @keyframes overlay-fade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .overlay-anim { animation: overlay-fade 0.2s ease-out; }
        /* Sautillement du bouton Save quand des changements ne sont pas
           encore enregistrés — attire l'œil sans être agressif. */
        @keyframes save-hop {
          0%, 70%, 100% { transform: translateY(0); }
          80% { transform: translateY(-5px); }
          90% { transform: translateY(-2px); }
        }
        .anim-save-hop { animation: save-hop 1.6s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .anim-fade-up, .anim-bounce-in, .anim-bounce-soft, .anim-pulse-soft,
          .anim-flash, .anim-slide-x, .anim-tilt, .anim-sparkle, .anim-wiggle,
          .anim-pulse-quick, .anim-spin-slow, .ripple-ring, .anim-save-hop,
          .drawer-anim, .modal-anim, .overlay-anim { animation: none; }
          .card-hover { transition: none; }
          .card-hover:hover { transform: none; }
        }
      `;
