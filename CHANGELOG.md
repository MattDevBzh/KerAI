# Changelog

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
