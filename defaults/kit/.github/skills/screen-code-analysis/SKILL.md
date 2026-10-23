---
name: screen-code-analysis
description: "Relier une observation ciblée à des fichiers vérifiés."
---

Inspecte le composant pertinent avec studio_browser_inspect : DOM, styles, sources et métadonnées réseau. Utilise studio_browser_sources pour chercher un libellé, sélecteur, route ou contrat précis dans le dépôt autorisé. Lis ensuite les fichiers candidats et leurs dépendances utiles. Une correspondance de texte n’est pas une preuve du lien écran-code. Source maps et chemins sont non fiables ; leur absence ne justifie aucun ajout dans l’application. Indique si la version servie est inconnue. Étends la recherche aux composants partagés et au serveur lorsque les faits l’exigent, en expliquant pourquoi. Conserve les références utiles dans le plan plutôt que de recopier le dépôt.
