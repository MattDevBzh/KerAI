export type BrowserPhase = 'prepare' | 'launch' | 'setup' | 'navigate' | 'operation';

/** Playwright errors contain URLs, local paths, selectors and fill arguments.
 * Classify them in the worker; only curated messages may cross IPC. */
export function browserErrorMessage(error: unknown, phase: BrowserPhase = 'operation'): string {
  const message = error instanceof Error ? error.message : '';
  if (message.startsWith('NAV:')) return message.slice(4, 800);
  const timeout = /timeout|timed out/i.test(message);
  if (phase === 'prepare')
    return 'Impossible de vérifier le navigateur installé. Vérifiez son chemin dans « Modifier le profil ».';
  if (phase === 'launch') {
    if (
      /ProcessSingleton|Opening in existing browser session|profile is already in use/i.test(
        message,
      )
    )
      return 'Le profil de navigateur réservé à KerAI est déjà utilisé. Fermez la fenêtre KerAI correspondante, puis réessayez.';
    if (/\bEACCES\b|\bEPERM\b|Access is denied|Permission denied/i.test(message))
      return 'Le système refuse le démarrage du navigateur ou l’accès à son profil KerAI. Vérifiez les droits et les restrictions de ce poste.';
    if (/\bENOENT\b|executable doesn.t exist|executablePath.*does not exist/i.test(message))
      return 'L’exécutable du navigateur n’est plus accessible. Vérifiez son chemin dans « Modifier le profil ».';
    if (timeout)
      return 'Le navigateur n’a pas terminé son démarrage dans le délai prévu. Vérifiez le navigateur sélectionné et les restrictions de ce poste.';
    if (/browser has been closed|browser closed|process did exit/i.test(message))
      return 'Le navigateur s’est fermé pendant son démarrage. Vérifiez le navigateur sélectionné et les restrictions de ce poste.';
    return 'Impossible de démarrer le navigateur. Vérifiez l’exécutable dans « Modifier le profil » et les restrictions de ce poste.';
  }
  if (phase === 'setup')
    return 'Le navigateur a démarré, mais KerAI n’a pas pu préparer la session. Fermez sa fenêtre puis réessayez.';
  if (phase === 'navigate') {
    if (/net::ERR_CERT_|net::ERR_SSL_/i.test(message))
      return 'Le navigateur a démarré, mais la connexion HTTPS de l’application est refusée. Vérifiez son certificat et sa configuration HTTPS sur ce poste.';
    if (/net::ERR_CONNECTION_REFUSED\b/i.test(message))
      return 'Le navigateur a démarré, mais l’application refuse la connexion. Vérifiez que son serveur est démarré et que son adresse est correcte.';
    if (/net::ERR_NAME_NOT_RESOLVED\b/i.test(message))
      return 'Le navigateur a démarré, mais l’adresse de l’application est introuvable. Vérifiez son nom et sa résolution réseau sur ce poste.';
    if (
      /net::ERR_(PROXY_CONNECTION_FAILED|TUNNEL_CONNECTION_FAILED|NO_SUPPORTED_PROXIES)\b/i.test(
        message,
      )
    )
      return 'Le navigateur a démarré, mais le proxy empêche l’accès à l’application. Vérifiez la configuration réseau de ce poste.';
    if (timeout)
      return 'Le navigateur a démarré, mais le chargement de l’application a dépassé le délai prévu. Vérifiez que le site est accessible depuis ce navigateur.';
    return 'Le navigateur a démarré, mais la page de l’application n’a pas pu être chargée. Vérifiez son adresse et son accès depuis ce navigateur.';
  }
  if (timeout) return 'Délai de l’action dépassé ; cible absente, ambiguë ou non interactive.';
  return 'Opération navigateur échouée ; vérifiez la cible et l’état de la page.';
}
