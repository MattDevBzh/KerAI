# Plan de réalisation — Feature Studio

L’extension propose un cockpit local dans VS Code et VS Code Insiders. Une feature contient des étapes et chaque étape possède ses propres tentatives Copilot. Les trois parcours initiaux sont le développement complet, la relecture seule et la session libre. Le moteur décide des transitions, jamais le modèle.

1. Vérifier le CLI et son SDK officiels, les événements, les sessions et les permissions. Retenir uniquement les capacités observables.
2. Stabiliser les contrats TypeScript entre interface, moteur, stockage et adaptateur.
3. Construire en parallèle le cockpit React, le moteur persistant et l’intégration CLI. Intégrer le kit fourni comme ressources copiables sans écrasement.
4. Relier les étapes, livrables, questions, validations, configurations et diffs. Restreindre les outils dans le processus hôte et refuser les exécutions dans un workspace non approuvé.
5. Vérifier les transitions, la persistance, les permissions et l’interface ; construire et ouvrir une extension réelle dans un hôte VS Code isolé.
6. Produire le VSIX, documenter utilisation/architecture/extension/limites, puis pousser le code et le livrable dans le dépôt GitHub demandé.

Les tests automatisés utilisent un adaptateur explicitement simulé. Les vérifications de connexion n’envoient aucun prompt. Toute preuve issue d’un modèle réel est identifiée séparément.

## Décisions initiales

- React + Vite pour le webview, TypeScript + esbuild pour l’hôte.
- GitHub Copilot SDK comme transport vers le CLI local, dans `CopilotCliAdapter`.
- Permissions appliquées par des outils hôtes bornés ; pas de shell générique ni de MCP activé implicitement.
- État JSON versionné dans le stockage local VS Code ; workflows/agents/skills éditables dans le dépôt.
- Validation humaine entre étapes, conservation des tentatives, invalidation des étapes dépendantes après révision.
- Aucun remplacement des interfaces internes de GitHub Copilot : un nouvel onglet autonome utilise le même moteur CLI et le compte local.
