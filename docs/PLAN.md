# Plan de réalisation — évolution v0.2

La v0.2 étend le cockpit local avec le contexte manuel et les connexions MCP, puis un pilote séquentiel, un centre de validation, la consommation, la mémoire locale et l'édition des parcours. Le moteur garde l'autorité sur les transitions. Les décisions d'orchestration, l'aperçu et la sélection de mémoire ne déclenchent aucun appel IA supplémentaire.

## Ordre produit et contrats livrés

| Priorité | Capacité | Contrat implémenté |
| --- | --- | --- |
| 1 | MCP et contexte manuel | Configuration locale et références de secrets, découverte du catalogue, choix exact des outils/serveurs par lancement, permissions humaines, aperçu du prompt et fingerprint anti-obsolescence |
| 2 | Pilote automatique | Configuration et démarrage explicites, exécution séquentielle, checkpoints prioritaires, arrêts avant exécution, corrections déclarées et bornées, pause humaine et aucun redémarrage automatique |
| 3 | Centre de validation | Critères et commentaires humains, rapport de review structuré, preuves de tests hôtes, empreintes de fichiers et validation de la bonne révision |
| 4 | Consommation | Mesures cumulatives par tentative conservées en cas d'échec/annulation, agrégats feature, plafonds entre appels et profils modèles configurés par l'utilisateur |
| 5 | Mémoire locale | Notes relues et stockées localement, injection opt-in des seuls identifiants activés/sélectionnés, limite de 4 000 caractères, aucune génération ou consolidation IA implicite |
| 6 | Parcours personnalisés | Éditeur visuel et YAML strict partagé, DAG validé, enregistrement workspace, sessions existantes conservant leur définition |

Les contrats centraux se trouvent dans `src/shared/types.ts` et `src/shared/evolutions.ts`. Le stockage v2 migre v0/v1 et conserve les historiques. Le pilote est désactivé pour les sessions historiques sans configuration. Les fonctionnalités ne créent aucune infrastructure Azure et ne nécessitent pas de service de mémoire distant.

## Séquence de validation et livraison

1. Stabiliser les données partagées et les validateurs stricts, puis migrer l'état sans perte de données connues.
2. Vérifier moteur, budget et décisions du pilote avec des fixtures : aucun prompt réel dans ces tests.
3. Vérifier le service avec un adaptateur simulé et les vrais outils hôtes sur fichiers temporaires : questions, reprises, tests locaux autorisés, preuves, consommation et blocages.
4. Vérifier MCP par des catalogues et permissions simulés, y compris provenance, secrets, découverte sans prompt et refus des outils non sélectionnés.
5. Vérifier le webview et les parcours complets dans un environnement de test isolé : lancement aperçu, checkpoints, validation, consommation, mémoire et édition des templates.
6. Construire le VSIX et ouvrir une extension réelle dans un hôte VS Code isolé. Identifier explicitement ce qui relève d'un adaptateur simulé, du CLI réel ou d'un service MCP réel.
7. Livrer le code et le package demandés après les vérifications, puis contrôler la version publiée. Une compilation locale n'est pas une preuve d'usage réel ou de publication.

Les résultats observés et leurs limites sont tenus dans [VALIDATION.md](VALIDATION.md). Ce plan décrit les capacités et vérifications attendues ; il n'attribue pas un résultat live à un service externe ni une consommation financière garantie. Un diagnostic CLI ou une découverte MCP n'envoie aucun prompt modèle, mais peut communiquer avec le CLI ou le serveur configuré. Un run réel utilise le compte et le quota Copilot de l'utilisateur.

## Décisions conservées

- React/Vite pour le webview, TypeScript/esbuild pour l'hôte ; extension autonome dans VS Code et VS Code Insiders.
- SDK officiel comme transport vers le CLI local. Vérification du catalogue effectif avant le prompt ; aucune substitution aux interfaces internes de Copilot.
- Outils hôtes appliquant les permissions et protégeant les modifications humaines ; aucun shell générique pour le modèle. Les scripts approuvés et MCP restent des capacités explicites avec leurs propres effets.
- Un cockpit et une tentative à la fois par dossier ; l'arrêt attend la fin des processus avant libération du verrou.
- État privé local, sources agents/skills/workflows dans le workspace ; installation du kit additive sans écrasement.
- Approbation humaine ou automatique tracée, avec identité et révision ; les checkpoints humains prennent priorité sur les corrections.
- Préservation des historiques et invalidation transitive ; aucune relance payante au chargement, aucun rollback implicite des fichiers.
- Économie par sélection du contexte, mémoire bornée, limites de tentatives/cycles et modèles choisis explicitement ; aucune estimation de prix inventée.

Les règles d'utilisation exactes sont dans [WORKFLOWS.md](WORKFLOWS.md), les frontières de modules dans [ARCHITECTURE.md](ARCHITECTURE.md), le transport et les connexions dans [COPILOT.md](COPILOT.md) et [MCP.md](MCP.md).
