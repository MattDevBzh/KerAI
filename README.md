<p align="center"><img src="resources/icon.png" width="84" alt="Feature Studio"></p>

# Feature Studio

**Un cockpit visuel pour développer avec tes agents GitHub Copilot CLI, directement dans VS Code.**

Une feature devient un parcours : spécifications, plan, développement, tests, relecture. Chaque étape possède son agent, ses skills, ses MCP, son contexte et ses tentatives. Tu vois ce qui avance, tu fournis une US, tu réponds en direct et tu choisis les validations humaines du parcours.

[Télécharger le VSIX](releases/feature-studio-0.3.0.vsix) · [Espaces Git et restauration](docs/WORKSPACES.md) · [Architecture](docs/ARCHITECTURE.md) · [Créer un workflow](docs/WORKFLOWS.md) · [Intégration Copilot](docs/COPILOT.md) · [Validation et limites](docs/VALIDATION.md)

![Le cockpit Feature Studio — données de démonstration](docs/images/dashboard.png)

## Installation

1. Télécharge **[feature-studio-0.3.0.vsix](releases/feature-studio-0.3.0.vsix)** depuis ce dépôt (bouton Download raw file sur GitHub).
2. Dans VS Code ou VS Code Insiders : **Extensions → … → Installer à partir du VSIX…**.
3. Ouvre le dossier du projet que tu souhaites développer, puis approuve ce workspace.
4. Lance **Feature Studio : ouvrir le cockpit** dans la palette de commandes. Le bouton **Feature Studio** de la barre d’état ouvre aussi le cockpit.
5. Dans **Réglages**, clique sur **Vérifier la connexion**. Le diagnostic vérifie le CLI, le compte et les modèles sans envoyer de prompt.

Prérequis : **VS Code 1.110 ou ultérieur**, Git pour les branches/diffs, et **GitHub Copilot CLI** installé et authentifié avec un abonnement donnant accès au CLI. Installer le VSIX ne nécessite ni Node.js ni npm séparément. Le moteur Node embarqué dans les versions récentes de VS Code est utilisé par l’extension.

Si `copilot` n’est pas trouvé, renseigne le chemin complet dans **Réglages → Chemin du CLI dans VS Code** (`featureStudio.cliPath`). Sur macOS avec Homebrew, ce peut être `/opt/homebrew/bin/copilot`. L’extension ne met pas le CLI à jour automatiquement. Voir [l’installation officielle du CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli).

**Feature Studio ouvre son propre onglet de travail.** Il utilise le CLI local et son authentification ; il ne remplace pas les composants internes de la vue Chat de l’extension GitHub Copilot. Les deux interfaces peuvent coexister. Aucun serveur applicatif supplémentaire n’est requis ; les requêtes IA passent naturellement par GitHub Copilot.

## Choisir un parcours

| Parcours         | Pour quoi ?                                                    | Étapes                                                    |
| ---------------- | -------------------------------------------------------------- | --------------------------------------------------------- |
| Feature complète | Développer un besoin avec des décisions intermédiaires         | Spécifications → plan → développement → tests → relecture |
| Relecture seule  | Examiner les changements sans écrire, compiler ou tester       | Relecture                                                 |
| Session libre    | Confier une tâche à un seul agent, dans une vraie conversation | Une étape de développement configurable                   |

Le tableau de bord affiche les sessions, leur état, leur branche et leur progression. Recherche, filtres et archives permettent de retrouver les anciens travaux. Aucune session d’exemple n’est ajoutée à ton projet.

### Développer une feature

