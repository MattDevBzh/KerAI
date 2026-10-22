# Parcours, validation et personnalisation

Feature Studio fournit trois parcours : `feature` (specs → plan → dev → tests → review), `code-review` (review seule) et `single` (un seul agent, une conversation, un livrable ; développement par défaut). Le mode manuel reste disponible. Le pilote est local, désactivé tant que vous ne le configurez et ne le démarrez pas.

## Apparence et enregistrement

Le thème choisi est enregistré automatiquement dans le profil personnel et appliqué dans tous les projets. Le bouton **Enregistrer les réglages du projet** concerne uniquement les paramètres du projet : il reste grisé quand seul le thème a changé.

Un thème explicite de Feature Studio garde ses couleurs, ses costumes et ses décors même si le thème VS Code se déclare à contraste élevé. **Suivre VS Code** retrouve la palette native, y compris son contraste élevé. Le mode de couleurs forcées du système reste prioritaire et indique clairement pourquoi le thème est temporairement masqué.

## Approbation de l’espace de travail

En consultation seule, le bandeau du cockpit et le bas des **Réglages** ou **Automatisations** proposent **Gérer l’approbation dans VS Code**. Ce bouton ouvre l’écran de confiance natif ; il ne donne aucune autorisation à votre place. Le cockpit reçoit la décision de VS Code et actualise son état.

Les modifications du formulaire restent affichées pendant cette étape. Après approbation, cliquez sur **Enregistrer les réglages du projet**. Un projet déjà approuvé l’indique explicitement. L’ajout ou la modification de commandes de test, de hooks actifs ou de connexions MCP actives conserve sa confirmation avant enregistrement.

## Quêtes et récompenses

Dans **Quêtes**, la carte **Prochain cadeau** montre uniquement la prochaine récompense : petite illustration, nombre de trophées encore nécessaires et jauge entre le dernier palier et le suivant. Les cadeaux ultérieurs restent cachés, y compris dans le choix des thèmes. Les trophées déjà obtenus comptent immédiatement et ne sont jamais dépensés.

| Trophées cumulés | Récompense                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| 5                | **Noob**, un thème de premier atelier : papier quadrillé, post-it, ruban adhésif et gribouillis |
| 20               | Titre **Architecte du dimanche**                                                                |
| 40               | Célébration **Feu d’artifice devant la tour Eiffel**                                            |
| 70               | Thème **Matrix**, noir et vert avec pluie de code                                               |
| 110              | Titre **Dresseur d’agents**                                                                     |
| 200              | Mascotte **Chaton**, qui marche, se pose et dort dans le QG                                     |

Un nouveau déblocage propose **Activer** ou **Plus tard**. Tous les cadeaux obtenus restent dans **Mes récompenses**, où ils peuvent être activés ou désactivés. Un seul titre et un seul thème sont choisis à la fois. Les thèmes gagnés deviennent également disponibles dans les réglages. Atteindre 200 affiche la collection complète et un message de parcours terminé.

Le titre apparaît dans l’en-tête. Le chaton nécessite la vue **QG vivant** d’une session et se déplace dans une bande réservée au pied des postes. Le feu d’artifice utilise les commandes de célébration existantes : validation finale réussie ou relecture explicite, avec la case de célébration activée. Réouvrir une session terminée ne le rejoue pas automatiquement. Les animations réduites conservent une présentation statique ; les couleurs forcées du système masquent les effets décoratifs.

Ces choix personnels sont partagés entre projets. Le registre de trophées `quests.json` reste la seule source de déblocage ; `rewards.json` conserve les choix de titre, célébration et mascotte dans le stockage personnel du cockpit. Le thème utilise le réglage VS Code existant. Une écriture refusée conserve le dernier choix confirmé et affiche une erreur. Activer une récompense ne lance pas d’agent et ne modifie pas une session.

## Étapes et historique

### Le thème secret Dragon Ball

