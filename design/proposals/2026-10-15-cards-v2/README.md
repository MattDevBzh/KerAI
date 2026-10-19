# Cinq thèmes avec les cartes d’agents originales — V2

15 octobre 2026. Maquettes à comparer avant choix d’une direction pour la production.

## Demande retenue

Conserver les cartes avec le portrait des agents. Seul le thème autour change. Les cinq propositions doivent comporter un mode clair et un mode sombre, et le panneau pédagogique « Dans les coulisses ».

## Livrables

[Ouvrir la galerie interactive](index.html). Les cinq onglets changent le thème ; les boutons Clair, Sombre et Les deux changent l’affichage.

1. [Atelier chaleureux](01-atelier-clair-sombre.png) : lin / terre cuite, puis noyer / ambre.
2. [Station Orbitale](02-orbite-clair-sombre.png) : blanc lunaire / cobalt, puis bleu nuit / cyan.
3. [Papier vivant](03-papier-clair-sombre.png) : papier crème / cobalt, puis ardoise / pervenche.
4. [Guilde pixel](04-guilde-clair-sombre.png) : ivoire / menthe, puis indigo / lavande.
5. [Jardin des idées](05-jardin-clair-sombre.png) : porcelaine / feuillage, puis pin / lumière dorée.

## Conservation des visuels

Les PNG des quatre avatars et le logo ont été copiés directement depuis les assets du produit, sans retouche, génération, filtre ni recoloration. Les références et SHA-256 sont consignés dans `asset-provenance.json`. Les personnages sont affichés dans des cartes de même structure sur les dix variantes. Les noms et les données de session sont illustratifs.

Cette version utilise une maquette HTML/CSS avec les vrais fichiers pour garantir l’identité exacte des portraits. Les décorations sont des formes CSS/SVG autour des cartes. Les planches PNG sont des captures du navigateur et peuvent être régénérées avec :

```sh
node design/proposals/2026-10-15-cards-v2/render.mjs
```

## Vérification

Les dix écrans ont été rendus et inspectés. Les images sont chargées, chaque écran présente quatre cartes, et le changement de thème / de mode fonctionne. Les mesures de rendu sont conservées dans `render-verification.json`.

Ces propositions ne modifient pas l’interface de production. Les boutons de travail sont illustratifs ; les sélecteurs de la galerie sont fonctionnels. Aucun thème n’a encore été choisi pour intégration.
