# Plan de réalisation — évolution v0.3

La v0.3 ajoute l’espace Git par feature et les points de restauration à la v0.2 : contexte manuel/MCP, pilote séquentiel, centre de validation, consommation, mémoire locale et édition des parcours. Le moteur garde l'autorité sur les transitions. Les décisions d’orchestration, l’aperçu, la sélection de mémoire et les opérations Git locales ne déclenchent aucun appel IA supplémentaire.

## Ordre produit et contrats livrés

| Priorité | Capacité                    | Contrat implémenté                                                                                                                                                                                                                   |
| -------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1        | MCP et contexte manuel      | Configuration locale et références de secrets, découverte du catalogue, choix exact des outils/serveurs par lancement, permissions humaines, aperçu du prompt et fingerprint anti-obsolescence                                       |
| 2        | Espaces Git et restauration | Worktree frère basé sur HEAD commité à la création, dossier courant conservé pour relecture/legacy, checkpoints avant/après, points manuels, comparaisons, sélection explicite, fingerprint et récupération persistée avant écriture |
| 3        | Pilote automatique          | Configuration et démarrage explicites, exécution séquentielle, checkpoints prioritaires, arrêts avant exécution, corrections déclarées et bornées, pause humaine et aucun redémarrage automatique                                    |
| 4        | Centre de validation        | Critères et commentaires humains, rapport de review structuré, preuves de tests hôtes, empreintes de fichiers et validation de la bonne révision                                                                                     |
| 5        | Consommation                | Mesures cumulatives par tentative conservées en cas d'échec/annulation, agrégats feature, plafonds entre appels et profils modèles configurés par l'utilisateur                                                                      |
| 6        | Mémoire locale              | Notes relues et stockées localement, injection opt-in des seuls identifiants activés/sélectionnés, limite de 4 000 caractères, aucune génération ou consolidation IA implicite                                                       |
| 7        | Parcours personnalisés      | Éditeur visuel et YAML strict partagé, DAG validé, enregistrement workspace, sessions existantes conservant leur définition                                                                                                          |

Les contrats centraux se trouvent dans `src/shared/types.ts`, `src/shared/evolutions.ts` et `src/shared/workspaces.ts`. Le stockage v3 migre v0/v1/v2 et conserve les historiques. Le pilote est désactivé pour les sessions historiques sans configuration. Les sessions historiques restent dans leur dossier courant. Le retour à la v0.2 sur des données v3 est refusé ; aucune migration inverse n’est fournie. Les fonctionnalités ne créent aucune infrastructure Azure et ne nécessitent pas de service de mémoire distant.

## Séquence de validation et livraison

1. Stabiliser les données partagées et les validateurs stricts, puis migrer v0/v1/v2 vers v3 sans perte des données connues. Vérifier le refus des versions inconnues et l’absence de migration inverse.
2. Vérifier les espaces et points sur de vrais dépôts Git temporaires : HEAD explicite, source dirty/stagée préservée, hooks Git/fsmonitor/filtres externes neutralisés, absence de matérialisation LFS/smudge ou d’installation des dépendances, chemin/branche/racine liés, captures bornées, exclusions, comparaisons et restauration ciblée. Éprouver le fingerprint, la récupération persistée avant écriture, les refus de concurrence et les échecs partiels, sans prompt IA.
3. Vérifier moteur, budget et décisions du pilote avec des fixtures : aucun prompt réel dans ces tests.
4. Vérifier le service avec un adaptateur simulé et les vrais outils hôtes sur fichiers temporaires : questions, reprises, tests locaux autorisés, preuves, consommation et blocages.
5. Vérifier MCP par des catalogues et permissions simulés, y compris provenance, secrets, découverte sans prompt et refus des outils non sélectionnés.
6. Vérifier le webview et les parcours complets dans un environnement de test isolé : lancement aperçu, choix du worktree, points avant/après, comparaison/restauration confirmée, checkpoints du pilote, validation, consommation, mémoire et édition des templates. Inclure les parcours clavier et mobile.
7. Construire le VSIX et ouvrir une extension réelle dans un hôte VS Code isolé. Identifier explicitement ce qui relève d'un adaptateur simulé, du CLI réel ou d'un service MCP réel.
8. Livrer le code et le package demandés après les vérifications, puis contrôler la version effectivement installée. Toute publication reste une action explicitement autorisée. Une compilation locale n'est pas une preuve d'usage réel ou de publication.

Les résultats observés et leurs limites sont tenus dans [VALIDATION.md](VALIDATION.md). Ce plan décrit les capacités et vérifications attendues ; il n'attribue pas un résultat live à un service externe ni une consommation financière garantie. Un diagnostic CLI ou une découverte MCP n'envoie aucun prompt modèle, mais peut communiquer avec le CLI ou le serveur configuré. Un run réel utilise le compte et le quota Copilot de l'utilisateur.

## Décisions conservées

- React/Vite pour le webview, TypeScript/esbuild pour l'hôte ; extension autonome dans VS Code et VS Code Insiders.
- SDK officiel comme transport vers le CLI local. Vérification du catalogue effectif avant le prompt ; aucune substitution aux interfaces internes de Copilot.
- Outils hôtes appliquant les permissions et protégeant les modifications humaines ; aucun shell générique pour le modèle. Les scripts approuvés et MCP restent des capacités explicites avec leurs propres effets.
- Un cockpit par racine et une tentative à la fois dans le cockpit ; deux projets sources distincts peuvent travailler en parallèle. Le worktree utilisé est également verrouillé et un cockpit ouvert directement dedans le réserve pendant toute sa vie. Les mutations sont réservées avant leur premier `await` et refusées pendant une tentative ou un pilote actif. L’arrêt attend la fin des processus avant libération du verrou.
- État privé local, sources agents/skills/workflows dans le workspace ; installation du kit additive sans écrasement.
- Approbation humaine ou automatique tracée, avec identité et révision ; les checkpoints humains prennent priorité sur les corrections.
- Préservation des historiques et invalidation transitive ; aucune relance payante au chargement, aucun rollback implicite des fichiers. Une restauration ciblée demande une sélection humaine, une confirmation et un fingerprint courant ; sa récupération est persistée avant écriture et ses anciennes validations restent invalidées.
- Captures de fichiers bornées et exclusions explicites ; index Git non restauré, changements source non copiés, pas de dépendances installées. Archive = historique conservé, sans suppression du worktree sur disque.
- Protection des buffers dirty de la fenêtre courante seulement ; recontrôles des fichiers sur disque, sans sandbox des autres fenêtres ou processus.
- Économie par sélection du contexte, mémoire bornée, limites de tentatives/cycles et modèles choisis explicitement ; aucune estimation de prix inventée.

Les espaces et restaurations sont détaillés dans [WORKSPACES.md](WORKSPACES.md). Les règles d’utilisation exactes sont dans [WORKFLOWS.md](WORKFLOWS.md), les frontières de modules dans [ARCHITECTURE.md](ARCHITECTURE.md), le transport et les connexions dans [COPILOT.md](COPILOT.md) et [MCP.md](MCP.md).
