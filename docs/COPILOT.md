# Contrat GitHub Copilot de Feature Studio

Feature Studio utilise le SDK officiel `@github/copilot-sdk` **1.0.20** avec un processus du CLI déjà installé. Il ne simule ni les réponses ni les événements. Aucune mise à jour automatique du CLI, installation de modèle ou publication GitHub n'est lancée par l'adaptateur.

## Détection et chemin utilisé

Depuis la v1.11.0, `featureStudio.cliPath` vaut `auto` par défaut. Une valeur vide ou l’ancienne valeur `copilot` active également la détection. Le CLI est recherché dans les répertoires absolus du PATH de l’hôte VS Code, dans leur ordre, puis dans les emplacements usuels :

- Windows : `%APPDATA%\npm`, `%LOCALAPPDATA%\GitHubCopilotCLI` (MSI), `%LOCALAPPDATA%\Microsoft\WinGet\Links`, `%USERPROFILE%\.local\bin`.
- macOS/Linux : `~/.local/bin`, `/usr/local/bin`, `/usr/bin`, et `/opt/homebrew/bin` sur macOS.

Sous Windows, la préférence par répertoire est `.exe`, `.cmd`, `.bat`, puis le fichier sans extension. Les entrées PATH vides ou relatives ne servent pas à découvrir un exécutable dans le projet. Les dossiers VS Code `github.copilot-chat/copilotCli` et `bin/copilot-shim` sont ignorés en mode automatique : leurs lanceurs cherchent une installation distincte et peuvent proposer une installation interactive. Le nouveau lanceur natif remplace les anciens scripts ; un ancien chemin `copilot.bat` peut donc disparaître après mise à jour de VS Code.

**Réglages → Vérifier la connexion** affiche le chemin réellement résolu et sa provenance, même si l’authentification échoue ensuite. **Détection automatique** enregistre `auto` au niveau utilisateur et relance le diagnostic si le projet est approuvé et disponible. Aucun prompt n’est envoyé. Un chemin personnalisé reste prioritaire : s’il est absent, Feature Studio ne le remplace pas silencieusement.

Pour retrouver les commandes disponibles dans un nouveau terminal PowerShell de VS Code :

```powershell
Get-Command copilot, copilot.exe, copilot.cmd, copilot.bat -All -ErrorAction SilentlyContinue |
  Select-Object CommandType, Source, Path
```

Avec npm, sélectionner le chemin complet de `copilot.cmd`, pas `copilot.ps1`. Le PATH d’un terminal peut différer de celui du processus d’extension ; après installation, fermer toutes les fenêtres VS Code et rouvrir l’application peut être nécessaire. En WSL/SSH, le CLI doit être installé sur l’hôte où tourne Feature Studio. Réutiliser le même exécutable ne partage pas les conversations VS Code et ne garantit pas l’authentification du runtime isolé.

