# Parcours quotidien et ouverture progressive — lots 1 à 15

## Périmètre livré

| Lot | Comportement |
| --- | --- |
| 1 · Intervenir et arrêter | Envoi pendant le travail en pair ; arrêt indépendant de l’acquittement d’un message ; arrêt et nouvelle direction conservée ; reprise manuelle. Une transmission reçue ne prouve pas que la consigne a été appliquée. |
| 2 · Brouillons | Texte, images, projets, permissions, isolation, équipe issue d’une discussion et préférences de progression conservés. Plusieurs préparations possibles pendant une exécution, sans créer de branche ni de worktree. Révisions vérifiées entre fenêtres ; abandon explicite. |
| 3 · Créer et démarrer | Création seule ou création suivie du premier lancement ; choix pair/solo et progression guidée/équilibrée. Utilisation du pilote existant ; questions, permissions et validation finale humaines. Si le lancement échoue, la session créée reste disponible. |
| 4 · Enchaîner | Validation du résultat puis lancement de la prochaine étape ; choix en cas de plusieurs suites. La validation reste acquise si le lancement échoue. Lancement réservé une seule fois et préparation annulable. |
| 5 · Consignes | Consignes de tâche ou du projet principal, activables, modifiables et historisées. Les sous-tâches héritent des consignes de leurs parents ; les nouveaux contextes incluent leur version. Transmission au tour pair actif, ou prise en compte au prochain tour. |
| 6 · Reprendre et citer | Récapitulatif du travail interrompu, blocs restants, fichiers et preuves réellement enregistrées. Citation d’un message ou d’une sélection de code avec chemin, lignes et empreinte ; avertissement si le fichier a changé. |
| 7 · Fil continu | Consultation et recherche des échanges des étapes/tentatives précédentes, décisions et citations dans l’échange actuel. Les conversations natives et leurs permissions restent propres à chaque tentative. |
| 8 · Présentation | Conversation, Résultat, Modifications au premier niveau ; preuves, relecture et activité dans les détails. Réglages secondaires repliés, recherche, retour aux derniers messages, position de lecture et onglet mémorisés. |
| 9 · QG interactif | Questions et permissions dans une popin du plein écran ; brouillon partagé avec le chat, report et réouverture, protection contre les doubles réponses. Volet d’intervention, arrêt, résultat, validation et demande de correction. Les anciennes questions sans processus actif restent répondables sur leur tentative actuelle. |
| 10 · Mesures | Chronologie locale activation/ouverture/panneau/interface/projet actif/secondaires, durées sessions/catalogues/Git/Livraison/navigation/discussions et connexion Copilot distincte. Comptage des processus Git ; aucune commande complète, aucun prompt, contenu ou chemin dans les mesures. |
| 11 · Onglet immédiat | Installation de l’écouteur avant le HTML ; panneau affiché avant le stockage ; préparation visible et erreur avec Réessayer. Les ouvertures répétées partagent le panneau ; les anciennes réponses d’une fenêtre fermée ne rendent pas la nouvelle fenêtre prête. |
| 12 · Git minimal | Lecture de branche et capacité d’isolation sans inventaire des fichiers. Livraison effectue son inspection complète à l’ouverture ou à la demande. Les contrôles avant mutation et les vérifications d’empreinte restent en place. |
| 13 · Projets progressifs | Projet actif en premier, deux chargements secondaires au maximum. États indépendant par projet, listes et compteurs partiels explicites, reprise d’un projet en erreur, routage vers une session après préparation de son projet. |
| 14 · Catalogues et données secondaires | Cache partagé de lectures et de parsing, identité et dates des fichiers revérifiées ; découverte des ajouts/suppressions conservée. Actualisation manuelle ; discussions à la demande ; quêtes et dashboard après le projet actif. Récupération des sessions et suppressions avant publication. |
| 15 · Qualification | Tests de délais artificiels, concurrence, fermeture/réouverture, commandes Git, brouillons et parcours quotidiens. Mesures locales reproductibles avant/après et qualification du paquet dans VS Code ; contrôles CI Linux et Windows. |

## Limites convenues

Les deux dépôts Windows de Matt ne sont pas accessibles. La mesure sur sa machine a été retirée du périmètre à sa demande. Le benchmark fourni utilise des dépôts synthétiques locaux ; les cibles d’une seconde pour l’onglet et trois secondes pour le projet actif ne sont pas déclarées acquises sur sa machine. La CI Windows vérifie le paquet réel dans VS Code et des scénarios automatisés, pas ses deux projets.

L’arrêt ne restaure pas les fichiers déjà modifiés. Les permissions restent celles du mécanisme existant. Les anciennes tentatives restent consultables et ne peuvent pas recevoir d’actions destinées à la tentative courante.

## Vérification

Les preuves et résultats consolidés sont consignés dans [VALIDATION.md](VALIDATION.md). Les exigences supplémentaires originales restent dans [LOTS-10-15.md](LOTS-10-15.md).
