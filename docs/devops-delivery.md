# Azure DevOps et livraison

Les menus **Azure DevOps** et **Livraison** s’ouvrent sans feature ni session active. Le checkout actuellement ouvert est la cible Git. Un HEAD détaché ou un dépôt sans premier commit demande d’abord une intervention Git manuelle. Ouvrir la racine du dépôt, pas un sous-dossier.

## Configuration depuis le menu

Renseigner organisation, projet, dépôt et remote Git. Un remote `origin` Azure DevOps HTTPS ou SSH est détecté au premier lancement, sans présumer que le dépôt utilise Azure DevOps. Le tableau conserve la configuration et les liens dans `devops.json` du stockage privé VS Code. Un jeton personnel est saisi exclusivement dans une fenêtre hôte masquée, puis conservé avec `SecretStorage`. Aucun secret n’est envoyé au webview, aux paramètres ou au journal. Droits nécessaires : Work Items en lecture et Code en lecture/écriture pour les PR. Le push utilise les identifiants Git déjà configurés sur la machine.

L’aperçu du menu **Azure DevOps** conserve les 200 tickets assignés au compte authentifié et les 200 PR créées par celui-ci. Le sous-menu **PR** ajoute recherche locale, filtres par état/lien et tri sur ces PR reçues. Les compteurs restent inconnus avant le premier chargement ; une erreur conserve les données précédentes et leur date. La recherche complète de tickets dispose de son écran **Tickets**, dans le même groupe de navigation **DevOps**.

## Chercher un ticket et préparer son développement

L’écran **Tickets** interroge Azure DevOps au niveau du **projet**, indépendamment du dépôt Git configuré. Recherche par numéro ou texte du titre ; filtres combinables par type, état, assignation (moi, non assignés, tous ou une autre identité), tags, zone et itération. Les types personnalisés, états, chemins et noms des champs proviennent du projet. Les zones et itérations incluent leurs sous-chemins ; plusieurs tags séparés par `;` sont combinés avec ET. Les filtres appliqués sont conservés par organisation/projet dans le stockage privé, y compris après redémarrage ou changement de dépôt au sein du projet.

Les résultats arrivent par pages de **50**, en **numéro décroissant**. Le curseur est construit côté host ; le webview n’envoie jamais de WIQL. Il n’y a pas de total Azure inventé : l’écran indique les tickets chargés, les résultats encore disponibles et les tickets omis par Azure (droits ou suppression). Après **1 000 tickets chargés**, il faut préciser les filtres. La recherche porte sur les titres, pas sur la description ni sur les pièces jointes. Les résultats reflètent les données à chaque page ; une nouvelle recherche actualise l’ensemble.

Chaque ligne fournit deux actions : **Voir le détail** et **Préparer le développement**, remplacée par **Reprendre la session** lorsqu’un lien existe. Le détail charge la révision courante, description, critères, assignation, dates, champs utiles du type (dont les étapes de reproduction), commentaires datés et liens parent/enfants, PR et pièces jointes. Le HTML Azure Boards est converti en texte sûr. Les liens exécutables, non HTTPS ou contenant des identifiants ne deviennent pas des liens cliquables. Les données absentes, erreurs de commentaires et limites de lecture sont distinguées.

La préparation propose explicitement le **dépôt local cible** (projet actif proposé en premier), le titre modifiable, **worktree recommandé / dossier courant**, puis les consignes complémentaires. Le worktree part d’une branche locale ou d’une référence distante **déjà présente localement** ; aucun fetch implicite. La référence et son commit sont vérifiés à la création. Le nom proposé est `codex/ticket-<numéro>-<titre>`. En dossier courant, un changement de branche depuis la préparation impose un nouvel aperçu. Les changements non commités ne sont pas copiés dans un worktree.

