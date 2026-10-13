# Kit DevOps — v1.0.0

Dans **Parcours**, choisis **DevOps — du besoin au test vérifié**, ou duplique ce parcours pour le personnaliser. Ses six agents et huit skills sont disponibles dans le catalogue dès l’installation de l’extension. **Kits → DevOps → Voir le kit → Installer ce kit** les copie également dans `~/.copilot` (ou `COPILOT_HOME`) avec le script autonome. Cette installation conserve les fichiers existants et signale les conflits. [Créer et partager des kits](KITS.md).

## Le parcours

| Étape | Travail de l’agent | Livrable |
| --- | --- | --- |
| Challenge | Confronter la demande aux pipelines, templates, scripts et infrastructures du dépôt ; clarifier et proposer des alternatives | `devops-challenge.md` |
| Plan technique | Décrire les modifications et récupérer les données précises Azure DevOps utiles ; prévoir les critères et l’isolation du test | `devops-plan.md` |
| Modifications locales | Modifier les fichiers selon le plan et préserver les travaux existants | `devops-implement.md` |
| Relecture indépendante | Inspecter le diff réel, les appelants et les chemins d’échec ; rendre un verdict structuré | `devops-review.md` |
| Guide de test hors production | Donner les prérequis, commandes manuelles, résultats attendus, conditions d’arrêt et nettoyage | `devops-test-guide.md` |
| Validation du test | Après ton test manuel, lire les résultats et vérifier leur conformité au guide | `devops-validate.md` |

Seule l’étape Modifications locales peut écrire dans le workspace. Aucun de ces profils ne dispose d’un shell, de commandes de tests, d’un outil de déploiement ou de mutation Azure DevOps. Le code des pipelines et de l’IaC est modifiable dans les chemins autorisés ; `.github` et `.vscode` restent protégés par le host. L’agent doit expliquer toute modification manuelle nécessaire dans ces chemins.

La stratégie de test est prévue dès le plan, puis précisée sur le diff relu. Une branche ou un pipeline nommé « test » ne suffit pas à isoler des connexions, identités, backends Terraform, données ou registres partagés. Le guide doit relever les triggers CI, PR, planifiés et liés à d’autres pipelines, notamment avant un push manuel qui pourrait les déclencher.

## Réutilisation d’une skill existante

