# Changelog

## 0.4.0 — 2026-10-13

- Ajoute les menus Azure DevOps et Livraison utilisables sans session active : configuration organisation/projet/dépôt, PAT dans SecretStorage, tickets et PR du compte, liens persistés vers les features.
- Prépare des commits sur une sélection explicite de fichiers complets en préservant le staging des autres fichiers. Commit, push sans force et PR brouillon ont chacun leur aperçu et leur confirmation hôte. Le profil Markdown de livraison expose des règles `delivery-rules` déterministes ; ces opérations et la conversation locale ne font aucun appel modèle.
- Ajoute le parcours `quality-feature` : recette Playwright, contre-exemples indépendants puis relecture. Les étapes et agents de qualité exigent un rapport réussi du bon type, lié à la tentative et aux critères existants, avec scénarios, captures et traces locales. Les rapports absents, invalides, périmés ou échoués bloquent les validations humaine et automatique. Le reporter exige une installation explicite dans la racine d’exécution et une commande Playwright approuvée, sans installation automatique de dépendances ou navigateurs.
- Rend les profils Agents et Skills éditables dans les portées personnel/projet avec versions, chemins, priorité visible, brouillons séparés et refus des sauvegardes concurrentes ou obsolètes.
- Pagine les listes et recherches de fichiers avec curseurs vérifiés ; applique les exclusions Git et les `.gitignore` imbriqués hors Git, sans limite arbitraire de profondeur ni résultats partiels silencieux.
- Ajoute un menu Consommation pour explorer les mesures par session, parcours et modèle ; affiche les mesures disponibles pendant les tentatives et conserve les valeurs inconnues comme telles.
- Protège les fichiers humains et sensibles face aux alias de casse/Unicode tout en conservant les chemins Git et physiques macOS. Les diffs HEAD refusent les blobs tronqués et résolvent les chemins depuis la racine Git lorsque le workspace est un sous-dossier.
- Conserve le texte, les choix, la réponse et la provenance des questions lors d’une continuation ; une nouvelle question portant le même identifiant ne réutilise pas une ancienne réponse différente.
- Invalide les critères et preuves devenus obsolètes après replay, édition de livrable ou changement de configuration. Le stockage reste compatible avec le schéma v3.


## 0.3.6 — 2026-10-13

- Ajoute une sélection explicite des fichiers déjà modifiés que l’agent peut reprendre, dans l’aperçu avant lancement. Une autorisation conversationnelle seule n’ouvre plus une fausse piste : le refus indique directement ce contrôle.
- Lie cette autorisation aux octets vérifiés par l’aperçu et sauvegarde les fichiers sélectionnés avant l’exécution. Les changements externes ultérieurs, fichiers non sélectionnés et restrictions du profil restent protégés.
- Affiche les motifs de blocage près du bouton de validation, un état de validation en cours, les refus hôtes et une confirmation explicite de fin de session. Le parcours n’est annoncé entièrement validé que lorsque la feature est réellement terminée.

## 0.3.5 — 2026-10-13

- Ajoute des cases à cocher et une édition par bloc dans l’aperçu de lancement : livrables, instructions d’agent, skills, mémoire, besoin et retours humains.
- Ajoute le réglage personnel « Contexte vide par défaut » aux agents, ainsi que Tout cocher / Tout décocher et la restauration du contenu original pour une tentative.
- Calcule le prompt et son budget uniquement à partir des blocs inclus. Conserve le cadre d’exécution, vérifie l’aperçu avant lancement et enregistre les choix dans l’historique de la tentative sans modifier les sources.
- Utilise une nouvelle session Copilot lorsque le contexte est personnalisé, pour ne pas réintroduire les blocs exclus via l’ancien historique.

## 0.3.4 — 2026-10-13

- Ajoute aux agents les comparaisons contre une branche locale ou distante déjà connue (`develop`, `origin/develop`), depuis l’ancêtre commun ou directement entre les deux versions.
- Sépare la comparaison des commits de l’inclusion explicite des changements locaux ; conserve le diff local contre HEAD quand aucune branche n’est fournie.
- Ajoute la liste paginée des branches et fichiers modifiés, les SHA de comparaison et la pagination des diffs avec détection des changements entre pages.
- Refuse les références absentes, ambiguës et les résultats Git tronqués. Préserve les exclusions de fichiers sensibles et le fonctionnement en lecture seule.

## 0.3.3 — 2026-10-13