Depuis **Dashboard** ou sa **Tour de contrôle** détachée, clique dans le contenu puis saisis **↑ ↑ ↓ ↓ ← → ← →** avec les flèches du clavier. Une pause de plus de quatre secondes entre deux touches, une autre touche ou un changement de page interrompt la combinaison. Les touches maintenues ne comptent qu’une fois ; les champs de saisie, listes et fenêtres de dialogue ignorent le code.

La découverte est enregistrée dans le profil personnel VS Code avant l’activation. Une apparition de Shenron confirme **Dragon Ball est débloqué et activé**. Ferme-la avec **Entrer dans le dojo**, la croix ou Échap. Le thème conserve ensuite sa place dans **Réglages → L’ambiance du cockpit**, même si tu choisis un autre univers. Il ne dépend d’aucun palier de trophées et n’ajoute pas de septième cadeau à la jauge des quêtes.

Le cockpit prend une palette bleu nuit, orange et cyan ; le Dashboard accueille le dojo, le QG sa terrasse Capsule Corp et les vingt personnages leurs costumes Dragon Ball. Les poses suivent les états réels : repos, travail avec aura de ki et réussite avec boule de cristal. Les identités, profils, équipes et comptes rendus restent conservés. Les couleurs forcées du système utilisent les portraits habituels ; la réduction des animations garde les poses statiques. La [provenance des cinq visuels et leurs prompts](../design/dragonball/PROMPTS.md) est conservée dans le dépôt.

### Bande des agents ou QG vivant

Dans l’écran d’une session, la case **Afficher le QG vivant**, à côté de **LE PARCOURS**, remplace uniquement la bande des agents par un atelier. Chaque poste correspond à une intervention du parcours : un même agent peut avoir plusieurs postes. Clique sur un poste pour sélectionner son étape ; le compte rendu, les fichiers, les preuves et les commandes restent dans le panneau de détail en dessous. Décoche la case pour retrouver la bande classique, avec la même étape sélectionnée.

La vue suit les états enregistrés : au travail, attente de réponse, à valider, validée, à venir, passage facultatif non exécuté, échec, annulation, interruption ou étape à actualiser. Une question interactive arrête l’animation de travail jusqu’à sa résolution. Dans une archive, le dernier état est présenté sans animation de travail. Cliquer sur un poste n’exécute ni ne valide l’agent. Un brouillon en cours empêche de changer d’étape ; basculer entre les deux vues conserve ce brouillon.

Le choix est enregistré dans les réglages personnels de VS Code (`featureStudio.appearance.livingHq`), partagé par toutes les sessions et tous les projets, et désactivé par défaut. En cas d’échec de sauvegarde, la préférence confirmée est rétablie et le motif s’affiche près de la case. Le Dashboard et la Tour de contrôle gardent leur présentation habituelle.

Le QG suit automatiquement le thème choisi dans **Réglages → L’ambiance du cockpit** : jardin et bois, atelier papier crème, salle de guilde indigo ou atelier Halloween. Les modes clairs et sombres adaptent la lumière, les plans de travail et les lampes ; **Suivre VS Code** utilise un atelier neutre accordé aux couleurs de l’éditeur. Aucun réglage supplémentaire n’est nécessaire. Le changement conserve l’étape sélectionnée et les brouillons.

Le QG réutilise les vingt avatars, leurs costumes et leurs images de repos, travail et réussite. Les quatre décors sont partagés par toute l’équipe : aucune variante supplémentaire des avatars n’est générée. Il respecte les animations réduites et les couleurs forcées du système, qui masquent le décor. La [provenance du décor original](../design/qg/PROMPT.md) et les [prompts des déclinaisons](../design/qg/THEMES.md) sont conservés dans le dépôt.

### Déroulement du parcours

Une dépendance doit être approuvée ou explicitement passée avant son étape suivante. Un passage facultatif satisfait l’ordre du parcours sans constituer une approbation ou une preuve. Chaque run ou reprise crée une tentative et respecte le maximum de l'étape. La reprise peut conserver la session CLI ; retour humain, réponses et livrable précédent sont transmis au nouveau run. Les anciennes tentatives restent consultables.

