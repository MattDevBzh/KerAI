# Halloween — pack événement

Vingt variantes générées à partir des planches originales dans `design/avatars/professions`, sans modifier les fichiers sources. Les prompts exacts figurent dans `prompts.json`.

Reproduire l’extraction mécanique : `node scripts/pack-avatars.mjs --event halloween`. Chaque planche transparente de 1536 × 1024 contient six cellules : repos, quatre images de travail et réussite. Les exports de 256 × 256 sont dans `webview/public/avatar-events/halloween`.

Le thème déclare son `avatarPack` dans `src/shared/themes.ts`. `AgentImage` choisit le pack en présentation, avec repli vers le portrait habituel ; aucun identifiant de profil ne change. Pour un prochain événement, ajouter sa définition, son pack et l’autorisation explicite du script d’extraction, puis étendre les tests du catalogue.