1. Clique **Nouvelle session**, choisis le parcours, donne un titre et décris le résultat attendu. **L’espace de cette session** propose un **Worktree isolé** pour une feature ou une session libre, et le **Dossier courant** pour une relecture. Tu peux changer ce choix avant la création.
2. Ouvre une étape. **Configurer** permet de choisir l’agent, le modèle réellement proposé par le CLI, les skills, le raisonnement lorsqu’il est disponible et la limite de tentatives.
3. Clique **Exécuter cette étape** : colle ta **US, demande ou contexte initial**, choisis les MCP utiles, puis **Préparer l’aperçu**. Relis les sources et le prompt assemblé ; **Lancer cette étape** démarre ensuite la vraie session. Le même dialogue apparaît pour une reprise ou une nouvelle tentative. Tout changement invalide l’aperçu précédent.
4. Si l’agent utilise `studio_ask_human`, sa question apparaît pendant l’exécution : réponds et clique **Transmettre la réponse**. L’appel attend réellement ta réponse. Si le modèle termine plutôt avec un bloc de questions, réponds au formulaire puis **Reprendre la session**. Les échanges sont conservés.
5. Relis le **Livrable**. Tu peux éditer son Markdown et l’enregistrer, ou donner un feedback pour une nouvelle tentative.
6. Clique **Valider cette étape**, puis **Continuer**. La validation débloque l’étape suivante ; elle ne lance pas de requête IA toute seule.
7. Après le développement, consulte **Fichiers → Voir le diff** pour ouvrir les modifications dans VS Code.
8. Configure les commandes de test nécessaires, exécute l’étape Tests, puis lance la relecture indépendante.

![Parcours et livrable — données de démonstration](docs/images/feature.png)

**Une correction après la relecture ?** Retourne sur Développement, précise ton feedback dans **Votre retour**, utilise **Rejouer cette étape**, puis fais revalider Tests et Relecture. Les anciens essais restent visibles. Une spécification ou un plan modifié rend également les étapes dépendantes **à actualiser**.

**Arrêter** annule le processus ; les fichiers déjà écrits restent présents pour inspection. Après fermeture ou interruption, la tentative devient annulée ou interrompue. **Reprendre** réutilise son identifiant Copilot ; **Nouvelle tentative** ouvre une nouvelle conversation avec les livrables approuvés et le contexte précédent. Une reprise consomme elle aussi une tentative. Si la limite est atteinte, **Configurer → Limite de tentatives** permet de la relever explicitement.

Les sessions restent liées à leur branche et à leur dossier d’exécution. À la création d’une session isolée, Feature Studio crée une branche et un worktree local depuis le dernier commit **HEAD**. Il ne crée aucun commit, push, PR ni déploiement automatiquement.

## Un espace Git et des points de restauration par feature

Le **Worktree isolé** est un dossier frère du projet, avec sa branche `codex/feature-studio-…`. Il contient uniquement l’état commité de HEAD : les modifications non commitées, les fichiers non suivis et les changements déjà stagés restent dans le dossier source. Aucune dépendance ni préparation d’outils n’est installée automatiquement. Les hooks Git, `fsmonitor` et filtres externes sont neutralisés ; LFS/smudge n’est pas matérialisé automatiquement. Prépare cet environnement avant de demander des tests qui en ont besoin.

L’isolation demande d’ouvrir la racine d’un dépôt Git ayant un commit HEAD. Si elle est indisponible, son choix est désactivé et le cockpit affiche la raison. La **relecture seule** utilise le dossier courant par défaut pour examiner le diff déjà présent. Les sessions créées avant la v0.3 conservent aussi leur dossier courant ; elles ne sont pas déplacées automatiquement.

Le bandeau **ESPACE GIT** affiche le dossier et la branche de la feature. **Ouvrir le dossier** ouvre une nouvelle fenêtre VS Code ; le cockpit d’origine garde l’historique et le pilotage de la session. Si tu ouvres un autre cockpit dans le worktree, son verrou bloque l’accès du cockpit d’origine à cette feature jusqu’à sa fermeture ; les vues de fichiers normales restent utilisables. Les fichiers, diffs, tests et hooks de cette feature sont résolus dans son propre espace.

Dans **Points de restauration** :

