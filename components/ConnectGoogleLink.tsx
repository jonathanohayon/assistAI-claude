/**
 * Lien "Connecter / Reconnecter Google" → démarre le flow OAuth.
 *
 * Volontairement un <a> natif et PAS un <Link> Next.js : la cible est une
 * route API (/api/onboarding/google/start) qui répond par une redirection
 * 302 vers Google. Il faut donc une navigation navigateur complète — une
 * navigation client (soft nav) ne suivrait pas la redirection OAuth.
 *
 * Utilisé partout où on invite l'utilisateur à (re)connecter son compte
 * Google : dashboard layout (bandeau), page calendrier, page contacts,
 * réglages calendrier, wizard d'onboarding.
 */
export function ConnectGoogleLink({
  className,
  title,
  children,
  returnTo,
}: {
  className?: string;
  title?: string;
  children: React.ReactNode;
  /** Chemin interne où revenir après le callback OAuth (ex: "/dashboard/crm").
   *  Sans ça, on retombe sur /onboarding (comportement historique). */
  returnTo?: string;
}) {
  const href = returnTo
    ? `/api/onboarding/google/start?returnTo=${encodeURIComponent(returnTo)}`
    : "/api/onboarding/google/start";
  return (
    <a href={href} className={className} title={title}>
      {children}
    </a>
  );
}
