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
}: {
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    // eslint-disable-next-line @next/next/no-html-link-for-pages -- route API OAuth : navigation complète requise (cf. doc ci-dessus)
    <a href="/api/onboarding/google/start" className={className} title={title}>
      {children}
    </a>
  );
}