Les questions finales placent l'étape en `waiting_input`. Enregistrer les réponses ne termine pas le travail : lancez une reprise pour que l'agent complète son livrable. Les questions interactives via `studio_ask_human` attendent la réponse pendant la tentative ; cette interaction suspend la progression du pilote. Les questions et réponses réellement échangées sont conservées avec le résultat. Le délai maximal de la tentative continue pendant cette attente humaine.

Relancer une étape rend ses dépendants transitifs déjà tentés `stale` et remet les interventions facultatives non tentées à `pending`, sans effacer leurs résultats ou décisions historiques. Les branches indépendantes restent valides. Modifier un livrable approuvé demande une nouvelle validation. Modifier agent, modèle, effort, skills, contexte initial ou MCP après une tentative invalide aussi l'étape et ses descendants. Modifier seulement le maximum de tentatives ou `askBeforeRun` conserve les livrables.

Le maximum d'une étape est compris entre 1 et 100 et ne peut descendre sous son historique enregistré. Les configurations et livrables ne se modifient pas pendant la tentative concernée ; le pilote doit être en pause avant une action manuelle concurrente. Échec, annulation et interruption conservent leurs états réels.

## Participation facultative

Le champ `optional` appartient à l’intervention ; absent ou faux, elle reste obligatoire. Il est modifiable dans les parcours et dans la composition de la feature jusqu’à la première décision ou exécution. La feature garde sa propre copie du modèle.

Une intervention facultative disponible et jamais tentée peut être **Passée** manuellement, sans démarrer le pilote. En automatique, le pilote s’arrête avant cette intervention, persiste sa demande et propose de l’exécuter, de la passer ou de décider plus tard. Une fermeture de notification ou un redémarrage ne répond pas à la place de l’humain. Le centre de validation retrouve ces décisions en attente.

Une intervention passée ne possède ni tentative ni livrable. La suite reçoit cette information explicitement et les bilans ne la comptent pas comme validée. Les erreurs, annulations ou interruptions déjà enregistrées ne peuvent pas être transformées en passage. Les choix invalidés restent dans l’historique ; une intervention passée choisie comme racine de correction redevient disponible.

## Corriger un compte rendu et le besoin

**Modifier le compte rendu** ouvre l’édition avec aperçu, original de l’agent et historique des versions. Le besoin initial peut être corrigé dans le même écran. Une raison facultative explique le changement aux agents suivants. **Enregistrer et valider** conserve la version humaine puis applique les contrôles habituels ; **Faire réviser par l’agent** prépare une correction à partir de cette étape.

Chaque version conserve son auteur et sa date. Restaurer une ancienne version prépare une nouvelle révision, sans effacer l’historique. La sauvegarde est liée à la tentative, à sa révision et à l’état de session relus : si le travail change entre-temps, elle est refusée et le brouillon reste disponible. Les verdicts structurés et les preuves de tests ne se modifient pas avec le texte.

Un compte rendu modifié remet ses dépendants à actualiser. Un besoin modifié remet conservativement le parcours à revoir. Le prochain appel utilise une nouvelle conversation pour éviter de reprendre les anciennes décisions. Les étapes suivantes reçoivent la version actuellement approuvée, avec la provenance de la correction.

## Demander une correction ciblée

Depuis un compte rendu ou une remarque, **Demander une correction** ouvre le choix du point de départ et du retour humain. L’aperçu montre l’équipe à rejouer, les branches conservées et le contexte transmis. Le choix avancé permet plusieurs étapes de départ ; leurs dépendants communs ne sont exécutés qu’une fois par passage. La route doit repasser par l’étape de relecture d’origine.

Le cycle conserve un instantané du besoin, des rapports et des remarques sélectionnées. Les anciens rapports servent à comprendre le problème et ne constituent pas une validation du travail corrigé. Les documents approuvés produits pendant le cycle deviennent le contexte courant des étapes suivantes. Les remarques restent ouvertes jusqu’à leur résolution explicite.

