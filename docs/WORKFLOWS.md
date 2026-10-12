# Workflows, stockage et personnalisation

Feature Studio fournit `feature` (specs → plan → dev → tests → review), `code-review` (review seule) et `single` (un seul agent, une conversation, un livrable ; développement par défaut). Chaque tentative produit un livrable Markdown. Une étape préalable doit être approuvée avant de lancer ses dépendants. La validation exige un livrable non vide et aucune question ouverte.

Une question met la tentative en `waiting_input`. Enregistrer une réponse conserve cet état : la reprise permet à l'agent de terminer le livrable avec les réponses. Reprendre crée une nouvelle tentative, conserve la session CLI lorsqu'elle existe et respecte le maximum de tentatives. Les anciennes réponses et les anciens livrables restent consultables dans l'historique. Annuler, échouer ou fermer l'extension conserve la tentative avec son état réel. Le chargement récupère les tentatives restées `running` en `interrupted`.

Le maximum de tentatives se règle par étape entre 1 et 100, sans descendre sous le nombre déjà enregistré. Modifier seulement cette limite conserve les questions, la possibilité de reprise et les validations existantes. Modifier aussi la sélection d'agent, modèle, effort ou skills invalide l'étape et ses dépendants.

Relancer une étape invalide tous ses dépendants transitifs en `stale`, sans effacer leur historique. Une branche indépendante reste valide. Modifier un livrable déjà approuvé demande une nouvelle validation et invalide ses dépendants. Changer l'agent, le modèle, l'effort ou les skills après une tentative rend également l'étape obsolète. Le moteur limite chaque feature à une tentative simultanée. Les éditions de livrables et de configuration sont indisponibles pendant une tentative.

Les workflows sont des documents YAML stricts placés dans `.feature-studio/workflows/*.yaml`. Les workflows du workspace prennent la priorité par identifiant sur les defaults. Un document invalide est ignoré avec un diagnostic ; les autres restent utilisables. Les identifiants de dépendances doivent exister, être uniques et former un graphe acyclique. Les agents et skills référencés doivent être présents. Les clés inconnues, cycles, chemins de livrables et maxima invalides sont rejetés.

```yaml
id: custom
name: Mon workflow
description: Une relecture ciblée
icon: scan-eye
steps:
  - id: review
    name: Relecture
    description: Relire le diff courant
    agentId: fs-review
    policy: read-only
    model: ""
    skills: [ai-relecture]
    maxAttempts: 3
    artifact: review.md
    dependsOn: []
```

Les profils `read-only`, `workspace-write` et `tests` sont définis dans `defaults/permissions.json`. Les outils CLI effectifs et les contrôles du host doivent respecter le profil sélectionné. Le profil tests limite les éditions aux chemins configurés, une vérification du host en complément des consignes de l'agent. Les tests locaux passent uniquement par `studio_run_test`, si une commande a été explicitement configurée et autorisée. Aucun profil n'autorise un shell générique. Les hooks sont désactivés par défaut et exigent une configuration explicite. Les dossiers de tests par défaut sont `tests`, `test` et `__tests__` ; configure les autres chemins avant une tentative tests. Aucune commande ni test .NET n'est installé par défaut.

Les agents workspace sont des Markdown avec frontmatter dans `.github/agents/*.agent.md`. Les skills résident dans `.github/skills/<id>/SKILL.md`. Un agent ou un skill workspace remplace son homologue embarqué par identifiant ; l'édition explicite dans Studio crée ou remplace le fichier workspace, sans toucher les defaults de l'extension. Le frontmatter d'un agent contient `name`, `description`, `tools`, `model`, `skills` et éventuellement `nickname`, `avatar`. Les avatars acceptés sont wizard, hacker, detective, lumberjack, scientist, robot, ninja, captain. Les identifiants, traversées de chemins et liens symboliques sont contrôlés avant toute écriture.

Les agents officiels sans `name` utilisent l'identifiant du fichier comme nom ; sans `tools`, ils reçoivent seulement `read`, `search`, `edit`, sans droit d'exécution par défaut. Le profil de l'étape limite toujours les outils effectivement exposés par le host : un profil lecture seule refuse l'édition même si l'agent la demande. `model` doit rester une chaîne unique ; une liste YAML de modèles produit un diagnostic et l'agent n'est pas chargé. L'agent dérivé fs-tests déclare explicitement `execute` pour accéder à `studio_run_test` ; ce droit ne fonctionne que dans le profil tests, pour les commandes configurées par l'utilisateur, et n'autorise aucun shell libre.

Le bouton d'installation du kit crée exclusivement les fichiers absents. Une deuxième installation laisse les fichiers identiques en place et liste les différences comme conflits. La carte `.ai/project.md` existante est toujours conservée. Aucune fusion implicite ni remplacement n'est effectué. La provenance et les empreintes du kit sont livrées dans `defaults/PROVENANCE.md` et `defaults/kit-sha256.json`.

Le stockage est un `state.json` versionné dans le dossier local attribué à l'extension par VS Code, hors du dépôt accessible aux agents. Il conserve features, tentatives, livrables, journaux, empreintes de fichiers modifiés et paramètres. Les registres et les modèles sont relus depuis leurs sources. La version 0 (même structure de features, paramètres incomplets) migre vers 1 en ajoutant les paramètres par défaut ; une version inconnue ou un JSON corrompu est rejeté en préservant l'original. Les sauvegardes d'un même processus sont sérialisées par chemin et capturent leur instantané à l'appel ; fichier temporaire, synchronisation disque puis renommage atomique évitent les fichiers partiels. Cela ne remplace pas un verrou entre deux processus indépendants.