1. Une tentative isolée conserve un point **Avant la tentative**, avant les hooks, puis un point **Après la tentative**, y compris après annulation ou échec lorsque la capture reste possible. **Avant**, **Après** et **Comparer** sont accessibles depuis son historique.
2. **Nouveau point → Créer le point** ajoute un point manuel nommé, également disponible pour les anciennes sessions dans le dossier courant.
3. Choisis un point, puis **Comparer les fichiers** avec **État actuel du dossier** ou un autre point. **Diff** ouvre sa comparaison dans VS Code. Une comparaison point-vers-point est consultative.
4. Pour revenir à un point depuis l’état actuel, coche explicitement les fichiers voulus ; la sélection est vide au départ. **Restaurer la sélection → Confirmer la restauration** demande au host de vérifier l’empreinte de la comparaison. Les fichiers ajoutés depuis le point choisi seront supprimés seulement si tu les coches.
5. Une sauvegarde de récupération est enregistrée et rattachée durablement à l’historique **avant toute écriture**. Les validations et preuves d’acceptation deviennent à revalider et le pilote est mis en pause. Si les fichiers ont changé depuis la comparaison, il faut **Actualiser la comparaison**.

![Comparer des points et sélectionner les fichiers — données de démonstration](docs/images/checkpoints.png)

Ces points conservent le contenu et les permissions des fichiers inclus ; ils ne restaurent ni l’index Git, ni la branche, ni les commits. Les fichiers ignorés non suivis, secrets usuels, dossiers de configuration, dépendances, sorties de build et liens sont exclus. Limites : **4 MiB par fichier, 64 MiB par point et 10 000 fichiers candidats**. Ce mécanisme est une restauration ciblée, pas une sauvegarde exhaustive du projet. **Archiver la session** conserve son dossier et ses points sur disque.

La création, la comparaison et la restauration Git n’ajoutent aucune requête IA. Elles ne publient rien. Les opérations sont verrouillées pendant une tentative ou une autre mutation ; le host recontrôle racine, branche et fichiers. Les buffers non enregistrés sont protégés dans la fenêtre VS Code courante seulement : les autres fenêtres et processus restent hors sandbox. [Périmètre, exclusions et limites détaillés](docs/WORKSPACES.md).

**Stockage v3 :** les formats v0/v1/v2 migrent en conservant leurs données connues. Une fois ces données enregistrées en v3, ne réinstalle pas la v0.2 pour les ouvrir : elle refuse ce format et ne sait pas conserver les métadonnées de worktree. Il n’existe pas de migration inverse automatique.

![Préparer une US et ses MCP — données de démonstration](docs/images/launch-context.png)

## MCP et Azure DevOps : apporter les bonnes US

Dans **Réglages → Connexions MCP**, le preset **Azure DevOps** demande ton organisation et propose la connexion interactive ou une connexion Azure CLI existante. Il configure le serveur Microsoft `@azure-devops/mcp@2.10.0`, domaine `work-items`, avec seulement **`wit_work_item`** autorisé pour consulter les US. Il reste désactivé à la création.

1. Ajoute le preset, puis enregistre les réglages.
2. **Découvrir les outils** lance le serveur et liste ses capacités **sans requête IA**. La première utilisation de `npx` peut télécharger le package et l’authentification Microsoft peut ouvrir un navigateur.
3. Vérifie la liste autorisée, active le serveur et confirme sa configuration dans VS Code.
4. Au lancement d’une étape, coche ce MCP et colle par exemple : « Consulte l’US 208 du projet MonProjet, puis prépare ses critères d’acceptation. » Tu peux aussi coller directement le contenu de l’US sans connexion externe.
5. Une question humaine ou une demande d’autorisation reste accessible dans le cockpit pendant le travail.

Tu peux ajouter tes propres serveurs **stdio, HTTP ou SSE**. La liste d’outils est explicite : aucun joker pendant les sessions. Les clés d’environnement et les en-têtes référencent le **coffre VS Code** ou des variables du processus ; les valeurs secrètes ne sont pas enregistrées dans la configuration du cockpit. N’inscris pas de token dans les arguments ou l’URL. Les lectures automatiques sont facultatives et exigent une annotation de lecture seule du runtime. Une écriture MCP demande une autorisation pour chaque appel ; en profil lecture seule, écriture et opération sans garantie de lecture sont refusées.

**Compatibilité MCP : le CLI 1.0.63 installé sur la machine de recette est trop ancien pour ce parcours.** Il permet la découverte, mais l’exécution MCP est refusée avant tout prompt car sa politique de permissions ne peut pas être vérifiée. Mets le CLI à jour vers une version compatible avec le SDK 1.0.20 avant d’utiliser les MCP ; les sessions sans MCP restent compatibles avec 1.0.63. Le contrôle porte sur les capacités effectives, sans supposer qu’un numéro de version suffit.