La correction utilise le même moteur que les exécutions ordinaires et respecte les checkpoints, confirmations avant lancement, permissions, preuves et budgets. Elle enchaîne jusqu’au retour en relecture lorsque ces contrôles le permettent. Les questions, échecs, interruptions ou limites suspendent l’exécution ; aucune reprise automatique n’est lancée après un redémarrage.

## Décision finale

Une fois toutes les interventions approuvées ou explicitement passées et les blocages résolus, la session attend une **validation finale**. Deux actions sont proposées : **Valider définitivement** ou **Faire une correction**. Le pilote attend cette décision humaine ; l’approbation de la dernière étape ne termine pas à elle seule la session.

La validation finale porte sur la version relue et revérifie les preuves contre les fichiers réels. Si les comptes rendus, critères, remarques ou fichiers ont changé, elle est refusée ou doit être refaite. Le clic réussi termine la session et déclenche la célébration avec l’équipe. La célébration peut être rejouée explicitement ; les effets peuvent être désactivés et respectent la réduction des mouvements. Les anciennes sessions sans validation finale explicite attendent cette décision lorsqu’elles sont rouvertes.

## Lancement manuel et mémoire choisie

Le panneau de lancement permet de fournir votre demande ou US, un retour de correction et les MCP nécessaires. Préparez l'aperçu pour relire les instructions réellement assemblées par le host. Changer ces données exige un nouvel aperçu ; un ancien fingerprint ne peut autoriser un contexte différent.

La mémoire est une collection locale de conventions, décisions, éléments d'architecture et contexte. Une note peut être saisie manuellement ou préparée à partir du texte d'un livrable approuvé, puis relue et enregistrée. Aucun résumé ou appel IA supplémentaire n'est lancé. Une note issue d'une tentative doit encore référencer la dernière version actuellement approuvée pour être utilisée.

L'injection exige **les trois conditions** : `useProjectMemory=true`, identifiant présent dans `memoryIds`, note `enabled=true`. La note doit également concerner l'agent choisi, ou tous les agents si `agentIds` est vide. `memoryIds=[]` injecte zéro note. Le lancement manuel repart sans inclusion de mémoire par défaut. Un dépassement de **4 000 caractères pour les sections mémoire assemblées, en-têtes compris**, bloque le lancement ; aucune troncature ni synthèse automatique n'est appliquée. L'instantané des notes effectivement utilisées est conservé dans la tentative.

## Pilote automatique

Configurez les checkpoints, contextes de chaque étape, nombre maximal de runs et nombre maximal de cycles de correction. Dans l'éditeur, la proposition initiale place les checkpoints sur plan et review lorsqu'ils existent, sinon sur la dernière étape. Elle limite les runs au nombre d'étapes et n'autorise aucun cycle de correction. Enregistrer cette configuration ne lance rien. Le démarrage demande ensuite une action explicite.

Le pilote utilise le même moteur, les mêmes profils et le même budget que les runs manuels. Il exécute une seule tentative à la fois, puis décide localement de l'action suivante. Les dépendances doivent toujours être approuvées. Hors checkpoint, une étape peut être approuvée automatiquement si les conditions de validation sont réunies.

Les checkpoints sont des arrêts **après** production du livrable et passent avant toute correction automatique. Un checkpoint sur review ou tests suspend donc aussi un résultat demandant des corrections. Pour autoriser la boucle automatique sur ce résultat, retirez explicitement ce checkpoint. `askBeforeRun=true` ajoute un arrêt **avant** lancement, y compris sur la cible d'une correction ; lancez cette étape manuellement avec son contexte ou modifiez ce réglage après mise en pause.

La boucle exige une étape de relecture et une étape de correction située en amont. Elle se déclenche uniquement sur une preuve hôte de tests terminés avec code non nul, ou sur un rapport structuré `changes_requested` de l'étape de relecture configurée. Une phrase libre mentionnant un bug ne déclenche pas la boucle. Un rapport structuré absent interdit l'approbation automatique de la relecture configurée, de l'étape `review` du parcours `feature` et du parcours `code-review`, même sans boucle de correction. Le retour de correction est construit depuis les preuves ou constats disponibles, sans appel IA supplémentaire pour décider.

