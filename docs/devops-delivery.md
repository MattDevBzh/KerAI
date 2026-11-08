# Azure DevOps et livraison

Les menus **Azure DevOps** et **Livraison** s’ouvrent sans feature ni session active. Sans session sélectionnée, le checkout du projet actif est la cible Git. Depuis **Préparer la PR**, la cible est le dossier de la session, y compris son worktree isolé ; ce choix est conservé après redémarrage. Un HEAD détaché ou un dépôt sans premier commit demande d’abord une intervention Git manuelle. Ouvrir la racine du dépôt, pas un sous-dossier.

## Configuration depuis le menu

Renseigner organisation, projet, dépôt et remote Git. Un remote `origin` Azure DevOps HTTPS ou SSH est détecté au premier lancement, sans présumer que le dépôt utilise Azure DevOps. Le tableau conserve la configuration et les liens dans `devops.json` du stockage privé VS Code. Un jeton personnel est saisi exclusivement dans une fenêtre hôte masquée, puis conservé avec `SecretStorage`. Aucun secret n’est envoyé au webview, aux paramètres ou au journal. Droits nécessaires : Work Items en lecture, Code en lecture/écriture pour les PR et Identity en lecture pour rechercher les relecteurs. Le push utilise les identifiants Git déjà configurés sur la machine.

L’aperçu du menu **Azure DevOps** conserve les 200 tickets assignés au compte authentifié et les 200 PR créées par celui-ci. Le sous-menu **PR** ajoute recherche locale, filtres par état/lien et tri sur ces PR reçues. Les compteurs restent inconnus avant le premier chargement ; une erreur conserve les données précédentes et leur date. La recherche complète de tickets dispose de son écran **Tickets**, dans le même groupe de navigation **DevOps**.

## Chercher un ticket et préparer son développement

L’écran **Tickets** interroge Azure DevOps au niveau du **projet**, indépendamment du dépôt Git configuré. Recherche par numéro ou texte du titre ; filtres combinables par type, état, assignation (moi, non assignés, tous ou une autre identité), tags, zone et itération. Les types personnalisés, états, chemins et noms des champs proviennent du projet. Les zones et itérations incluent leurs sous-chemins ; plusieurs tags séparés par `;` sont combinés avec ET. Les filtres appliqués sont conservés par organisation/projet dans le stockage privé, y compris après redémarrage ou changement de dépôt au sein du projet.

Les résultats arrivent par pages de **50**, en **numéro décroissant**. Le curseur est construit côté host ; le webview n’envoie jamais de WIQL. Il n’y a pas de total Azure inventé : l’écran indique les tickets chargés, les résultats encore disponibles et les tickets omis par Azure (droits ou suppression). Après **1 000 tickets chargés**, il faut préciser les filtres. La recherche porte sur les titres, pas sur la description ni sur les pièces jointes. Les résultats reflètent les données à chaque page ; une nouvelle recherche actualise l’ensemble.

Chaque ligne fournit deux actions : **Voir le détail** et **Préparer le développement**, remplacée par **Reprendre la session** lorsqu’un lien existe. Le détail charge la révision courante, description, critères, assignation, dates, champs utiles du type (dont les étapes de reproduction), commentaires datés et liens parent/enfants, PR et pièces jointes. Le HTML Azure Boards est converti en texte sûr. Les liens exécutables, non HTTPS ou contenant des identifiants ne deviennent pas des liens cliquables. Les données absentes, erreurs de commentaires et limites de lecture sont distinguées.

La préparation propose explicitement le **dépôt local cible** (projet actif proposé en premier), le titre modifiable, **worktree recommandé / dossier courant**, puis les consignes complémentaires. La préparation Git commune actualise les références distantes par fetch avant le choix de la base. En cas d’échec, utiliser la dernière référence connue exige un choix explicite. La référence et son commit sont vérifiés à la création. Le nom proposé est `codex/ticket-<numéro>-<titre>`. En dossier courant, un changement de branche depuis la préparation impose un nouvel aperçu. Les changements non commités ne sont pas copiés dans un worktree.

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

Le commit et la conversation locale sont entièrement déterministes, sans appel IA. La rédaction de PR utilise séparément l’agent choisi dans les réglages du dépôt. La prose reste une consigne de rédaction pour l’utilisateur ; elle n’autorise jamais Git ou le réseau. La conversation locale explique les opérations disponibles mais ne déclenche aucune mutation. L’historique conserve les 200 derniers messages.

## Préparer la PR depuis une session

Lorsque toutes les étapes sont résolues, **Préparer la PR** ouvre cet écran sur la branche et l’espace de la session. Pour plusieurs projets, choisir le dépôt concerné. Le dossier principal peut garder des changements indépendants. Une branche différente de celle enregistrée dans la session bloque la livraison ; reprendre alors dans l’outil Git.