Les sept scénarios de permissions ont été vérifiés avec une fixture locale et le **runtime 1.0.96 fourni avec le SDK**, sans appel modèle. Ce runtime de test n’est pas installé par le VSIX et ne remplace pas ton CLI. L’accès à **ton organisation Azure DevOps** reste à valider avec ton authentification. [Configuration et preuves MCP](docs/MCP.md).

## Pilote automatique, validation et coût

Dans une feature, le **pilote automatique** enchaîne les étapes disponibles suivant les dépendances. Configure les points de validation humaine, le contexte/MCP de chaque étape et les limites avant de le démarrer. Il s’arrête sur une question, une permission MCP, un échec, un seuil atteint ou un checkpoint. **Pause** laisse finir la tentative courante ; **Arrêter** l’annule. Après une question, il faut reprendre explicitement le pilote pour continuer le parcours. Une tentative échouée ou interrompue se relance manuellement.

La boucle de correction est facultative : choisis une étape de relecture et une étape de développement en amont. Le pilote utilise le verdict structuré de la relecture ou une preuve de tests en échec ; il rejoue ensuite les étapes devenues obsolètes. Un checkpoint reste prioritaire sur cette boucle. Par défaut, **zéro cycle de correction supplémentaire** : augmente le nombre seulement si tu le souhaites. Il n’y a aucun agent chargé de décider du prochain agent ; l’orchestration est du code local.

Le **centre de validation** rassemble le livrable, les fichiers/diffs, les commandes de test et leurs sorties réelles, les critères d’acceptation et tes commentaires, éventuellement associés à un fichier/une ligne. Un constat du modèle est distingué d’une preuve issue du runner. Les remarques bloquantes et les critères sans preuve empêchent de déclarer le parcours terminé. Le pilote ne valide pas une étape Tests sans résultat hôte réussi. Une édition du livrable invalide l’ancienne validation ; les preuves sont revérifiées par empreinte des fichiers observés. Le diff de **Fichiers → Voir le diff** compare HEAD aux fichiers de l’espace de la feature. **Points de restauration** propose en plus les comparaisons propres à ses points avant/après ou manuels.

Le panneau **consommation** cumule les mesures reçues et indique les tentatives dont l’usage est inconnu. Tu peux fixer un nombre total de runs, des seuils de tokens/nano-AIU et une taille maximale de contexte. Les validations, aperçus et éditions locales n’appellent pas de modèle. Les profils **économie / équilibré / qualité** utilisent les modèles que tu leur attribues dans les réglages parmi ceux réellement disponibles ; leur nom ne promet aucun tarif. Si le CLI n’annonce que `auto`, aucun modèle moins cher n’est inventé.

## Mémoire locale, à coût maîtrisé

Ajoute les conventions, décisions, informations d’architecture et contexte durable dans **Mémoire**. Tu peux aussi conserver un extrait d’un livrable validé avec son origine. Le texte est enregistré localement, sans agent de résumé ni indexation IA. Une entrée provenant d’une version ensuite invalidée est refusée à la prochaine injection.

La mémoire est **décochée à chaque lancement manuel**. Si tu l’actives, seules les entrées actives que tu coches sont envoyées ; une sélection vide n’ajoute rien. Le total injecté est plafonné à **4 000 caractères**, sans troncature ni résumé automatique. L’aperçu montre chaque entrée ajoutée. Elle peut donc ajouter des tokens au prompt si tu l’actives, mais ne déclenche jamais une requête supplémentaire. Le même choix explicite s’applique au contexte enregistré des étapes du pilote.

## Construire ses propres parcours

L’éditeur visuel de **Parcours** permet d’ajouter, dupliquer, retirer et réordonner les étapes, de relier leurs dépendances, puis de choisir agents, modèles, skills, permissions et contexte initial. Le graphe montre les liens ; les cycles et références invalides sont refusés. Les boutons de déplacement offrent une alternative au glisser-déposer.