Chaque correction relance la cible et invalide ses descendants. Le nombre de cycles est borné de 0 à 20 ; le plafond de runs du pilote est de 1 à 1 000, et les limites par étape restent applicables. Les compteurs du pilote suivent ses exécutions automatiques ; le budget feature compte aussi les tentatives manuelles.

Question, permission MCP humaine, erreur, annulation, interruption, limite atteinte, preuve absente/obsolète ou confirmation requise suspend la progression. « Demander la pause » laisse la tentative en cours terminer ; l'arrêt d'exécution l'annule. Une réponse interactive ne réactive pas le pilote : reprenez-le explicitement après l'échange.

Après redémarrage, le pilote reste en pause et le CLI doit être revérifié. Une tentative `failed`, `cancelled` ou `interrupted` exige une reprise manuelle de l'étape avant de repartir en automatique. L'application ne relance pas une erreur au seul clic de démarrage du pilote. Pour préparer la décision finale, toutes les interventions doivent être approuvées ou explicitement passées, les critères présents doivent être satisfaits avec une preuve renseignée et aucun commentaire bloquant ne doit rester ouvert. **Valider définitivement** reste une action humaine séparée.

## Centre de validation et preuves

La validation exige livrable non vide, aucune question ouverte, dépendances approuvées et absence de blocage. La demande d'approbation référence l'identifiant et la révision de la tentative lue. Un livrable, une preuve, un critère ou un commentaire changé depuis cette lecture rend cette approbation obsolète.

Une exécution `studio_run_test` conserve une preuve produite par le host : commande et arguments configurés, dates, code de sortie ou erreur, sorties bornées/tronquées et empreintes des fichiers observés. L'historique reste complet ; pour une même commande, la dernière preuve de la tentative détermine le résultat courant. Une preuve en échec, incomplète ou antérieure à une modification des fichiers bloque la validation. Le host revérifie les empreintes du parcours concerné contre le workspace lors de l'approbation.

Le profil tests ordinaire exige au moins une vraie preuve hôte réussie pour une approbation automatique. Une validation humaine sans cette preuve reste possible si aucun autre blocage n’existe ; elle n’invente pas un test exécuté. Pour une étape avec `requiredQuality: visual` ou `requiredQuality: counterexample`, un rapport du type demandé est obligatoire pour les validations humaine **et** automatique. Les agents `fs-visual-tests` et `fs-counterexamples` gardent cette exigence même dans un parcours personnalisé. Si le contrat explicite demande un autre type que celui de l’agent, les deux rapports sont requis. Le choix apparaît dans l’éditeur de parcours sous **Rapport qualité requis**. Une simple commande réussie sans collecte qualité ne suffit pas. Le rapport doit être réussi, courant et lié à la même feature, tentative, commande et preuve hôte ; ses références de critères doivent appartenir aux critères de la feature. Une relecture automatique `review` dans `quality-feature` exige aussi le rapport structuré de review. Le rapport de review distingue `pass` et `changes_requested`, avec constats `info`, `warning` ou `blocking`. Les constats de l'agent restent des constats, pas des preuves d'exécution.

Les critères sont saisis et évalués par l'humain : `pending`, `passed` ou `failed`, avec texte de preuve. Tous les critères présents sont requis pour la validation finale. Les commentaires peuvent être bloquants, associés à une tentative et éventuellement à un fichier/une ligne ; ils restent ouverts jusqu'à résolution explicite. Modifier ces critères ou commentaires après complétion oblige à refaire la validation finale ; résoudre les blocages prépare cette décision sans terminer automatiquement la session.

## Consommation et profils de modèles

Le budget par défaut est **10 runs** et **60 000 caractères de prompt**, profil `current`. Des plafonds facultatifs portent sur les tokens mesurés et les nano-AIU. Les agrégats incluent tentatives réussies, échouées, annulées ou interrompues. Les mesures sont enregistrées pendant l'exécution ; une donnée absente ou une séquence de mesures partielle reste inconnue, jamais zéro. Les sommes déjà observées sont conservées, sans être présentées comme un total complet. Si le plafond choisi dépend d'une donnée inconnue, le prochain run est bloqué jusqu'à ajustement explicite du budget.