Les commentaires sont sélectionnables, initialement sans sélection. L’**aperçu exact** montre le texte transmis aux agents, y compris les limites éventuelles et les consignes ajoutées. Le contenu des pièces jointes et des pages liées n’est pas téléchargé : seuls leurs liens sont inclus. Confirmer crée une **session sans équipe**, liée au ticket, puis ouvre sa fiche pour choisir les agents et lancer explicitement. Aucun appel IA et aucune modification d’état, d’assignation ou de commentaire Azure ne sont déclenchés.

Une copie datée et révisionnée du contexte effectivement importé est enregistrée avec la session (`ticketSource`) et reste consultable même si son besoin éditable évolue. Elle conserve l’identité du projet Azure source et du dépôt local cible. La création est idempotente ; une reprise retrouve la session et garantit sa sauvegarde avant ouverture, même après une erreur de lien ou de réponse. Les liens sont reconstruits depuis ces copies lorsque le projet cible est chargé après le contrôleur source.

Limites de lecture : **200 commentaires / 250 000 caractères**, **100 champs supplémentaires / 120 000 caractères**, **200 liens**, **180 000 caractères de contexte importé** avec indication de toute troncature. Les listes de métadonnées sont bornées à 100 types et 1 000 chemins par arborescence ; un chemin peut être saisi manuellement. Chaque réponse est limitée à 8 Mo et chaque requête à 20 secondes, sans suivre de redirection HTTP. Les tests de cette intégration utilisent des réponses simulées ; une recette sur un compte Azure réel reste distincte.

La liste PR Azure DevOps tronque la description à 400 caractères : le tableau montre un aperçu. Les votes documentés sont `10` (approuvé), `5` (avec suggestions), `0` (aucun vote), `-5` (attente de l’auteur), `-10` (rejeté) ; les valeurs inconnues restent inconnues. Ces avis et l’état de fusion ne prouvent pas que toutes les politiques de branche permettent la fusion. Le tableau ne vote, ne fusionne et n’active aucune auto-complétion.

## Un commit explicitement sélectionné

1. Inspecter les changements indexés, non indexés et nouveaux.
2. Sélectionner chaque fichier à livrer et donner l’intention du changement.
3. Éditer le titre proposé, actualiser l’aperçu et confirmer dans VS Code.

La sélection porte sur **le fichier complet dans son état de travail actuel**, même si seule une partie était indexée. Les autres fichiers indexés sont exclus du commit et leur état d’indexation est préservé. L’opération prépare deux index privés : le contenu du commit à partir de HEAD et l’index résultant avec le staging non sélectionné conservé. Elle réserve `index.lock`, vérifie l’empreinte, crée le commit puis met à jour la branche par comparaison atomique de l’ancien SHA. Aucune commande `reset`, `stash`, changement de branche ou `merge` n’est utilisée.

Les hooks, filtres externes et la signature Git ne sont pas exécutés par ce mode déterministe. Si un projet exige ces mécanismes, utiliser son processus de livraison dans le terminal. Un échec exceptionnel après mise à jour de HEAD mais avant remplacement de l’index est signalé explicitement ; le fichier `index.lock` reste disponible pour récupération et il ne faut pas relancer le commit.

L’empreinte couvre HEAD, branche, statut, contenu de l’index, contenus/modes des fichiers modifiés et destination du remote. Un changement impose un nouvel aperçu. Les fichiers spéciaux, conflits et sous-modules sont bloqués ; les chemins sortant du dépôt et les inventaires trop volumineux sont refusés. Limites : 2 000 fichiers inspectés, 200 sélectionnés, 8 Mo/fichier et 64 Mo au total ; les diff affichés sont tronqués à 100 000 caractères.

## Profil et conversation

Le profil `fs-delivery.agent.md` est fourni dans le catalogue Agents et peut être modifié comme les autres profils. La priorité des profils est celle du catalogue existant. Le bloc YAML `delivery-rules` est visible dans le corps éditable :

```delivery-rules
types: [feat, fix, docs, test, chore]
defaultType: chore
scope: ""
maxLength: 100
summary: mettre à jour les fichiers sélectionnés
```

