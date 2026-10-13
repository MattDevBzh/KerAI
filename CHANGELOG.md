# Changelog

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
