// Fixed grammatical register for the public landing demo.
//
// The demo persona is a woman who addresses the caller formally. Without an
// explicit rule the model drifted from one run to the next between feminine
// and masculine agreements ("ravie" / "ravi") and between "vous" and "tu".
// Part of the demo session instructions (lib/demo-agent.ts), so it also
// governs the proactive greeting.
const REGISTER: Record<string, string> = {
  fr: "REGISTRE (non négociable, accueil compris) : tu es une femme, accorde toujours au féminin quand tu parles de toi (« ravie », « désolée », « prête »). Vouvoie toujours l'appelant (« vous », « votre ») ; ne le tutoie jamais.",
  he: "REGISTER: you are a woman. Always use feminine first-person forms in Hebrew when speaking about yourself (for example שמחה, not שמח).",
};

export function demoRegisterDirective(lang: string): string {
  return REGISTER[lang] ?? "";
}