`devops-azure-preflight` adapte la skill [azure-validate de Microsoft, version 1.2.3](https://github.com/microsoft/azure-skills/blob/5aa6e04819634ca4945ef57d6aa059eb4f5944e7/skills/azure-validate/SKILL.md). Elle est associée aux agents et aux étapes **Plan**, **Relecture**, **Guide** et **Validation**, donc visible et modifiable dans **Skills** et dans l’aperçu de lancement. Les instructions utiles sont embarquées ; aucun accès au répertoire personnel de l’auteur ou plugin supplémentaire n’est nécessaire.

Elle apporte trois éléments : choix des contrôles Bicep/Terraform/azd selon le code, vérification de la correspondance **opération → identité → rôle → scope**, et tableau **commande → cible/effets → attendu → preuve réelle**. Elle distingue les contrôles syntaxiques, les aperçus distants et l’exécution du test. Un code Terraform 2 signifie des changements à examiner ; un stage vert ne prouve pas le contenu du plan.

L’adaptation conserve le parcours de Matt : les agents préparent et relisent, Matt exécute. Elle n’embarque pas les runners amont, ne déclenche pas de déploiement et n’impose pas un nouveau plan `.azure` aux projets qui n’en utilisent pas. Sans infrastructure Azure concernée, ces contrôles sont non applicables. La provenance, la révision amont, les empreintes des sources consultées et la licence MIT sont conservées dans le dossier de la skill.

Si tu as déjà installé ou personnalisé les profils de la v0.5.0, leurs copies restent prioritaires et ne sont pas écrasées. Ajoute **devops-azure-preflight** aux quatre agents ou étapes concernés depuis l’éditeur ; les sessions existantes conservent également leur parcours. Sur une installation neuve, les associations sont déjà fournies.

## Connexion et collecte

Configure **Azure DevOps** avec l’organisation, le projet et le dépôt concernés. Le jeton reste dans **SecretStorage**, jamais dans le prompt. Les lectures du kit nécessitent **Code (Read)** et **Build (Read)** ; ajoute **Test Management (Read)** pour les résultats de tests. Work Items sert au tableau de tickets. L’écriture Code est nécessaire pour la création de PR dans le menu Livraison, pas pour ce kit.

`studio_devops_inspect` expose des opérations bornées :

| Requête | Informations disponibles |
| --- | --- |
| `pipelines` | Définitions du dépôt, par pages de 50 |
| `pipeline` + `pipelineId`, `revision` facultative | Nom, révision, chemin YAML, branche par défaut, pool, triggers et noms/types secrets des variables |
| `builds` + `pipelineId` | Exécutions récentes du pipeline, par pages de 20 |
| `build` + `buildId` | Pipeline, SHA, branche, état, résultat et dates |
| `timeline` + `buildId` | Stages et tâches avec leur état et résultat |
| `artifacts` + `buildId` | Noms et types des artefacts, sans téléchargement |
| `test-runs` + `buildId` | Campagnes de tests liées au build, état et compteurs publiés |

Toutes les routes sont des GET fixés par le host. Une URL libre ou une action d’écriture est refusée. Les définitions et builds doivent appartenir au dépôt Azure Repos configuré ; les campagnes doivent référencer le build demandé. Les réponses portent une source et une date de collecte. Suivre `continuationToken` pour les listes ; `truncated: true` interdit de présenter une collecte comme complète.

Limites : 20 secondes par requête, 8 Mo de réponse brute ; jusqu’à 1 000 enregistrements de timeline, 50 artefacts ou 100 campagnes, et 48 000 caractères de données sélectionnées par observation. Le dépassement est explicite et bloque une validation complète. Les logs, valeurs des variables même non secrètes, secrets, URL de téléchargement et données d’authentification sont exclus. Les erreurs 401/403 et les données absentes ne sont pas transformées en listes vides.

## Mettre en place le test et le faire vérifier

1. Relis et approuve le guide. Configure les ressources/connexions de test, les droits et les déclencheurs indiqués. Effectue toi-même les opérations distantes prévues et lance le test.
2. Conserve les références : **ID du pipeline**, **ID du build**, **SHA complet**, **branche `refs/heads/...`**, **stages attendus**, éventuels **artefacts**, et résultats publiés si le test en produit.
3. Aligne manuellement le workspace de la session sur le commit effectivement testé. Les fichiers observés et modifiés doivent correspondre à ce commit. En cas de worktree isolé, c’est son HEAD qui est comparé. L’extension ne fait pas de fetch, checkout ou commit à cette étape.
4. Ouvre **Validation du test → Exécuter cette étape**. Remplis le formulaire, décris l’isolation mise en place et confirme que tu as exécuté le test hors production. Prépare l’aperçu puis lance l’agent. La confirmation est décochée à chaque nouvelle tentative.
5. Consulte le livrable et l’onglet **Preuves**. L’agent interprète les résultats face aux critères ; l’approbation finale reste soumise aux contrôles du moteur et aux critères humains existants.

Le pilote s’arrête avant cette étape même si ses checkpoints sont vides et si `askBeforeRun` est retiré. Le contrat est conservé par `requiredDevOpsEvidence` et par le profil `fs-devops-validate`. Les parcours personnalisés peuvent également activer **Exiger une preuve du test DevOps manuel** et donner au profil l’outil `studio_devops_verify_test`.

Cet outil ne reçoit aucun identifiant choisi par le modèle : il utilise la déclaration humaine du lancement. Le moteur exige le pipeline, le build, la branche et le commit déclarés, une exécution terminée `succeeded`, les stages attendus terminés `succeeded`, les artefacts demandés et, si sélectionnées, des campagnes non vides où tous les tests ont réussi. Un stage ignoré, un succès partiel, un mauvais SHA, une campagne vide ou une collecte incomplète bloque. Les contre-exemples peuvent être exprimés comme des assertions de tests réussies ; ce contrat ne valide pas un build globalement échoué comme succès attendu.

La preuve est rattachée à la feature et à la tentative, avec les observations et empreintes des fichiers. Le host compare le HEAD et les fichiers observés au commit testé, puis les revérifie à l’approbation. Une nouvelle référence saisie invalide l’aperçu. Un texte affirmant « tout va bien », un export JSON ou une preuve locale ordinaire ne remplace pas cette preuve. Une relecture structurée sans corrections est aussi nécessaire.

## Ce que le verdict couvre

Le contrôle hôte prouve les correspondances et résultats ci-dessus. **L’isolation est une déclaration humaine** que l’agent confronte au guide et aux preuves fournies ; un build réussi n’établit pas à lui seul l’absence d’impact en production. Les permissions Azure effectives, contenus d’artefacts, ressources déployées, résultats fonctionnels non publiés et journaux exclus demandent des preuves supplémentaires. Aucun contrôle ne promet une validation universelle de l’infrastructure.

Le parcours par défaut vise **Azure DevOps Services / Azure Repos Git**. Les pipelines dont le dépôt source est GitHub, les releases classiques et Azure DevOps Server ne sont pas couverts par le collecteur. Les cinq premières étapes restent utiles depuis le code local ; la dernière ne peut pas inventer des preuves pour ces systèmes. Aucun serveur MCP ni hook n’est activé par l’ajout du kit.

## Script autonome

Après installation utilisateur :

```sh
node ~/.copilot/skills/devops-inspect/scripts/ado-readonly.cjs --help
node ~/.copilot/skills/devops-inspect/scripts/ado-readonly.cjs \
  --organization mon-org --project MonProjet --repository MonDepot \
  --query '{"kind":"pipeline","pipelineId":42}'
```

Remplace les valeurs par les références exactes. Pour `COPILOT_HOME`, adapte le chemin. Node 22+ suffit : aucune dépendance à installer. Le PAT doit être disponible via `AZURE_DEVOPS_EXT_PAT`, avec les mêmes droits de lecture ; ne le mets pas dans les arguments ou fichiers du dépôt.

`--verify chemin/test-target.json` lit un objet avec `buildId`, `pipelineId`, `commit`, `branch`, `environment`, `isolationConfirmed`, `expectedStages`, `expectedArtifacts`, `requireTestResults`. Le script imprime les faits distants en JSON ; codes de sortie : 0 pour collecte complète/contrôles réussis, 1 pour erreur/échec, 2 pour collecte incomplète. Il ne vérifie pas le workspace local et son export reste une source externe pour l’extension.

Le source canonique est `src/host/devopsCli.ts`, avec `DevOpsInspector.ts` pour le collecteur partagé. `npm run build` régénère le script distribué dans la skill. Les fichiers de `defaults/kit/` et leur manifeste d’origine sont préservés.

## Références API vérifiées

- [Définitions de pipelines — Get, API 7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/build/definitions/get?view=azure-devops-rest-7.1)
- [Builds — Get, API 7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/build/builds/get?view=azure-devops-rest-7.1)
- [Timeline — Get, API 7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/build/timeline/get?view=azure-devops-rest-7.1)
- [Campagnes de tests — List, API 7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/test/runs/list?view=azure-devops-rest-7.1)
