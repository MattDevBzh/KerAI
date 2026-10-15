# Logo « L’équipe » — 15 octobre 2026

Le propriétaire a choisi la quatrième des cinq propositions : trois agents réunis dans un même symbole. Le fichier `source.png` conserve exactement le rendu approuvé, créé avec l’outil intégré de génération d’images.

## Prompt de création

Logo original pour Feature Studio, extension VS Code permettant de composer des équipes d’agents IA et de piloter les étapes de développement. Une seule marque compacte, centrée, sur fond réellement transparent, destinée aux icônes d’application et de raccourci Windows. Trois visages de robots simples : un carré arrondi turquoise en haut, un cercle violet en bas à gauche et un triangle arrondi corail en bas à droite. Deux yeux par visage, surfaces bleu nuit, connecteur central en Y. Géométrie moderne, silhouette lisible en petit, aucun texte, décor, ombre portée ou logo tiers.

## Déclinaisons intégrées

- `resources/icon.png` : export PNG transparent de 512 × 512 px, partagé par la fiche de l’extension, le lanceur, l’onglet et le cockpit. Vite importe ce même fichier pour l’interface.
- `resources/feature-studio.ico` : icône Windows contenant les tailles 16, 24, 32, 48, 64, 128 et 256 px.
- `resources/team.svg` : adaptation géométrique monochrome sur une grille 24 × 24, avec les trois formes et leurs yeux en transparence pour la barre d’activité VS Code.

`npm run logo:pack` réencode le rendu approuvé aux tailles nécessaires, sans en modifier le dessin ou les couleurs. Les anciens fichiers `cockpit-avatar.png`, `cockpit-geek.svg` et `icon.svg` restent historiques ; ils ne sont plus utilisés par l’extension.

La création du raccourci copie l’ICO dans le stockage personnel du cockpit et affecte ce chemin stable à `IconLocation`. Le raccourci continue à viser l’édition de VS Code utilisée. L’icône native du processus VS Code et son regroupement dans la barre des tâches restent gérés par VS Code et Windows.