L’enregistrement produit un YAML dans `.feature-studio/workflows/`. Les sessions existantes conservent leur définition ; le nouveau parcours s’applique aux sessions créées ensuite. **Demander avant de lancer** impose une pause avant l’étape, même avec le pilote. [Détails et format de workflow](docs/WORKFLOWS.md).

![Éditeur visuel de parcours — données de démonstration](docs/images/workflow-editor.png)

## Donner une personnalité aux agents

Dans **Agents**, ouvre un profil et change **Son petit nom**. Choisis l’un des huit personnages : le mage architecte, le hacker au café, le détective, le bûcheron, le scientifique, le robot, le ninja ou le capitaine.

<p>
<img src="webview/public/avatars/wizard/idle.png" width="82" alt="Mage">
<img src="webview/public/avatars/hacker/working.gif" width="82" alt="Hacker au travail">
<img src="webview/public/avatars/detective/idle.png" width="82" alt="Détective">
<img src="webview/public/avatars/lumberjack/idle.png" width="82" alt="Bûcheron">
<img src="webview/public/avatars/scientist/working.gif" width="82" alt="Scientifique au travail">
<img src="webview/public/avatars/robot/idle.png" width="82" alt="Robot">
<img src="webview/public/avatars/ninja/approved.png" width="82" alt="Ninja satisfait">
<img src="webview/public/avatars/captain/approved.png" width="82" alt="Capitaine satisfait">
</p>

Chaque avatar possède une image de repos, un **vrai GIF de travail à quatre images**, puis une pose de validation. Les animations respectent la préférence système de réduction des mouvements. Le pseudo et le personnage sont sauvegardés dans le profil du projet ; le rôle technique reste indépendant du petit nom.

Tu peux modifier les instructions, le modèle et les skills, ou créer un nouvel agent. Une personnalisation d’un profil fourni crée sa version dans `.github/agents/`. Les agents déjà présents dans le projet sont découverts, et leurs fichiers restent utilisables directement avec Copilot.

Les capacités reconnues sont `read`, `search`, `edit`/`write` et `execute`, ainsi que les noms précis des outils `studio_*`. `execute` donne accès uniquement aux commandes de tests déjà autorisées, et seulement dans une étape de profil Tests. Il n’ouvre aucun terminal libre. La permission effective est toujours l’intersection du profil d’étape et des outils de l’agent.

## Skills et kit Copilot

Le **kit Copilot 2.0.0 fourni par Matt** est embarqué avec ses quatre agents, sept skills, six templates et ses scripts. Cinq profils Feature Studio adaptent ce kit aux étapes du cockpit. Les skills sont disponibles immédiatement dans le catalogue.

Clique **Installer le kit du projet** pour matérialiser les agents, skills, templates et scripts dans le dépôt. Les fichiers identiques sont conservés, les fichiers personnalisés ne sont jamais écrasés. Un bilan indique les conflits ; leur détail apparaît dans la sortie **Feature Studio**. Aucun script d’installation, MCP, outil externe ou tâche n’est lancé par cette copie.

Dans **Skills**, tu peux consulter une méthode, éditer son Markdown ou en créer une. Associe-la ensuite au profil d’agent ou à une étape. Feature Studio injecte explicitement les skills sélectionnées dans le contexte. Les instructions générales du dépôt ne sont pas découvertes automatiquement par le runtime isolé : ajoute les règles pertinentes à un agent/skill ; l’agent peut lire `.ai/project.md` et les fichiers qu’on lui indique.

Le runner du kit concerne **.NET/VSTest**. Il est conservé comme option et n’est pas choisi automatiquement pour les projets JavaScript, Python ou d’autres stacks. [Provenance du kit](defaults/PROVENANCE.md).

## Autoriser les tests et les hooks

Dans **Réglages → Commandes de test autorisées**, ajoute un nom, un exécutable et ses arguments **un par ligne**. Par exemple, pour ce dépôt :

| Champ      | Valeur                                       |
| ---------- | -------------------------------------------- |
| Nom        | Tests unitaires                              |
| Exécutable | `npm`                                        |
| Arguments  | `test` puis `--` puis `--run` (trois lignes) |

