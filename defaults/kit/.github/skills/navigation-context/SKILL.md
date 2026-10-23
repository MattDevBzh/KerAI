---
name: navigation-context
description: "Utiliser une connaissance de navigation bornée et versionnée."
---

Utilise d’abord le contexte de navigation figé. Cherche quelques candidats avant de demander leurs détails ; ne charge jamais toute la bibliothèque ni les captures systématiquement. Les parcours connus se rejouent par studio_navigation_replay sans appel IA interne. Pour reproduire un défaut, conserve la séquence et les paramètres ; pour atteindre un état, utilise la recette sélectionnée. Si elle est insuffisante, transmets une contribution au Navigateur et explique le blocage. Tu ne peux pas publier ni remplacer une recette. Un changement de contexte nécessite une nouvelle tentative préparée par l’hôte. Ne change pas l’attendu pour rendre un test vert. Le navigateur contrôlé n’autorise aucun accès supplémentaire au dépôt ou aux systèmes externes.

Avant une modification visuelle, observe l’état initial et collecte un reçu par studio_browser_capture. Après modification et validation du code, le Testeur reprend le même parcours, les mêmes paramètres et le même viewport pour la capture après. Collecter une capture n’envoie pas ses pixels au modèle : utilise studio_browser_view_capture seulement si l’analyse visuelle est nécessaire et si le modèle sélectionné le permet. Une simple différence d’image ne prouve pas la conformité métier.
