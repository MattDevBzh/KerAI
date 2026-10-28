# Boucles de correction vérifiables

Le pilote peut renvoyer un échec de test ou une demande du relecteur vers l'étape qui corrige. Depuis la 1.33.0, **Suivre les progrès de la boucle** ajoute un objectif figé, une comparaison entre les contrôles et un arrêt lorsqu'aucun progrès n'est vérifié. Cette option est désactivée par défaut.

## Préparer un ticket

1. Décris le besoin et ajoute au moins un **critère d'acceptation** observable, par exemple « Après une erreur de sauvegarde, les valeurs saisies restent présentes ».
2. Configure les commandes de test autorisées dans les réglages du projet. Si une commande produit un rapport qualité, conserve son type et son chemin de rapport.
3. Dans **Pilote automatique → Configurer**, choisis l'étape de relecture, l'étape de correction en amont, le nombre maximal de corrections et les points de validation humaine. Garde un point de validation sur le développement pour relire le code avant les tests.
4. Active **Suivre les progrès de la boucle**. Le seuil proposé est de deux comparaisons successives sans progrès vérifié ; le premier résultat établit la référence.
5. Relis l'aperçu puis démarre le pilote. Le besoin, les textes des critères, les commandes et l'organisation du parcours sont alors figés pour cette boucle.

Le contexte obligatoire rappelle les attentes aux agents. Les contrôles de l'hôte refusent de poursuivre lorsque les critères enregistrés changent. La relecture du code et des tests reste nécessaire pour détecter une assertion affaiblie dans les fichiers du projet. Un changement de besoin, de commande, de contexte enregistré ou de parcours interrompt la reprise automatique jusqu'à ton choix explicite.

## Lire le bilan

Le panneau **Boucle de correction** conserve le contrat et les observations. Chaque observation indique le contrôle, la tentative, les références de preuves et les problèmes nouveaux, persistants ou levés. Les contrôles de relecture et les commandes de test sont comparés séparément.

- **Relecture** : constats structurés du modèle, qui ne constituent pas une preuve de test.
- **Test** : reçu du runner hôte, courant, terminé et correspondant à une commande du contrat. Les sorties tronquées ou les rapports incomplets ne valident pas un progrès.
- **Rapport qualité** : comparaison des cas et de leurs résultats attendus ; un cas omis ou ignoré ne résout pas un ancien échec.
- **Commande ordinaire** : un échec persistant reste le même contrôle même si les durées, les chemins temporaires ou les logs changent. Sans rapport structuré, aucun progrès partiel n'est déduit des logs.

**Prête pour ta revue** ne termine pas la session. La validation humaine des critères, les points de contrôle du parcours et la validation finale restent nécessaires. Sans empreintes de fichiers comparables, le bilan reste prudent et ne présente pas le résultat comme vérifié. La lecture et la préparation du bilan n'ajoutent aucun appel IA.

## Quand la boucle s'arrête

- **Contrat modifié** : les critères ou la configuration ne correspondent plus à l'accord initial.
- **Stagnation** : le seuil de comparaisons sans progrès vérifié est atteint.
- **Oscillation** : un ensemble de problèmes revient après avoir été remplacé par un autre.
- **Historique plein** : 80 observations sont déjà conservées. Aucun ancien contrôle n'est supprimé pour continuer artificiellement.
- Les arrêts habituels restent applicables : validation humaine, question, permission, erreur d'exécution, budget ou nombre maximal de corrections.

Tu peux relire les tentatives, revoir le besoin ou les vérifications, puis choisir **Démarrer une nouvelle boucle**. Une confirmation montre les attentes courantes. Cette action archive le contrat précédent et ses observations, conserve les compteurs d'exécutions et de corrections, et laisse le pilote en pause. Il faut le reprendre explicitement. Si le budget est épuisé, son augmentation reste un choix distinct. Vingt anciens contrats au maximum sont conservés ; au-delà, crée une nouvelle session.

La session et son export Markdown conservent le bilan. Une réouverture remet un pilote actif en pause ; elle n'efface ni les observations ni les plafonds consommés. Le stockage passe de la version 12 à la version 13, avec migration des formats précédents ; un ancien binaire ne doit pas écrire dans ce nouveau format.

## Périmètre de cette version

Une seule tentative s'exécute à la fois par cockpit. Les validations obligatoires de chaque étape des sous-équipes et de la documentation restent en place. Cette évolution conserve le fonctionnement existant des sessions dans leurs worktrees. Elle ne promet ni autonomie complète, ni gain de temps mesuré sur des tickets réels.

Les pistes de lot 2 discutées sont un autopilot indépendant sur une carte de sous-plan, une relecture des changements depuis le dernier accord, une preuve de correction « échec avant → réussite après » et un diagnostic avec changement d'approche après stagnation. Elles ne font pas partie de cette release. Les sessions, les worktrees et la vue commune existent déjà.
