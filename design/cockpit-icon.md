# Icône du cockpit

`resources/cockpit-geek.svg` est l’adaptation vectorielle monochrome originale de l’[illustration du cockpit](cockpit-avatar/source.png), générée avec l’outil natif imagegen à partir du [prompt conservé](cockpit-avatar/PROMPT.md). L’illustration couleur est exportée dans `resources/cockpit-avatar.png` pour le volet du cockpit. Le SVG reprend sa coiffure décontractée, ses lunettes rondes, son hoodie, son visage de trois quarts et son ultrabook à droite.

L’adaptation a été dessinée en chemins SVG sur une grille native de 24 × 24 ; elle n’est ni une vectorisation automatique du PNG ni un dessin entièrement indépendant de l’illustration générée. Les deux verres de tailles différentes et le contour du nez rendent l’orientation du visage visible. L’écran oblique possède une ouverture transparente et le clavier forme un plateau peu profond sous les mains.

Le SVG utilise exclusivement du blanc sur fond transparent, des coordonnées entières et `shape-rendering="crispEdges"`. VS Code applique la couleur du thème à son masque. L’aperçu a été inspecté à 24, 48 et 192 px sur fonds sombre et clair ; à 24 px, les détails de barbe, de regard et de sourire de l’illustration sont volontairement simplifiés.

Ces assets du dépôt sont distribués sous sa licence MIT (© 2026 Matthieu Férellec). Les recommandations de l’[Activity Bar de VS Code](https://code.visualstudio.com/api/ux-guidelines/activity-bar) servent de référence d’intégration. L’icône de la fiche d’extension conserve son identité propre.
