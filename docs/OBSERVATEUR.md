# Observateur d’une session feature

Depuis une session, cliquez sur **Analyser cette session**, ou utilisez la commande **Feature Studio : analyser une session** dans la palette de VS Code. Une session archivée reste analysable.

## Préparer puis lancer

Choisissez un modèle réellement proposé par votre compte Copilot, un maximum d’appels et, éventuellement, un budget en crédits. **Préparer l’analyse** construit localement le dossier et indique les phases, le volume de texte, le nombre minimal d’appels et les données manquantes. Cette préparation ne lance aucun modèle.

La session doit être au repos et le pilote en pause. **Lancer l’Observateur** vérifie que la session, le profil et les réglages correspondent toujours à l’aperçu. Il analyse toutes les phases et toutes leurs tentatives sur une copie figée. Les grandes phases sont découpées en parties ; une synthèse rassemble les analyses. Une synthèse volumineuse peut demander des appels supplémentaires au minimum affiché. Le maximum initial est 40 appels, réglable jusqu’à 10 000 pour les très longues archives.

Le bouton **Arrêter l’analyse** conserve les phases déjà examinées et les mesures reçues. Après fermeture ou crash, une revue active devient interrompue. Aucune reprise payante n’est automatique.

Le profil **Observateur de session** est consultable dans le catalogue Agents. Son modèle et ses consignes de rôle peuvent être personnalisés. Le lancement dédié impose toujours le format du rapport et son propre catalogue d’outils sans accès aux fichiers du projet, au shell, aux hooks, aux MCP ou aux questions humaines ; modifier les capacités du profil ne donne pas ces accès à l’Observateur. Il évalue aussi les problèmes possibles du parcours et de Feature Studio.

## Lire le rapport

Le rapport contient un tableau des phases et des cartes de consommation. Chaque phase présente son agent, les modèles effectivement observés, les tentatives, la durée, les points réussis et les améliorations concrètes. Le détail par modèle apparaît lorsque les mesures permettent cette attribution.

Les remarques distinguent **fait observé**, **interprétation** et **amélioration**, avec une priorité et des liens vers les sources figées. Une référence absente du contexte transmis est refusée. Ces liens rendent la revue vérifiable ; ils ne prouvent pas automatiquement que son interprétation est correcte.

Les commentaires globaux identifient les améliorations prioritaires de la session. Le bilan de l’Observateur rappelle le modèle demandé, les modèles réellement communiqués, tous ses appels, ses tokens, ses crédits et sa durée. Le sélecteur conserve les versions précédentes. Si la session change après une revue, le rapport le signale.

**Exporter en HTML** produit un document autonome, mis en forme, navigable et imprimable sans script ni ressource externe. **Markdown** fournit une version textuelle. Les exports rappellent le modèle demandé, tous les modèles mesurés et leur consommation. Les sources détaillées se consultent dans le cockpit ; les exports affichent leurs identifiants.

## Coûts et couverture

Les montants sont calculés par l’hôte à partir des mesures Copilot, une seule fois par appel. Le travail de la feature, cette revue, toutes ses revues et le total actuel de la session apparaissent séparément. Les échecs et annulations restent inclus lorsqu’ils ont consommé des crédits. Un modèle demandé n’est jamais présenté comme une preuve du modèle utilisé.

Une valeur absente reste inconnue, une mesure partielle est signalée, et un zéro réellement reçu reste zéro. Les unités autres que `nano-AIU` ne sont pas converties. Ces crédits ne constituent pas une facture en euros. Le budget est vérifié entre les appels : il ne garantit pas une coupure stricte pendant un appel déjà engagé. Sous budget de crédits, une consommation manquante empêche l’appel suivant.

Les anciennes sessions conservent leurs journaux disponibles, mais leurs contextes ou sorties d’outils déjà perdus ne sont pas reconstitués. Le rapport indique ces limites. Il analyse les données observables enregistrées, sans prétendre accéder au raisonnement interne des modèles. Une interruption, un budget atteint ou un résultat invalide laisse un rapport explicitement incomplet.

## Archives et espace utilisé

Le stockage utilise le schéma **5** : un index léger et des états propres à chaque session, publiés atomiquement et contrôlés par empreinte. Les versions 0 à 4 migrent en conservant leurs données connues. Un ancien binaire refuse le nouveau schéma.

Le journal principal conserve les contextes effectivement envoyés, profils et instructions, événements SDK, résultats des outils hôtes, activité et intentions humaines. Les données sensibles reconnues sont masquées avant archivage. Les événements des agents sont attribués lorsque le SDK fournit leur identité ; aucune délégation supplémentaire n’est activée par cette fonctionnalité.

Les traces ne sont plus limitées à 3 000 événements. Les messages longs sont découpés sans suppression de contenu. **Réglages → Archives de session** définit leur limite : **256 Mio** initialement, réglable de **1 à 4 096 Mio**. Le cockpit affiche l’espace propre, les objets associés ou partagés, le nombre d’événements et un avertissement à 80 % de la limite. Les dossiers figés des revues, leurs entrées/sorties, pièces jointes et checkpoints occupent de l’espace supplémentaire, inclus dans les catégories affichées.

L’activité montre les 500 événements récents et un aperçu borné de leurs messages. **Consulter le journal complet** parcourt l’archive par pages de 100 événements ou 100 000 caractères, une fois la tentative terminée. Les limites d’archive ou d’écriture provoquent un arrêt visible, sans effacer le début de la session. Si un crash coupe la dernière ligne du journal, les événements intacts restent analysables. La reprise conserve le fragment incomplet dans le stockage privé avant de reprendre l’écriture ; le journal, le stockage et le rapport gardent un avertissement de couverture partielle, même après redémarrage. Une ligne terminée mais corrompue reste refusée.

## Supprimer définitivement

Le bouton de suppression se trouve dans l’en-tête de la session et dans l’Observateur. La confirmation native de VS Code décrit les données concernées et leur volume. Exportez les rapports souhaités avant de confirmer.

La suppression retire la session des statistiques locales et efface ses journaux, contextes, états, dossiers et rapports de revue, sauvegardes de modifications existantes, notes mémoire issues de la session, liens locaux DevOps et données locales Copilot identifiées. Les manifests de checkpoints sont retirés ; les objets et pièces jointes partagés restent tant qu’une autre session les utilise. Les fichiers du projet, branches, worktrees et exports sauvegardés ailleurs restent conservés. La consommation déjà enregistrée par le fournisseur reste facturée.

Une suppression en cours est inscrite durablement avant nettoyage. Après crash ou échec, elle reprend au prochain démarrage. Le cockpit signale un nettoyage incomplet au lieu de déclarer une réussite. Un journal illisible reste supprimable. **Archiver** conserve les données et ne libère pas leur espace.
