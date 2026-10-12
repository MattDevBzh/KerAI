# Parcours, validation et personnalisation — v0.2

Feature Studio fournit trois parcours : `feature` (specs → plan → dev → tests → review), `code-review` (review seule) et `single` (un seul agent, une conversation, un livrable ; développement par défaut). Le mode manuel reste disponible. Le pilote est local, désactivé tant que vous ne le configurez et ne le démarrez pas.

## Étapes et historique

Une dépendance doit être approuvée avant son étape suivante. Chaque run ou reprise crée une tentative et respecte le maximum de l'étape. La reprise peut conserver la session CLI ; retour humain, réponses et livrable précédent sont transmis au nouveau run. Les anciennes tentatives restent consultables.

Les questions finales placent l'étape en `waiting_input`. Enregistrer les réponses ne termine pas le travail : lancez une reprise pour que l'agent complète son livrable. Les questions interactives via `studio_ask_human` attendent la réponse pendant la tentative ; cette interaction suspend la progression du pilote. Les questions et réponses réellement échangées sont conservées avec le résultat. Le délai maximal de la tentative continue pendant cette attente humaine.

Relancer une étape rend tous ses dépendants transitifs `stale`, sans effacer leurs résultats historiques. Les branches indépendantes restent valides. Modifier un livrable approuvé demande une nouvelle validation. Modifier agent, modèle, effort, skills, contexte initial ou MCP après une tentative invalide aussi l'étape et ses descendants. Modifier seulement le maximum de tentatives ou `askBeforeRun` conserve les livrables.

Le maximum d'une étape est compris entre 1 et 100 et ne peut descendre sous son historique enregistré. Les configurations et livrables ne se modifient pas pendant la tentative concernée ; le pilote doit être en pause avant une action manuelle concurrente. Échec, annulation et interruption conservent leurs états réels.

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

Après redémarrage, le pilote reste en pause et le CLI doit être revérifié. Une tentative `failed`, `cancelled` ou `interrupted` exige une reprise manuelle de l'étape avant de repartir en automatique. L'application ne relance pas une erreur au seul clic de démarrage du pilote. Pour terminer, toutes les étapes doivent être approuvées, les critères présents doivent être satisfaits avec une preuve renseignée et aucun commentaire bloquant ne doit rester ouvert.

## Centre de validation et preuves

La validation exige livrable non vide, aucune question ouverte, dépendances approuvées et absence de blocage. La demande d'approbation référence l'identifiant et la révision de la tentative lue. Un livrable, une preuve, un critère ou un commentaire changé depuis cette lecture rend cette approbation obsolète.

Une exécution `studio_run_test` conserve une preuve produite par le host : commande et arguments configurés, dates, code de sortie ou erreur, sorties bornées/tronquées et empreintes des fichiers observés. L'historique reste complet ; pour une même commande, la dernière preuve de la tentative détermine le résultat courant. Une preuve en échec, incomplète ou antérieure à une modification des fichiers bloque la validation. Le host revérifie les empreintes du parcours concerné contre le workspace lors de l'approbation.

Le profil tests exige au moins une vraie preuve hôte réussie pour une approbation automatique. Une validation humaine sans cette preuve reste possible si aucun autre blocage n'existe ; elle n'invente pas un test exécuté. Le rapport de review distingue `pass` et `changes_requested`, avec constats `info`, `warning` ou `blocking`. Les constats de l'agent restent des constats, pas des preuves d'exécution.

Les critères sont saisis et évalués par l'humain : `pending`, `passed` ou `failed`, avec texte de preuve. Tous les critères présents sont requis pour la validation finale. Les commentaires peuvent être bloquants, associés à une tentative et éventuellement à un fichier/une ligne ; ils restent ouverts jusqu'à résolution explicite. Ajouter un critère non satisfait ou rouvrir un commentaire bloquant après complétion remet la feature en `attention` ; résoudre ces blocages rétablit `completed` lorsque toutes les étapes sont approuvées.

## Consommation et profils de modèles

Le budget par défaut est **10 runs** et **60 000 caractères de prompt**, profil `current`. Des plafonds facultatifs portent sur les tokens mesurés et les nano-AIU. Les agrégats incluent tentatives réussies, échouées, annulées ou interrompues. Les mesures sont enregistrées pendant l'exécution ; une donnée absente ou une séquence de mesures partielle reste inconnue, jamais zéro. Les sommes déjà observées sont conservées, sans être présentées comme un total complet. Si le plafond choisi dépend d'une donnée inconnue, le prochain run est bloqué jusqu'à ajustement explicite du budget.

Les limites s'appliquent avant un nouvel appel. Une approbation ou complétion sans nouvel appel reste possible quand le budget de runs est atteint. Elles ne constituent pas une promesse de coût maximal pour l'appel en cours. Les nano-AIU ne sont pas convertis en monnaie ; les tokens estimés de l'aperçu ne sont pas ajoutés aux mesures réelles.

Les profils `economy`, `balanced` et `quality` nécessitent votre correspondance explicite vers un modèle proposé par le CLI et éventuellement un effort. Ils n'incorporent aucun classement de prix supposé. `current` conserve la résolution étape → agent → réglage par défaut → CLI ; les modèles embarqués sont laissés vides.

## Éditeur de workflows et catalogue

L'éditeur visuel construit les étapes, dépendances, agents, profils, skills, livrables, limites et options de contexte. L'enregistrement passe par le host et produit un YAML dans `.feature-studio/workflows/<id>.yaml`. Le document suit le même validateur strict qu'un fichier édité à la main : étapes uniques, dépendances existantes, absence de cycle, agents et skills disponibles, valeurs et livrables valides. Une définition workspace remplace son homologue embarqué par identifiant. Les sessions existantes conservent leur copie ; modifier un template ne réécrit ni leurs étapes ni leurs historiques.

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
    model: ""
    skills: [ai-relecture]
    maxAttempts: 3
    artifact: review.md
    dependsOn: []
    initialContext: "Critères et fichiers ciblés à préciser"
    mcpServerIds: []
    askBeforeRun: true
```

Les agents résident dans `.github/agents/*.agent.md`, les skills dans `.github/skills/<id>/SKILL.md`. Sans `name`, un agent officiel prend l'identifiant de son fichier ; sans `tools`, il reçoit `read`, `search`, `edit`, sans exécution. Les profils du host limitent encore ces droits. `model` doit être une chaîne unique ; les tableaux YAML sont signalés et ignorés. Pseudo et avatar peuvent être choisis sans changer l'identifiant stable de l'agent.

`read-only`, `workspace-write` et `tests` sont les trois profils. `fs-tests` déclare explicitement `execute` pour `studio_run_test`, uniquement pour les commandes configurées et le profil tests. Aucun shell générique n'est exposé. Les dossiers de tests initiaux sont `tests`, `test`, `__tests__`; aucune commande de tests ni commande .NET n'est activée par défaut. Hooks et MCP exigent une configuration explicite ; voir [les connexions MCP](MCP.md) pour leurs permissions et secrets.

L'installation du kit crée seulement les fichiers absents, conserve les fichiers identiques et signale les différences comme conflits. `.ai/project.md` existant est préservé. Les chemins et symlinks sont contrôlés. La provenance et les empreintes de la copie utilisateur sont dans `defaults/PROVENANCE.md` et `defaults/kit-sha256.json`. La persistance privée, la migration v2 et la récupération sont décrites dans [Architecture](ARCHITECTURE.md).
