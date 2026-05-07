import VoiceAgent from "@/components/VoiceAgent";

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-zinc-50 to-zinc-100 flex flex-col items-center justify-center px-4 py-16 relative">
      <a
        href="/dashboard"
        className="absolute top-4 right-4 text-xs text-zinc-500 hover:text-zinc-900 underline"
      >
        Dashboard
      </a>
      <div className="w-full max-w-lg flex flex-col items-center gap-8">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-3xl font-bold text-zinc-900 tracking-tight">
            AssistAI
          </h1>
          <p className="mt-2 text-zinc-500 text-sm">
            Agent vocal — Prise de rendez-vous en hébreu ou en français
          </p>
        </div>

        {/* Voice agent */}
        <VoiceAgent />

        {/* Info cards */}
        <div className="w-full grid grid-cols-3 gap-3 mt-4">
          {[
            { icon: "📅", label: "Calendrier Google", desc: "Vérification et réservation de créneaux" },
            { icon: "👤", label: "CRM intégré",       desc: "Enregistrement des contacts (Sheets)" },
            { icon: "🌐", label: "Bilingue",          desc: "Hébreu & Français automatique" },
          ].map((card) => (
            <div key={card.label} className="bg-white rounded-2xl border border-zinc-200 p-4 text-center shadow-sm">
              <div className="text-2xl mb-2">{card.icon}</div>
              <p className="text-xs font-semibold text-zinc-700">{card.label}</p>
              <p className="text-xs text-zinc-400 mt-1">{card.desc}</p>
            </div>
          ))}
        </div>

        {/* Setup link */}
        <p className="text-xs text-zinc-400">
          Premier lancement ?{" "}
          <a href="/api/auth/login" className="text-blue-500 underline">
            Connecter Google →
          </a>
        </p>
      </div>
    </main>
  );
}