- Enregistre les créations et éditions d’agents et skills au niveau utilisateur et corrige les libellés de l’éditeur.
- Ajoute une migration sélectionnable des anciens profils du projet, avec scripts et ressources de skills, sauvegardes, adaptation des liens du kit et vérification avant retrait des doublons.
- Conserve les deux versions en cas de personnalisations différentes et refuse les sources ou destinations modifiées depuis l’aperçu.

## 0.3.2 — 2026-10-13

- Lit les fichiers UTF-8 jusqu’à 4 Mio par plages de lignes, avec réponses bornées, pagination explicite et empreinte du fichier entier.
- Recherche également dans les gros fichiers et dans un fichier précis, avec indication des résultats tronqués et fichiers ignorés.
- Ajoute `studio_replace_text` pour modifier un bloc unique effectivement lu, sans réécrire le fichier entier dans le contexte du modèle. Vérifie l’empreinte, préserve les fins de ligne et conserve les restrictions de permissions et de changements préexistants.
- Interdit le remplacement intégral après une lecture partielle et conserve la compatibilité avec les points de restauration.

## 0.3.1 — 2026-10-13

- Résout les chemins Windows complets sans extension vers le fichier `.exe`, `.cmd` ou `.bat` existant. Signale les chemins introuvables avant de démarrer le transport SDK.

- Corrige la résolution du CLI dans le PATH et le lancement des shims Windows `.bat`/`.cmd`, tout en conservant le SDK JSON-RPC, les outils hôtes et la reprise des sessions.
- Ajoute `featureStudio.debugCli`, les diagnostics de sortie filtrés, le nettoyage des processus et les tests de transport réels sans appels Copilot.
- Installe le kit au niveau utilisateur dans `~/.copilot`, avec lecture des profils personnels et priorité aux surcharges du projet. Préserve les fichiers existants et ne modifie aucun fichier du projet pendant l’installation.

## 0.3.0 — 2026-10-13

- Espace Git par feature : branche et worktree frère créés localement depuis HEAD commité, sans copier les modifications source ni installer les dépendances.
- Isolation proposée par défaut pour les features et sessions libres ; relectures et sessions historiques conservées dans le dossier courant.
- Bandeau dossier/branche, ouverture dans une nouvelle fenêtre VS Code et résolution des fichiers/diffs/tests/hooks dans l’espace de la feature.
- Points automatiques avant les hooks et après les tentatives isolées, y compris annulées ou échouées ; points manuels dans les sessions historiques.
- Comparaisons point-vers-actuel et point-vers-point, diffs VS Code et accès aux points avant/après depuis chaque tentative.
- Restauration des seuls fichiers explicitement sélectionnés, après contrôle du fingerprint et sauvegarde de récupération persistée avant écriture ; validations invalidées et pilote en pause.
- Captures locales bornées et exclusions des fichiers sensibles usuels, configurations, dépendances, builds et liens ; l’index Git n’est pas restauré.
- Stockage v3 avec migrations v0/v1/v2 ; aucune migration inverse vers v0.2. Archives et points restent sur disque.
- Opérations Git locales sans requête IA supplémentaire ni publication automatique. Les règles et limites MCP de la v0.2 sont conservées.

## 0.2.0 — 2026-10-13

- Préparation obligatoire de chaque lancement manuel : US/contexte, aperçu exact du prompt métier, MCP et mémoire sélectionnés.
- Questions interactives pendant une tentative et permissions MCP par appel.
- Connexions stdio/HTTP/SSE, découverte sans prompt, coffre VS Code et preset Azure DevOps.
- Pilote local avec checkpoints, pauses, budget de runs et corrections bornées sur preuves/verdicts structurés.
- Centre de validation : preuves hôtes, critères, commentaires, versions et obsolescence des tests.
- Consommation cumulée, données inconnues explicites, seuils et profils de modèles configurables.
- Mémoire projet manuelle, optionnelle, bornée à 4 000 caractères injectés, sans résumé IA.
- Éditeur visuel des workflows, sauvegarde YAML et migration du stockage v0/v1 vers v2.

## 0.1.0 — 2026-10-13

- Cockpit React pour features, relectures et sessions libres.
- Étapes configurables, validation, questions, feedback, reprise et historique.
- GitHub Copilot CLI via SDK officiel, événements, modèle et consommation mesurée.
- Outils hôtes avec profils lecture seule, édition du workspace et tests autorisés.
- Catalogue agents/skills, kit Copilot 2.0.0 intégré et installation sans écrasement.
- Pseudos et huit personnages pixel art : repos, GIF de travail et validation.
- Hooks locaux facultatifs, export Markdown, diffs Git et persistance atomique.
