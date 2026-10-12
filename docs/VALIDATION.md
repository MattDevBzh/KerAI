# Validation et limites — 13 octobre 2026

## Preuves locales

| Périmètre | Vérification |
| --- | --- |
| TypeScript et builds | `npm run check` : hôte esbuild et webview Vite produits |
| Métier et intégration | **60 tests Vitest** : DAG, approbations, obsolescence, questions, limites, fichiers, stockage, registre, adapter, annulation et service complet |
| Interface | **14 tests Playwright** : création, livrables, questions, diffs, avatars/pseudos, hooks, budgets, reprise, mobile, thèmes et réduction des animations |
| Hôte VS Code | Tests dans un vrai hôte isolé : activation, chargement effectif du JavaScript sous CSP, trois workflows, création/configuration, installation du kit, pseudo/avatar, fermeture/réouverture |
| CLI depuis l’hôte | Diagnostic réel de l’adaptateur empaqueté : connexion, version et modèles sans prompt |
| Paquet VSIX | Installation en profil isolé et exécution des tests d’hôte sur le contenu extrait du paquet |
| Copilot réel | Une demande en lecture seule sur un dossier jetable : lecture par outil hôte d’un marqueur non donné dans le prompt, réponse exacte, événements, usage et approbation |
| Reprise réelle | Reconnexion à cette conversation sans nouvelle requête modèle ; historique et résultat d’outil retrouvés, catalogue restreint réappliqué |
| Dépendances | `npm audit` : aucun avis de vulnérabilité signalé au moment de la validation |

Le cycle complet à cinq étapes a été vérifié avec un adaptateur de test et les **vrais outils fichiers/runner local** : écriture, tests locaux explicitement autorisés, approbations, correction et persistance. Cela ne démontre pas la qualité d’une feature arbitraire développée intégralement par un modèle.

La preuve de requête réelle se trouve dans [live-smoke.json](live-smoke.json). GitHub a annoncé le routage effectif **gpt-5-mini** pour le choix `auto`, 5 809 tokens entrants et 376 sortants, 154 185 000 nano-AIU. Il s’agit d’une mesure remontée par le runtime, pas d’une facture en euros. Le diagnostic et les tests automatisés n’envoient aucun prompt.

Versions vérifiées sur macOS arm64 : GitHub Copilot CLI **1.0.63**, protocole **3**, SDK **1.0.20**, VS Code/Insiders **1.141.0**. L’intégration vérifie les capacités du CLI avant le prompt ; elle ne se contente pas du numéro de version.

## Limites connues

- Le cockpit est un onglet indépendant de la vue Chat native de GitHub Copilot. Aucun détournement des API privées de cette extension.
- Une seule tentative et un seul cockpit par dossier sur la machine. L’arborescence multi-root laisse choisir un dossier ; les projets restent indépendants.
- Le modèle ne peut ni supprimer/renommer des fichiers, ni exécuter un terminal libre, installer des dépendances, publier ou appeler des MCP. Les créations/modifications de fichiers et commandes de tests configurées sont prises en charge.
- Les scripts/hooks approuvés par l’utilisateur sont des processus locaux ordinaires. Ils ne sont pas enfermés dans une sandbox système. Le CLI lui-même utilise le service GitHub pour l’IA.
- Les dossiers autorisés pour les écritures de tests sont des préfixes, sans glob. Les fichiers de tests colocalisés demandent un dossier autorisé adapté.
- Les fichiers de plus de 256 Ko et les binaires ne sont pas lus/édités par les outils hôtes. La liste est bornée à 1 500 fichiers et la recherche à 100 correspondances. Les logs de sortie et les diffs sont bornés ; les messages tronqués ne constituent pas une preuve exhaustive.
- Les outils ignorent les liens symboliques et certains chemins sensibles usuels. Il n’existe pas de détection parfaite de tous les secrets contenus dans tous les fichiers. Les exports et prompts doivent rester adaptés au contexte professionnel.
- Une édition manuelle concurrente est détectée par empreinte de contenu. Cela protège des collisions ordinaires ; ce n’est pas une garantie contre un programme local malveillant qui modifie simultanément le système de fichiers.
- Une fermeture conserve les changements déjà effectués. L’extension ne restaure pas automatiquement le dépôt et n’effectue aucun commit. Les diffs ouvrent **HEAD ↔ workspace courant**, pas un snapshot immuable propre à une tentative.
- Le CLI 1.0.63 ne comprend pas `session.detach`, utilisé par ce SDK récent. L’adaptateur tente l’arrêt gracieux, puis ferme le transport avec une borne temporelle. La reprise réelle a retrouvé la conversation et le résultat d’outil ; le dernier message assistant n’était pas dans son transcript natif. Feature Studio conserve ce livrable dans son propre état et le réinjecte lors de la reprise.
- Les identifiants de modèle et niveaux de raisonnement sont ceux du compte. Au moment de la recette, la découverte exposait uniquement `auto` ; une longue liste de modèles n’est pas inventée.
- L’interface ne connaît pas le solde financier mensuel exact, ne convertit pas les nano-AIU en euros et n’offre pas de plafond de dépense garanti. Les limites de tentatives et délais sont appliquées.
- Les questions structurées reposent sur un bloc Markdown JSON validé. Un bloc mal formé fait échouer la tentative ; aucun succès n’est fabriqué. Le modèle peut aussi poser du texte ordinaire qu’il faut traiter via feedback.
- Windows et Linux ne sont pas validés sur une machine interactive dans cette livraison. La CI Linux exécute les tests, le build et le packaging. Sous Windows, utiliser des exécutables natifs pour les tests/hooks ; les lanceurs `.cmd` ne sont pas pris en charge par le runner sans shell.
- Les hooks Copilot, MCP et plugins existants ne sont pas activés implicitement. Les hooks propres à Feature Studio sont configurés explicitement dans son interface.
- Les modifications directes des fichiers d’agents/skills/workflows sont chargées avec **Actualiser**. Un flow existant conserve sa définition copiée à la création ; les changements YAML servent aux nouvelles sessions.
- La migration prise en charge est v0 → v1 ; toute version inconnue ou corruption préserve le fichier et affiche une erreur. Il n’existe pas encore d’import de session exportée ou de synchronisation multi-machine.

Les captures du README montrent le **mode démonstration**, indiqué visiblement. Les personnages et leurs animations sont les mêmes assets que ceux du VSIX. Les sources générées sont conservées dans `design/avatars` et leur assemblage est reproductible.
