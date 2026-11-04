# Validation — parcours quotidien et ouverture progressive

Base comparée : `7ec2065`, version 1.37.1. Environnement local : macOS, Node 24.1.0. La CI utilise Node 22.

## Couverture

- Service : arrêt sur une version d’interface périmée, réorientation persistée sans relance, messages natifs, reprise et permissions, consignes versionnées, contexte et enchaînement dédupliqué/annulable.
- Stockage : plusieurs brouillons durables, révisions concurrentes, lecture et suppression ; compatibilité des champs optionnels avec le stockage v16 existant.
- Démarrage : projet secondaire bloqué, concurrence bornée à deux, erreur indépendante, routage retardé, fermeture durant le chargement, branche sans inventaire Git, inspection Livraison différée, contenu des diagnostics sans chemin.
- Interface : brouillon pendant une exécution, restauration des préférences, création et démarrage, arrêt indépendant d’un envoi, onglets, questions partagées, thèmes, écrans étroits et QG.
- VS Code : interface prête pendant un blocage volontaire de la préparation, panneau unique, fermeture/réouverture avant libération ; scénarios existants sur Git, récupération, profils, contextes et permissions.

## Mesures reproductibles

Commande : `node scripts/benchmark-startup.mjs /chemin/checkout-1.37.1 resultat.json`.

Les données brutes figurent dans [startup-benchmark.json](startup-benchmark.json). Deux dépôts synthétiques : chacun contient 2 000 fichiers suivis, 300 modifications, 1 500 fichiers non suivis et 100 sessions avec des rapports volumineux. Cinq processus Node neufs puis dix chargements répétés dans un même processus sont mesurés pour chaque version. Le chemin historique prépare les deux projets et inspecte Livraison ; le nouveau rend le premier projet disponible avant le second et diffère l’inspection complète.

Ce protocole mesure le cœur de préparation, pas l’apparition du panneau ni le premier rendu VS Code. Il ne vide pas le cache du système d’exploitation et n’utilise pas les projets de Matt. Les objectifs sur sa machine Windows restent non mesurés, conformément à sa demande.

Médianes de la mesure isolée, sans autres suites de tests en parallèle :

| Mesure | 1.37.1 | 1.38.0 |
| --- | ---: | ---: |
| Projet actif, processus neufs (5) | 1 088 ms | 133 ms |
| Tous les projets, processus neufs (5) | 1 088 ms | 222 ms |
| Projet actif, chargements répétés (10) | 1 023,5 ms | 83 ms |
| Tous les projets, chargements répétés (10) | 1 023,5 ms | 162,5 ms |
| Processus Git avant le projet actif | 48 | 9 |
| Processus Git pour les deux projets | 48 | 18 |

Le gain du projet actif inclut le retrait du second projet du chemin d’attente. Le gain total inclut les inspections Git différées et le cache des catalogues. Il ne permet pas d’attribuer une part exacte à chaque optimisation ni d’expliquer les 60 secondes constatées sur le poste Windows inaccessible.

## Résultats de livraison

- Suite logique complète : **1 184 tests réussis, 11 conditionnels ignorés**, 98 fichiers réussis. Les contrôles du CLI configuré et des lanceurs Windows sont exécutés par la CI sur leur environnement dédié.
- Suite d’interface finale : **353 scénarios réussis**. Les scénarios historiques ont été adaptés aux boutons de brouillon et aux questions désormais récupérées en popin ; leurs assertions métier restent présentes. La création sans catalogue garde son contrat antérieur.
- TypeScript, format, construction et contrôle des différences : réussis. Les tests de démarrage interdisent chacun des inventaires Git différés, sans seulement vérifier leur combinaison.
- Paquet local **1.38.0** extrait et vérifié contre **314 fichiers construits et 133 ressources publiques**, puis chargé avec succès dans VS Code Insiders sur macOS. Ouverture avec préparation bloquée, panneau unique, fermeture/réouverture, sessions, permissions, contextes, Git réel, récupération et sauvegardes sont vérifiés dans des profils isolés.
- Recette visuelle du formulaire, des onglets, du QG et de son volet ; captures en thèmes clair/sombre et fenêtre étroite. [Question dans le QG](../../screenshots/session-ergonomics/qg-question.png).
- La publication depuis `main` exige la CI Linux et Windows, un nouveau contrôle du paquet publié et son chargement dans VS Code. La CI Windows comprend désormais le paquet extrait et les parcours quotidiens. Le résultat exact du commit livré est lié automatiquement dans la [release v1.38.0](https://github.com/MattDevBzh/KerAI/releases/tag/v1.38.0).

Aucun prompt Copilot payant n’est envoyé par ces vérifications. Les comptes distants sont simulés dans les tests fonctionnels. Les mesures des deux projets Windows réels restent exclues comme convenu ; ces résultats ne prouvent pas les objectifs d’une seconde et trois secondes sur ce poste.