Les **Réglages de PR pour ce dépôt** conservent l’agent dédié, la branche cible par défaut, les consignes ou le modèle de description, le statut brouillon et les relecteurs habituels. Le périmètre est l’organisation, le projet et le dépôt Azure configurés, dans le projet local. Le profil fourni `fs-devops-pr` peut être personnalisé ; tout profil du catalogue peut être choisi. Le modèle et le niveau de raisonnement viennent du profil ou des réglages du projet. Modifier les valeurs par défaut ne remplace pas un brouillon déjà saisi.

À la première ouverture d’un brouillon vide, la rédaction démarre quand le code est commité, le compte connecté et l’agent disponible. Le commit cible est récupéré si nécessaire, sans déplacer une branche locale. La rédaction peut précéder le push, mais la création exige que le commit courant soit publié dans le dépôt Azure configuré. Les fichiers non commités de la session doivent être traités avec les étapes commit/push de cet écran ou dans l’outil Git.

L’agent reçoit le diff commité par rapport au point commun avec la cible, les preuves et le compte rendu de la session. Il doit distinguer les exécutions observées des déclarations et des limites. La comparaison est bornée à 400 fichiers et 100 000 caractères, avec exclusion des chemins sensibles et masquage des secrets reconnus ; les omissions sont signalées. L’appel utilise un mode de rédaction sans outils, shell, MCP ni hooks et consomme les crédits du fournisseur configuré. **Arrêter la rédaction** interrompt l’appel. Le modèle utilisé reste affiché avec la proposition.

Une réponse invalide ou une modification de code pendant la génération conserve le brouillon. Si le texte n’a pas été modifié pendant l’appel, la proposition le remplit automatiquement ; sinon elle apparaît séparément et son remplacement exige une action explicite. Les brouillons sont conservés par dépôt et session dans l’état de la fenêtre. Relire le texte et le diff avant de créer : les tests ne garantissent pas la justesse d’un texte produit par un modèle réel.

Le formulaire permet d’ajuster la cible, le titre, la description, le ticket lié, les relecteurs trouvés dans Azure et leur caractère obligatoire, ainsi que le statut brouillon/prêt à relire. Le titre et la description restent entièrement éditables. L’ajout d’un relecteur ne contourne aucune politique de branche Azure.

## Push et PR

Le push et la PR ont chacun leur aperçu et leur confirmation hôte, sous la même réservation de mutation que les autres opérations Studio. Le push vise le SHA approuvé et la branche courante explicitement, sans force ni tags implicites. La PR est un brouillon Azure DevOps par défaut, avec un choix explicite pour la rendre prête à relire ; son aperçu vérifie que la branche source distante correspond exactement à HEAD et que la cible existe. La source, la cible et l’absence d’une PR ouverte pour ces mêmes branches sont vérifiées à nouveau après confirmation. Une réponse de création perdue entraîne une recherche de la PR existante avant de permettre un nouvel essai. Aucune fusion ni auto-complétion n’est activée.

Une PR peut être liée à une feature avec ou sans ticket. Depuis chaque carte PR, choisir une session feature et éventuellement un ticket puis « Lier cette PR » ; cela fonctionne aussi pour les PR créées hors Studio et présentes dans le tableau. « Modifier le lien » remplace uniquement cette association ; « Retirer le lien PR » conserve le lien ticket/feature indépendant, les autres PR et les associations des autres projets. Ces opérations modifient uniquement le stockage local, sans modifier la PR Azure DevOps. Le badge « Brouillon » indique les PR encore en brouillon. Les liens sont persistés dans le stockage privé ; un ticket peut créer une feature ou retrouver celle déjà liée. Les liens sont accessibles depuis le tableau et depuis la feature. Les liens PR appartiennent au périmètre organisation/projet/dépôt. Les liens ticket appartiennent au projet Azure et conservent séparément le dépôt de développement cible.

## Contrat d’intégration

`DevOpsController` reçoit des adaptateurs `SecretStore`, `confirm`, `requestToken`, `guard`, `withMutation`, `withSessionMutation`, `resolveDeliverySession`, `generatePr`, `getAgentInstructions`, `createFeature`, `ticketTargets`, `ensureFeatureSaved`, `openFeature`, `features` et `publish`. `guard` doit refuser les espaces non approuvés, la lecture seule et les opérations concurrentes. `withMutation` réserve synchroniquement la mutation commune de `StudioService`, puis vérifie de nouveau la confiance/les leases. Les messages webview utilisent `devOpsMessageVariants` (Zod strict). Le webview reçoit uniquement `DevOpsState` et émet `DevOpsClientMessage`. `devopsLinkPullRequest` valide la PR du tableau courant et la feature existante ; le ticket facultatif doit être dans le tableau courant. Une suppression ou un remplacement cible une association exacte dans le périmètre configuré. `dispose()` annule une rédaction en cours et refuse les nouvelles opérations et attend les initialisations/actions déjà engagées avant la libération du service et de son lease, pour éviter toute sauvegarde tardive après réouverture.

## Références Microsoft vérifiées