Source : [contrat officiel du lanceur natif VS Code](https://github.com/microsoft/vscode/blob/main/copilot_shim/REQUIREMENTS.md).

## Transport et diagnostic

Le SDK lance `copilot --headless --stdio --no-auto-update`. Le transport est JSON-RPC 2.0 avec le framing `Content-Length: <octets>\r\n\r\n`, et non du JSONL. L'intégration TypeScript publiée utilise :

```ts
new CopilotClient({
  connection: RuntimeConnection.forStdio({ path: cliPath, args: [...] }),
  workingDirectory: neutralRuntimeDirectory,
  baseDirectory: isolatedCopilotHome,
  useLoggedInUser: true,
});
```

Feature Studio résout maintenant `copilot` dans le `PATH` et utilise un petit lanceur Node distribué avec l’extension. Sous Windows, il lance les `.bat` et `.cmd` par `cmd.exe /d /s /v:off /c`, avec le chemin cité et les arguments techniques contrôlés ; les exécutables sont lancés directement. Dans l’hôte Electron de VS Code, le lanceur démarre avec `ELECTRON_RUN_AS_NODE=1`. Ses stdin/stdout sont transmis au CLI sans conversion ni écriture de prompt par le lanceur. Le prompt passe toujours par `session.send()`, selon le contrat officiel du SDK. Remplacer ce transport par `copilot -p` supprimerait les handlers d’outils, les permissions et les événements utilisés par le cockpit.

Le défaut constaté dans le SDK 1.0.20 est l’appel direct à `spawn(path, args)` pour un shim `.bat`/`.cmd`, qui n’est pas un exécutable Windows autonome. Le SDK vérifie aussi `existsSync(path)` sans résoudre une commande courte dans le `PATH`. Une erreur « Cannot call write after a stream was destroyed » indique un transport fermé ; elle ne démontre pas à elle seule pourquoi le CLI a quitté. Le succès d’un appel manuel `-p` ne valide ni le démarrage `--headless --stdio` ni l’authentification dans le `COPILOT_HOME` isolé.

Active `featureStudio.debugCli` pour journaliser la commande, les arguments techniques, la durée, le code de sortie et le stderr filtré dans **Sortie → Feature Studio**. Les prompts et l’environnement complet ne sont pas journalisés. Les valeurs des secrets MCP résolus et des variables d’environnement sensibles sont masquées avant écriture des diagnostics. Les fichiers de diagnostic temporaires sont supprimés à la fermeture ; les sessions natives restent persistées par le SDK. Les erreurs de lancement conservent le code retour et le stderr disponibles, sans retry ni réponse de remplacement.

Les tests du lanceur utilisent de vrais sous-processus locaux sans connexion à Copilot. Un job CI Windows couvre les fichiers `.bat`/`.cmd` et les chemins avec espaces. La validation d’un agent réel dans VS Code Windows nécessite toujours le CLI installé et le compte de l’utilisateur ; elle ne doit pas être déduite de ces fixtures.

Les anciennes options `cliPath` et `cwd` visibles dans certains exemples GitHub ne sont plus les options de ce SDK. Le SDK publié exige le protocole v3. Le CLI fourni avec son package est 1.0.96 ; Feature Studio choisit explicitement le binaire configuré et vérifie ses capacités au lieu de supposer que la version installée est identique.

Le diagnostic démarre automatiquement à l'ouverture du cockpit si l'espace de travail est approuvé, après son approbation, ainsi que pour un projet encore non vérifié lorsqu'il devient actif. Il laisse l'interface utilisable pendant la connexion. Un échec reste affiché et se relance explicitement avec **Vérifier la connexion** ; la navigation ne provoque pas de nouvelle tentative en boucle. La démonstration et le simple chargement du lanceur ne déclenchent pas ce diagnostic.

Le diagnostic appelle `start`, `getStatus`, `getAuthStatus` et `listModels`, puis crée une session jetable pour introspecter les outils et les modes de permission natifs. Cette session est supprimée après contrôle. Aucun prompt ni outil du projet n’est exécuté. La liste des modèles provient du compte réel. Un identifiant ou niveau de raisonnement absent de cette liste est refusé avant création de session. Le raisonnement est configuré seulement parmi `supportedReasoningEfforts` annoncés pour le modèle choisi.

Le runtime utilise un `COPILOT_HOME` propre à l'extension, sous son stockage global. Les données personnelles `~/.copilot` ne sont pas modifiées. L'authentification du CLI peut réutiliser le trousseau système ou un token déjà fourni dans l'environnement. Si elle est indisponible, le diagnostic le signale. Une connexion manuelle peut se faire avec `COPILOT_HOME=<répertoire indiqué dans le diagnostic> copilot login`; l'extension ne lit ni ne conserve le token. `mode: 'empty'` du SDK impose `COPILOT_DISABLE_KEYTAR=1`, aussi l'adaptateur applique les restrictions explicitement en conservant l'authentification du trousseau.

Sources : [SDK TypeScript et options actuelles](https://github.com/github/copilot-sdk/blob/main/nodejs/README.md), [types publiés à vérifier avec la version npm](https://registry.npmjs.org/@github/copilot-sdk), [transport local](https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/local-cli).

## Restriction technique des outils

### Connexion manuelle sur Windows

Si le CLI démarre mais que Feature Studio annonce une authentification absente, ouvrir un terminal PowerShell dédié. Affecter `$env:COPILOT_HOME` au chemin exact affiché par le diagnostic, puis lancer `& "<chemin complet de copilot.bat>" login`. Terminer la connexion GitHub, fermer ce terminal et relancer le diagnostic Feature Studio. Cette variable ne doit pas être rendue permanente : elle ne concerne que la connexion au runtime isolé. Le chemin historique peut contenir deux segments `copilot-runtime` ; utiliser le chemin affiché pour conserver les sessions existantes.

Les chemins complets sans extension sont également résolus sous Windows vers un fichier existant `.exe`, `.cmd` ou `.bat`. Un chemin complet introuvable produit une erreur avant le lancement du SDK et ne bascule pas vers un autre CLI du `PATH`.

### Catalogue et permissions

Depuis la v1.22.0, les nouvelles sessions utilisent les outils natifs Copilot : fichiers, recherche, terminal et `ask_user`. Le diagnostic vérifie le catalogue réel et les modes disponibles. Les permissions choisies pour la session remplacent les politiques Studio sur ces outils génériques ; les outils métier gardent leurs contrôles. Le runtime réapplique les permissions avant le premier prompt et après reprise. Voir [Copilot natif](COPILOT-NATIF.md) pour les garanties et la matrice vérifiée.

### Régime Studio historique

Les paragraphes suivants concernent les sessions anciennes sans régime natif. Aucun changement de régime n’est appliqué automatiquement.

Les flags classiques `--allow-tool=write` ne confinent pas les écritures par chemin. Les règles `shell(command:*)` autorisent un nom/préfixe de commande, sans garantir que ses arguments ou le code exécuté respectent les limites du workspace. Le `cwd` et les instructions en langage naturel ne suffisent pas pour une restriction de tests.

L'adaptateur injecte les outils `studio_*` fournis par `ToolHost` : liste, lecture, recherche, écriture, diff et commande de test configurée. Chaque handler vérifie les permissions dans `PolicyEngine` et reçoit le signal d'annulation. Il n'existe aucun shell libre accessible au modèle. Les chemins et les commandes sont évalués par l'hôte ; les profils `read-only`, `workspace-write` et `tests` sélectionnent les capacités correspondantes.

La session reçoit une `availableTools` exacte, une `excludedTools` défensive, un `onPermissionRequest` qui rejette toute demande native non autorisée et applique la politique des MCP explicitement sélectionnés, et un `onPreToolUse` qui refuse tout nom hors allowlist. Les handlers hôtes portent `skipPermission: true` et `defer: 'never'`, car leur politique est vérifiée dans l'extension. Ne pas remplacer cela par `approveAll` ou `--allow-all`.

Les MCP intégrés sont désactivés au lancement. Le runtime démarre dans un répertoire neutre avec configuration personnelle isolée. La découverte de configuration, les instructions natives, les hooks fichiers, les plugins, les skills natifs, les outils git natifs, la mémoire et le contrôle distant sont désactivés. Les instructions/skills demandés sont injectés explicitement par Feature Studio.

Avant **chaque premier prompt**, l'adaptateur appelle `session.tools.initializeAndValidate`, puis `session.tools.getCurrentMetadata`. Le catalogue doit contenir exactement les noms des handlers hôtes, l’outil de question humaine et les outils MCP explicitement sélectionnés avec leur provenance vérifiable. Toute absence d'introspection, catalogue inattendu ou erreur fait refuser l'exécution avant le prompt. Le handshake de protocole seul ne prouve pas les restrictions des champs SDK additionnels.

Avec des MCP, un contrôle supplémentaire atteste la politique native via `session.managedSettings.get` et désactive les approbations générales avec `session.permissions.configure`. Des règles exactes `Mcp(serveur/outil)` imposent la demande humaine quand les lectures automatiques sont désactivées ; le callback refuse les écritures et opérations non attestées en profil lecture seule. **Le CLI 1.0.63 ne fournit pas cette attestation et les runs MCP y sont refusés avant prompt.** Les sept scénarios natifs réussis sur le wrapper runtime SDK 1.0.96 et cette limite de compatibilité sont détaillés dans [MCP.md](MCP.md).

Dans ce SDK, omettre `onPermissionRequest` laisse les demandes en attente ; cela ne garantit pas un rejet immédiat. Le handler explicite est donc indispensable. Certaines pages de documentation décrivent encore l'ancien comportement.

Sources : [permissions CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/allowing-tools), [API TypeScript du SDK](https://github.com/github/copilot-sdk/blob/main/nodejs/README.md), [RPC officiel](https://github.com/github/copilot-sdk/blob/main/nodejs/src/generated/rpc.ts).

## Agents, skills et questions

Les agents CLI se définissent dans `.github/agents/*.agent.md` ou `~/.copilot/agents/*.agent.md`, avec frontmatter YAML et instructions Markdown. Leur `tools` est une liste de noms ; en l'absence de liste, le CLI accorde généralement tous les outils. Ce format d'échange n'est jamais utilisé comme autorisation d'exécuter des commandes arbitraires.

Feature Studio transmet le profil sélectionné au SDK comme `customAgents: [{ name, displayName, description, prompt, tools, infer: false }]`, puis `agent: 'feature-studio'`. Les règles et skills du kit sont chargés par l'hôte et ajoutés au prompt. Cela évite qu'un agent personnel prioritaire ou un MCP déclaré dans un fichier remplace les capacités de la tentative.

Dans une session native, `ask_user` transmet les questions au cockpit. Dans le régime historique, l’outil hôte `studio_ask_human` permet de poser une question pendant l’exécution et attend une vraie réponse du cockpit. L’annulation interrompt l’attente ; aucun accord ni réponse n’est simulé. Le contexte initial est fourni dans un formulaire avant chaque lancement manuel, puis enregistré avec son empreinte. Les instructions du rôle sont incluses une seule fois dans le prompt métier ; le custom agent ne reçoit qu’une enveloppe technique générique.

Un bloc final explicite reste disponible en repli, validé strictement :

````md
```feature-studio-questions
{"questions":[{"id":"scope","text":"Quel périmètre ?","choices":["Minimal","Complet"]}]}
```
````

La liste accepte au maximum 12 questions, identifiants uniques, textes non vides et 2 à 8 choix facultatifs. Le JSON arbitraire des livrables reste du contenu. Un bloc mal formé fait échouer la tentative au lieu de fabriquer des questions ou des réponses. Le prochain prompt contient les réponses humaines enregistrées. Dans le régime Studio historique, l'outil natif `ask_user` est exclu du catalogue ; aucun accusé inventé n'est renvoyé au modèle.

Sources : [agents personnalisés du CLI](https://docs.github.com/en/enterprise-cloud%40latest/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli), [agents via SDK](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/custom-agents).

## Flux, fin, annulation et reprise

`assistant.message_delta` alimente le flux visible. Seule la dernière réponse complète `assistant.message`, sans requêtes d'outils restantes, devient le livrable après `session.idle`. Un fragment isolé, un idle annulé ou une erreur de session ne deviennent pas un livrable réussi. Les événements d'outils, erreurs et compaction proviennent également du SDK.

L'annulation et le délai maximal appellent `session.abort()` et propagent un `AbortSignal` aux outils hôtes. Un simple timeout de `sendAndWait` ne suffit pas, puisqu'il cesse d'attendre sans arrêter le travail du runtime. Le transport est fermé avec une limite de nettoyage et `forceStop` en secours.

Les identifiants de session et événements de Feature Studio sont persistés par l'hôte. La conversation Copilot est conservée sous le `COPILOT_HOME` isolé, dans `session-state/<sessionId>`. Une reprise appelle `resumeSession` avec les handlers, filtres, hooks et configuration restrictive réappliqués. Le contexte supplémentaire inclut seulement les dernières tentatives des étapes actuellement approuvées ; les validations historiques de contenu périmé sont exclues.

`disconnect` préserve l'état ; `deleteSession` le détruit et n'est pas employé pour le nettoyage ordinaire. Le CLI 1.0.63 ne supporte pas `session.detach` utilisé par `disconnect` du SDK 1.0.20. L'adaptateur tente toujours `client.stop()` après ce rejet, puis utilise `forceStop` en secours, avec un nettoyage borné à 1,5 seconde. Les données de session ne sont pas supprimées.

Sur la recette réelle avec cette version, la reprise a retrouvé le prompt, l'appel d'outil et son résultat, mais pas le dernier message assistant dans le transcript natif récupéré. Feature Studio conserve le livrable final dans son stockage hôte et le réinjecte explicitement dans le prochain prompt de reprise. Cette compensation évite de dépendre exclusivement du dernier message sauvegardé par le CLI ; elle ne prouve pas que le transcript natif est toujours exhaustif.

Source : [sessions et persistance officielles](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/session-persistence).

## Usage et crédits

Les tokens et le modèle effectif sont affichés seulement s'ils figurent dans `assistant.usage`. `auto` reste un choix de routage ; il n'est pas présenté comme un modèle effectivement utilisé. Si l'événement est absent, l'usage reste inconnu plutôt que zéro.

`copilotUsage.totalNanoAiu`, lorsqu'il est présent, est conservé dans son unité **nano-AIU**. Ce n'est pas un coût en euros. Le champ historique `assistant.usage.cost` est un multiplicateur de modèle, pas un prix en monnaie, et n'est pas converti en montant. Les crédits AI ou demandes premium du compte dépendent de sa plateforme de facturation. `account.getQuota` existe pour consulter les snapshots sans prompt ; l'adaptateur ne transforme pas leurs valeurs en dépenses prédites.

Sources : [facturation et usage GitHub](https://docs.github.com/en/copilot/concepts/billing-and-usage), [événements SDK officiels](https://github.com/github/copilot-sdk/blob/main/nodejs/src/generated/session-events.ts).

## Vérifications locales du 13 octobre 2026

Sur cette machine : `/opt/homebrew/bin/copilot`, version **1.0.63**, protocole **3**. `ping` et `status.get` ont été vérifiés par JSON-RPC. `auth.getStatus` annonce une authentification utilisateur, y compris avec un `COPILOT_HOME` temporaire isolé. `models.list` renvoie actuellement uniquement `auto`. `account.getQuota` annonce les catégories `chat`, `completions` et `premium_interactions` avec les champs de quota et facturation par tokens.

Un préflight réel a créé une session neutre **sans aucun prompt** avec le SDK 1.0.20, un seul outil `studio_read_file` et l'agent `feature-studio`. `initializeAndValidate` puis `getCurrentMetadata` ont renvoyé uniquement cet outil ; `agent.getCurrent` a confirmé le profil actif.

Une recette distincte, avec **un seul prompt réel autorisé** dans une fixture de lecture seule, a confirmé la chaîne complète : authentification, catalogue restreint, appel réel à `studio_read_file`, lecture d'un marqueur aléatoire inconnu du prompt, flux de réponse, livrable final correct et validation du parcours jusqu'à `completed`. Le choix `auto` a réellement utilisé **gpt-5-mini**. Les événements ont mesuré **5 809 tokens entrants**, **376 sortants** et **154 185 000 nano-AIU**. La preuve est conservée dans [live-smoke.json](live-smoke.json) ; [smoke-copilot.ts](../scripts/smoke-copilot.ts) reste un script explicite consommant de l'usage, exclu des tests et de la CI ordinaires.

La session produite par cette recette a ensuite été reprise **sans nouveau prompt**. `session.getMessages`, via `getEvents`, a retrouvé les échanges et le résultat de lecture contenant le marqueur. L'agent `feature-studio` est resté sélectionné. Le catalogue a été revérifié avec exactement `studio_list_files`, `studio_read_file` et `studio_git_diff`, conformément au profil `read`. Le dernier message assistant n'a pas été retrouvé dans le transcript natif : voir la compensation hôte décrite ci-dessus. Les champs `resume` de la preuve distinguent ces résultats.

Les tests automatisés de `tests/adapter.test.ts` et `tests/mcp.test.ts` utilisent un transport injecté : flux, catalogue inattendu/inaccessible, questions, annulation, timeout, quota, reprise des restrictions, modèles indisponibles, exclusion des livrables périmés et arrêt du runtime même si la déconnexion native est rejetée. Ils n'appellent aucun modèle. La recette réelle confirme ce parcours de lecture précis ; elle ne constitue pas une mesure générale de qualité, de coûts ou de performance.

## Évolutions 0.2 : contexte, MCP et comptage

Le prompt métier est compilé de manière déterministe par `core/context.ts` : demande de feature, agent/skills, US de la tentative, mémoire explicitement cochée, derniers livrables approuvés, feedback et réponses humaines. Les descendants d’une étape rejouée sont exclus avant composition. Les instructions système et l’historique interne du SDK restent distincts de cet aperçu.

Les callbacks d’usage sont cumulés et dédupliqués par identifiant d’événement. Une mesure reçue avant erreur, timeout ou annulation reste persistée ; une fin sans usage ne l’efface pas. Les budgets comptent toutes les tentatives et suspendent les nouveaux appels si un seuil est atteint ou si une mesure requise reste inconnue. Les seuils ne peuvent garantir le coût d’un appel déjà en cours.

Le support MCP local, HTTP et SSE, l’authentification Azure DevOps et la preuve réelle sans prompt sont décrits dans [MCP.md](MCP.md). Aucun nouveau prompt payant n’a été nécessaire pour valider cette itération ; les résultats du smoke historique ci-dessus appartiennent à la livraison 0.1.


## Gros fichiers et édition partielle (0.3.2)

Les outils hôtes lisent les fichiers texte UTF-8 jusqu’à **4 Mio**, limite alignée sur les fichiers restaurables des checkpoints. Les fichiers binaires et UTF-8 invalides sont refusés explicitement. Aucun shell ni outil natif supplémentaire n’est autorisé.

- `studio_search` accepte un dossier ou un fichier. Il renvoie au plus 100 lignes correspondantes, avec des extraits centrés sur la correspondance. Pour un fichier, `startLine` permet de poursuivre la recherche. Les limites de scan, les résultats tronqués et les fichiers ignorés sont signalés. Une recherche n’autorise pas une écriture.
- `studio_read_file` accepte `startLine` et `endLine`, numérotés à partir de 1 et inclusifs. Sans plage, un petit fichier est rendu entièrement ; sinon, la lecture commence par 200 lignes. Une plage est limitée à 2 000 lignes et le contenu renvoyé à 64 000 octets, sans couper une ligne. Une ligne dépassant cette limite est refusée explicitement. `nextStartLine`, `totalLines`, `truncated` et l’empreinte `sha256` du **fichier entier** accompagnent le contenu exact.
- `studio_replace_text` reçoit `path`, `oldText`, `newText` et `expectedSha256`. L’ancien bloc doit être unique et entièrement couvert par les lectures de la version courante du fichier. Le remplacement est littéral : conserver les caractères et fins de ligne du contenu lu. La taille du résultat reste limitée à 4 Mio. Relire la zone après chaque modification avant une autre édition.

Les agents possédant la capacité `edit`, `write` ou `studio_write_file` reçoivent automatiquement le nouvel outil quand le profil permet l’écriture. Un profil en lecture seule ne le reçoit pas ; le profil Tests reste limité à ses dossiers. Il n’est pas nécessaire de réinstaller le kit. Recharger VS Code puis relancer l’étape renouvelle le catalogue d’outils.

Une lecture partielle ne permet jamais de remplacer le fichier complet avec `studio_write_file`. Les blocs ambigus, non lus ou basés sur une ancienne empreinte sont refusés. Les modifications humaines préexistantes restent protégées. Les écritures sont sérialisées avec les commandes de tests. Le remplacement partiel prépare un fichier temporaire voisin puis vérifie de nouveau le fichier avant son renommage ; il conserve les octets hors du bloc, notamment le BOM UTF-8 et les fins de ligne CRLF. Cela détecte les changements depuis la lecture, sans constituer un verrou exclusif contre les autres applications.

Parcours conseillé : rechercher `SyncUsers`, lire les lignes entourant la méthode, remplacer un bloc unique en utilisant l’empreinte retournée, puis relire la méthode.