Les **Chemins de test** sont des préfixes de dossiers, sans glob : `tests`, `test`, `__tests__` par défaut. Ajuste-les avant de demander la création de tests ailleurs. Le profil Tests peut écrire seulement dans ces dossiers et exécuter uniquement les commandes configurées. Leur code retour, leurs sorties et les échecs sont consignés.

L’enregistrement de nouvelles commandes affiche une confirmation VS Code avec leur contenu exact. Elles tournent sous ton compte : les scripts qu’elles appellent ne sont pas confinés dans une sandbox système. Sur Windows, utilise un exécutable natif (`node.exe`, `dotnet.exe`…) ; les lanceurs `.cmd` ne sont pas pris en charge par ce runner sans shell.

Dans **Automatisations**, les hooks `beforeRun` et `afterRun` exécutent des commandes locales facultatives. Ils sont désactivés à la création et nécessitent une activation explicite. Ils sont ignorés pour les étapes en lecture seule. Les hooks/MCP natifs de Copilot ne sont pas importés ni activés automatiquement.

## Données, permissions et consommation

- Les features, essais, réponses, validations, journaux et métadonnées de worktree sont sauvegardés dans le stockage local de l’extension VS Code, par dossier. Le format v3 est versionné et les écritures sont atomiques. Les contenus des points de restauration restent dans le stockage privé de l’extension, hors des checkouts.
- Les conversations Copilot utilisent un répertoire de données propre à Feature Studio. `~/.copilot` n’est pas modifié. Le trousseau existant est réutilisé si le CLI le permet.
- **Exporter** produit un fichier Markdown avec les livrables et l’historique de la session.
- Un seul cockpit est actif pour une même racine sur une machine, et une seule tentative tourne à la fois dans ce cockpit. Deux projets sources distincts peuvent tourner en parallèle. La racine du worktree est également verrouillée pendant son utilisation. Une mutation Git exige l’absence de tentative active et un pilote en pause.
- Les écritures préexistantes non validées dans Git sont protégées. Les fichiers créés par la même feature peuvent être retravaillés si leur contenu n’a pas été modifié entre-temps. Les suppressions humaines, les chemins sensibles et les liens symboliques sont refusés.
- L’agent dispose des outils hôtes et des seuls outils MCP explicitement choisis. Il ne dispose d’aucun shell générique, accès de navigation natif ou commande Git d’écriture. Le catalogue réel et la provenance des outils MCP sont vérifiés avant l’envoi du prompt.
- L’interface affiche les tokens, le modèle effectif et les nano-AIU uniquement si le CLI les fournit. Elle cumule également les tentatives échouées/annulées et signale les données inconnues. Les plafonds sont contrôlés avant chaque nouveau run ; un run en cours peut dépasser un seuil de tokens ou de nano-AIU. Ce ne sont pas des euros ni un plafond financier garanti.

## Développer l’extension

Node.js **22.12+** et npm sont nécessaires pour travailler sur les sources.

```bash
npm ci
npm run check          # TypeScript, tests unitaires/intégration, builds
npx playwright install chromium
npm run test:ui        # Parcours webview, sans requêtes IA
npm run test:extension # Vrai hôte VS Code isolé, sans prompt IA
npm run smoke:mcp     # Diagnostic MCP local explicite, sans prompt IA
npm run package       # Produit releases/feature-studio-0.3.0.vsix
```

Ouvre le projet et utilise **F5 → Feature Studio** pour un hôte de développement. `npm run dev` ouvre le frontend de développement ; `http://127.0.0.1:5173/?demo=1` affiche des données d’exemple avec un bandeau explicite. Sans ce paramètre et hors VS Code, aucune exécution n’est simulée.

Le test réel facultatif est séparé dans `scripts/smoke-copilot.ts` et exige `FEATURE_STUDIO_LIVE_TEST=1`. Il consomme du quota Copilot. Il ne fait partie ni de `npm test` ni de la CI. Les sources des avatars et leurs prompts sont dans [design/avatars](design/avatars/PROMPTS.md) ; `node scripts/pack-avatars.mjs` reconstruit leurs PNG/GIF.

Voir [la validation livrée et les limites connues](docs/VALIDATION.md) pour distinguer tests automatiques, test du CLI réel, versions testées et plateformes non vérifiées.