- [WIQL — Query by WIQL, API 7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/wiql/query-by-wiql?view=azure-devops-rest-7.1)
- [Work Items — Get Work Items Batch, API 7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/get-work-items-batch?view=azure-devops-rest-7.1)
- [Fields — List, API 7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/fields/list?view=azure-devops-rest-7.1)
- [Comments — Get Comments, API 7.1-preview.4](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/comments/get-comments?view=azure-devops-rest-7.1)
- [Pull Requests — Get Pull Requests, API 7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-requests/get-pull-requests?view=azure-devops-rest-7.1)
- [Pull Requests — Create, API 7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-requests/create?view=azure-devops-rest-7.1)

- [Work Item Types — List, API 7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-item-types/list?view=azure-devops-rest-7.1)

- [Identities — Read Identities, API 7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/ims/identities/read-identities?view=azure-devops-rest-7.1)

## Agent d’accompagnement de PR par session

Dans la livraison ouverte depuis une session, ouvre **Intervenir sur une PR avec un agent**. Sélectionne ton profil (Pull Request Administrator est fourni), saisis la mission et colle les règles avec leurs identifiants et leurs références. Les réglages sont conservés pour cette session, dans le dépôt Azure configuré. Le modèle et les instructions du profil choisi sont utilisés ; les outils d’écriture, shell et MCP ne lui sont pas donnés.

Active les propositions souhaitées : commentaires, titre, description. Sélectionne le statut des nouveaux fils : **By design** convient à une explication de comportement intentionnel ; **Won’t fix** reste disponible lorsque c’est ta convention. Enregistre la mission, renseigne le numéro de PR si nécessaire et lance **Préparer les interventions**. La préparation est explicite, consomme les crédits du fournisseur et peut être arrêtée.

L’agent reçoit les blocs du diff publié, identifiés et positionnés par KerAI, les règles et les preuves de la session. Chaque proposition expose le fichier, les lignes avant/après et le code concerné. Les règles non fournies, les blocs inventés et les actions non autorisées sont refusés. Le nombre de blocs sans annotation ne mesure pas la conformité du code. Relis et corrige les textes, coche les propositions à publier, puis confirme la sélection complète.

Les fils créés sont suivis localement par session et par PR. Une relance reconnaît une annotation identique et peut mettre à jour son propre texte si personne n’a repris le fil. KerAI ne modifie pas un commentaire humain, ne répond pas automatiquement aux humains et ne réinitialise pas le statut d’un fil existant. Une réponse, un changement de texte/statut ou un déplacement ambigu impose une intervention manuelle.

Les commits source/cible, la base commune, l’itération et les champs sont revérifiés après rédaction et avant les écritures. Les PR de forks, d’une autre branche ou inactives sont refusées. Les publications se font une à une : un échec ou un changement concurrent arrête la suite sans annuler les opérations réussies. Un ajout dont le résultat reste incertain n’est pas réémis ; vérifie la PR dans Azure. Le suivi local doit être conservé pour reconnaître les annotations lors des prochaines interventions.

Limites : 400 fichiers, 100 blocs textuels, 100 000 caractères, 50 propositions ; chemins sensibles et renommages exclus avec avertissement, description modifiée limitée à 4 000 caractères. Une annotation explicative ne vaut pas audit de sécurité. Les permissions Azure doivent autoriser la modification de PR et les discussions. Les tests automatisés emploient Azure et un agent simulés ; la recette du modèle et des droits réels reste à effectuer sur ton projet.

### Ajouter le contexte de la session

Dans la mission de PR, **Ajouter du contexte depuis la session → Charger les sources de la session** propose les textes conservés dans cette session et ses sous-tâches : besoin, documents importés dans le besoin ou le contexte de lancement, comptes rendus (y compris versions historiques), échanges humains et réponses, consignes épinglées ou chargées, mémoires transmises, questions/réponses et retours humains. Le résumé automatique reste visible séparément.

Recherche une règle ou un passage, filtre par type de source, ouvre le texte et coche les éléments utiles. Les sources ne sont pas sélectionnées automatiquement. Les textes longs sont découpés en parties de 12 000 caractères maximum ; tu peux choisir les parties pertinentes. La limite de sélection est de 40 éléments et 80 000 caractères, en plus du résumé automatique et du diff. Le catalogue est limité à 500 éléments et 2 millions de caractères avec un avertissement explicite s’il est partiel.

Enregistre la mission : les références choisies restent liées à la session. L’aperçu des interventions montre aussi le texte exact transmis à l’agent. Si une source change ou disparaît, actualise les sources et relis la nouvelle version avant de la sélectionner ; aucune nouvelle version n’est adoptée à ta place. La génération et la publication revérifient ce contexte. Une source d’une autre session ne peut pas être substituée à la sélection.

Les documents proposés sont leurs textes déjà importés, avec leurs références et limites d’extraction ; l’agent ne relit pas les fichiers originaux sur disque. Les images, pièces jointes binaires et journaux techniques ne sont pas inclus dans cette sélection. Les secrets reconnus par le masquage habituel sont retirés des textes affichés et transmis. Les sources historiques restent identifiées comme telles et ne prouvent pas l’état actuel du code.