`types` contient de 1 à 20 identifiants ; `defaultType` doit y appartenir. `scope` est vide ou alphanumérique avec tirets/soulignements (40 caractères). `maxLength` est entre 30 et 200. `summary` fournit le texte de repli. Les clés inconnues sont refusées. Le titre manuel doit également employer un type conventionnel autorisé. Une intention remplace `summary` ; les sélections de documentation/tests adoptent `docs`/`test` si permis.

Le mode est entièrement déterministe, sans appel IA. La prose reste une consigne de rédaction pour l’utilisateur ; elle n’autorise jamais Git ou le réseau. La conversation locale explique les opérations disponibles mais ne déclenche aucune mutation. L’historique conserve les 200 derniers messages.

## Push et PR

Le push et la PR ont chacun leur aperçu et leur confirmation hôte, sous la même réservation de mutation que les autres opérations Studio. Le push vise le SHA approuvé et la branche courante explicitement, sans force ni tags implicites. La PR est un brouillon Azure DevOps ; son aperçu vérifie que la branche source distante correspond exactement à HEAD et que la cible existe. Cette source est vérifiée à nouveau après confirmation. Aucune fusion ni auto-complétion n’est activée.

Une PR peut être liée à une feature avec ou sans ticket. Depuis chaque carte PR, choisir une session feature et éventuellement un ticket puis « Lier cette PR » ; cela fonctionne aussi pour les PR créées hors Studio et présentes dans le tableau. « Modifier le lien » remplace uniquement cette association ; « Retirer le lien PR » conserve le lien ticket/feature indépendant, les autres PR et les associations des autres projets. Ces opérations modifient uniquement le stockage local, sans modifier la PR Azure DevOps. Le badge « Brouillon » indique les PR encore en brouillon. Les liens sont persistés dans le stockage privé ; un ticket peut créer une feature ou retrouver celle déjà liée. Les liens sont accessibles depuis le tableau et depuis la feature. Les liens PR appartiennent au périmètre organisation/projet/dépôt. Les liens ticket appartiennent au projet Azure et conservent séparément le dépôt de développement cible.

## Contrat d’intégration

`DevOpsController` reçoit des adaptateurs `SecretStore`, `confirm`, `requestToken`, `guard`, `withMutation`, `getAgentInstructions`, `createFeature`, `ticketTargets`, `ensureFeatureSaved`, `openFeature`, `features` et `publish`. `guard` doit refuser les espaces non approuvés, la lecture seule et les opérations concurrentes. `withMutation` réserve synchroniquement la mutation commune de `StudioService`, puis vérifie de nouveau la confiance/les leases. Les messages webview utilisent `devOpsMessageVariants` (Zod strict). Le webview reçoit uniquement `DevOpsState` et émet `DevOpsClientMessage`. `devopsLinkPullRequest` valide la PR du tableau courant et la feature existante ; le ticket facultatif doit être dans le tableau courant. Une suppression ou un remplacement cible une association exacte dans le périmètre configuré. `dispose()` refuse les nouvelles opérations et attend les initialisations/actions déjà engagées avant la libération du service et de son lease, pour éviter toute sauvegarde tardive après réouverture.

## Références Microsoft vérifiées

- [WIQL — Query by WIQL, API 7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/wiql/query-by-wiql?view=azure-devops-rest-7.1)
- [Work Items — Get Work Items Batch, API 7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/get-work-items-batch?view=azure-devops-rest-7.1)
- [Fields — List, API 7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/fields/list?view=azure-devops-rest-7.1)
- [Comments — Get Comments, API 7.1-preview.4](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/comments/get-comments?view=azure-devops-rest-7.1)
- [Pull Requests — Get Pull Requests, API 7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-requests/get-pull-requests?view=azure-devops-rest-7.1)
- [Pull Requests — Create, API 7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-requests/create?view=azure-devops-rest-7.1)

- [Work Item Types — List, API 7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-item-types/list?view=azure-devops-rest-7.1)
