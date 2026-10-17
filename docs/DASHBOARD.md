# Dashboard Métro et Tour de contrôle

**Sessions** remplace le nom de l’ancienne page d’accueil. Elle conserve la création, le choix d’équipe, les étapes et les comptes rendus. **Dashboard** est une nouvelle page de suivi de tous les projets enregistrés.

## Composer son tableau

Le tableau propose six modules : Sessions en cours, À traiter, Pull requests, Tickets, Consommation et Activité récente. **Personnaliser** permet d’ajouter, dupliquer ou retirer un module, puis de le déplacer avec sa poignée ou ses flèches. Les réglages de chaque module donnent accès au titre, à la largeur dans chacun des deux modes, à la hauteur et aux filtres. En personnalisation, le coin inférieur droit permet aussi de changer la hauteur à la souris. Au maximum 24 modules sont conservés.

Le filtre global de projet s’applique à tous les modules. Un projet choisi dans un module restreint encore ce périmètre. Les sessions se filtrent par texte, état et agent courant ; les PR par état, texte, auteur, relecteur et brouillon. Les tickets acceptent les types et états personnalisés, l’assignation, les tags, la zone, le sprint et une recherche par titre ou numéro. Les listes multiples se séparent avec `;`. Deux modules Tickets peuvent ainsi suivre « Mes bugs urgents » et « Tickets du sprint » avec leurs propres filtres, sans modifier les recherches de l’écran Tickets.

La disposition et les filtres sont enregistrés dans le stockage personnel du cockpit (`dashboard.json`), partagés entre les deux vues et conservés après redémarrage. Deux enregistrements concurrents ne s’écrasent pas : une modification devenue obsolète affiche les réglages actuels et invite à réessayer.

## Lire les sessions

Chaque station correspond à une vraie étape du parcours. Les étapes validées sont grisées avec une coche ; l’étape en cours est lumineuse, les suivantes sont vides. Une attente humaine apparaît en orange avec un symbole de pause ; un échec ou une interruption est rouge avec une croix. Le nom de l’agent, le nombre d’étapes validées et la durée écoulée restent visibles. Aucune estimation de fin n’est calculée.

Cliquer sur une station, une intervention ou une activité ouvre la session et son étape dans le cockpit. La Tour de contrôle ne lance, n’approuve et ne relance aucun agent. **À traiter** rassemble les réponses humaines, les comptes rendus à valider, les erreurs et la validation finale des sessions. **Activité récente** présente les vingt sessions les plus récemment mises à jour.

## Second écran

**Ouvrir dans une nouvelle fenêtre** détache une vraie fenêtre auxiliaire VS Code, dans la disposition compacte **Tour de contrôle**. Déplace-la sur ton second écran et utilise **Plein écran** si nécessaire. **Revenir au cockpit** retrouve la page Sessions. La commande **Feature Studio : ouvrir la Tour de contrôle** permet également de l’ouvrir.

Les deux fenêtres partagent le même hôte, les mêmes sessions et un seul mécanisme d’actualisation. Fermer l’onglet du cockpit laisse le suivi actif tant que la Tour de contrôle reste ouverte ; son bouton de retour rouvre le cockpit. Fermer la dernière vue libère normalement le cockpit. La fonction nécessite une version de VS Code disposant des fenêtres auxiliaires ; une indisponibilité est signalée.

## Actualisation et limites

- Les sessions suivent les événements du moteur. Les durées se mettent à jour chaque seconde.
- Azure DevOps est consulté toutes les 60 secondes par défaut : 15, 30, 60, 120 ou 300 secondes, ou uniquement manuellement. Le bouton **Actualiser** force une lecture. Une seule lecture est en cours à la fois, les requêtes identiques sont partagées dans une actualisation, et les lectures s’interrompent lorsque les deux vues sont masquées ou fermées.
- Les modules Tickets montrent au maximum 50 éléments par projet et par filtre. Les PR portent sur le dépôt configuré, tous auteurs compris, avec une limite de 200 avant les filtres textuels. Toute limite est signalée : l’absence d’un élément dans un résultat partiel ne prouve pas son absence dans Azure. La page complète permet de poursuivre la consultation.
- Chaque module affiche la date de sa dernière actualisation. Une panne ou déconnexion reste visible ; lors d’un échec total, la dernière copie conserve sa date et porte un avertissement.
- La consommation du compte Copilot reste globale et peut être indisponible ou différée. Elle ne se confond pas avec les crédits mesurés des tentatives des sessions filtrées. Les mesures manquantes ne deviennent pas des zéros.
- Les pipelines/CI et les statistiques historiques ne font pas partie de cette version. Les vérifications automatisées Azure utilisent des réponses simulées ; les droits du compte réel doivent être vérifiés dans le cockpit.