Les limites s'appliquent avant un nouvel appel. Une approbation ou complétion sans nouvel appel reste possible quand le budget de runs est atteint. Elles ne constituent pas une promesse de coût maximal pour l'appel en cours. Les nano-AIU ne sont pas convertis en monnaie ; les tokens estimés de l'aperçu ne sont pas ajoutés aux mesures réelles.

Les profils `economy`, `balanced` et `quality` nécessitent votre correspondance explicite vers un modèle proposé par le CLI et éventuellement un effort. Ils n'incorporent aucun classement de prix supposé. `current` conserve la résolution étape → agent → réglage par défaut → CLI ; les modèles embarqués sont laissés vides.

## Mes équipes et catalogue

**Mes équipes** utilise le même compositeur que les features : cartes avec avatars, catalogue filtrable d’agents et d’équipes, ajout et déplacement par glisser-déposer ou boutons. La création et la modification permettent de régler le nom et la description de l’équipe ainsi que ses interventions et sous-plans. Les réglages des cartes permettent de choisir l’agent, le modèle, la réflexion, les dépendances et la participation. Les autres paramètres hérités des profils restent conservés. L'enregistrement passe par le host et produit un YAML au niveau utilisateur dans `~/.copilot/feature-studio/workflows/<id>.yaml` (ou sous `COPILOT_HOME` si configuré). Le document suit le même validateur strict qu'un fichier édité à la main : étapes uniques, dépendances existantes, absence de cycle, agents et skills disponibles, valeurs et livrables valides. Les anciens YAML dans `.feature-studio/workflows` restent lisibles et prioritaires tant qu’ils n’ont pas été déplacés manuellement. Aucun fichier du projet n’est déplacé ou supprimé automatiquement. Les sessions existantes conservent leur copie ; modifier un template ne réécrit ni leurs étapes ni leurs historiques.

```yaml
id: custom-review
name: Relecture ciblée
description: Un rapport indépendant avec confirmation de départ
icon: scan-eye
steps:
  - id: review
    name: Relecture
    description: Relire le diff et les critères fournis
    agentId: fs-review
    policy: read-only
    model: ''
    skills: [ai-relecture]
    maxAttempts: 3
    artifact: review.md
    dependsOn: []
    initialContext: 'Critères et fichiers ciblés à préciser'
    mcpServerIds: []
    askBeforeRun: true
```

Les agents résident dans `.github/agents/*.agent.md`, les skills dans `.github/skills/<id>/SKILL.md`. Sans `name`, un agent officiel prend l'identifiant de son fichier ; sans `tools`, il reçoit `read`, `search`, `edit`, sans exécution. Les profils du host limitent encore ces droits. `model` doit être une chaîne unique ; les tableaux YAML sont signalés et ignorés. Pseudo et avatar peuvent être choisis sans changer l'identifiant stable de l'agent.

`read-only`, `workspace-write` et `tests` sont les trois profils. `fs-tests` déclare explicitement `execute` pour `studio_run_test`, uniquement pour les commandes configurées et le profil tests. Aucun shell générique n'est exposé. Les dossiers de tests initiaux sont `tests`, `test`, `__tests__`; aucune commande de tests ni commande .NET n'est activée par défaut. Hooks et MCP exigent une configuration explicite ; voir [les connexions MCP](MCP.md) pour leurs permissions et secrets.

L'installation du kit crée seulement les fichiers absents, conserve les fichiers identiques et signale les différences comme conflits. `.ai/project.md` existant est préservé. Les chemins et symlinks sont contrôlés. La provenance et les empreintes de la copie utilisateur sont dans `defaults/PROVENANCE.md` et `defaults/kit-sha256.json`. La persistance privée, la migration v2 et la récupération sont décrites dans [Architecture](ARCHITECTURE.md).
