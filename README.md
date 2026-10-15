<p align="center"><img src="resources/icon.png" width="84" alt="Feature Studio"></p>

# Feature Studio

**Ton équipe d’agents Copilot, tes parcours, tes validations. Dans VS Code.**

Pars d’un besoin, choisis une équipe et avance étape par étape : challenge, plan, code, tests, relecture. Feature Studio rend visibles les instructions, le contexte, les permissions et les preuves de chaque agent. Tu peux personnaliser les parcours et emporter ta méthode dans un kit.

**[Dernière version et téléchargement](https://github.com/MattDevBzh/KerAI/releases/latest)** · [VSIX v1.4.0](https://github.com/MattDevBzh/KerAI/releases/download/v1.4.0/feature-studio-1.4.0.vsix) · [Nouveautés](CHANGELOG.md) · [Guide complet](docs/GUIDE.md)

**Version actuelle : 1.4.0.** Vingt avatars pixel art avec repos, travail animé et réussite, une fenêtre dédiée avec raccourci Windows, des sessions multi-projets et une équipe composable par glisser-déposer. [Toutes les nouveautés depuis la v1.1.1](docs/releases/v1.4.0.md).

![La bibliothèque des kits : Atelier Copilot et DevOps](docs/images/kits-library.png)

## Commencer

1. Télécharge le **[VSIX v1.4.0 de la release GitHub](https://github.com/MattDevBzh/KerAI/releases/download/v1.4.0/feature-studio-1.4.0.vsix)**.
2. Dans VS Code : **Extensions → … → Installer à partir du VSIX…**. Si une ancienne version tourne déjà, recharge la fenêtre.
3. Ouvre ton dépôt et approuve le workspace. Clique sur le **geek au portable** dans la barre latérale, puis **Ouvrir le cockpit** : Feature Studio s’ouvre dans sa fenêtre dédiée et enregistre ton projet.
4. Dans **Réglages**, clique sur **Vérifier la connexion** pour contrôler le CLI, le compte et les modèles disponibles.
5. Ouvre **Nouvelle session**, sélectionne tes projets et décris ton besoin. Compose ton équipe avec les avatars ou les équipes disponibles, puis prépare l’aperçu du contexte avant de lancer le premier agent.

Après mise à jour, la fiche **Feature Studio** dans Extensions doit afficher **1.4.0**. Pour contrôler le téléchargement, compare `Get-FileHash .\feature-studio-1.4.0.vsix -Algorithm SHA256` avec le fichier [SHA256SUMS de la release](https://github.com/MattDevBzh/KerAI/releases/download/v1.4.0/SHA256SUMS). Installe le fichier `.vsix` des assets de la release, sans le décompresser.

**Prérequis :** VS Code **1.110+**, Git et GitHub Copilot CLI installé et authentifié avec un accès au CLI. Le VSIX utilise le moteur Node de VS Code ; il ne nécessite pas une installation séparée de npm. L’extension utilise le CLI local et ton authentification Copilot. Elle possède son propre cockpit et peut coexister avec la vue Chat de GitHub Copilot.

Si le CLI est introuvable, renseigne `featureStudio.cliPath` dans les réglages VS Code. [Installation et diagnostic du CLI](docs/COPILOT.md). Les appels aux modèles utilisent ton quota Copilot ; consulter, configurer et exporter un kit ne lance aucun agent.

## Une bibliothèque pour tes équipes

L’écran **Kits** propose deux équipes prêtes à utiliser :

| Kit                 | Contenu                                                  | Usage                                                                 |
| ------------------- | -------------------------------------------------------- | --------------------------------------------------------------------- |
| **Atelier Copilot** | 4 parcours, 12 agents, 7 skills et leurs ressources      | Cadrer, développer, tester, relire et préparer la livraison           |
| **DevOps**          | 1 parcours, 6 agents, 8 skills et un script Azure DevOps | Challenger les changements CI/CD et IaC, puis vérifier un test manuel |

Les profils fournis sont immédiatement disponibles dans le cockpit. **Installer ce kit** les copie dans ton catalogue personnel Copilot, accessible depuis tes autres projets.

**Créer un kit** ouvre un sélecteur de parcours, agents et skills. Choisir un parcours ajoute ses agents ; choisir un agent ajoute ses skills. Les dépendances communes apparaissent une seule fois, avec la raison de leur présence. Tu peux retirer tes choix, consulter les instructions et vérifier tous les fichiers avant d’exporter.

Le fichier **`.fskit.json`** emporte les profils, parcours, scripts, références et licences nécessaires. **Importer un fichier** présente son contenu et les éventuels conflits. Les fichiers personnels différents restent préservés ; les connexions MCP, secrets et hooks actifs ne font pas partie du format. [Utilisation et format des kits](docs/KITS.md).

![Composer un kit avec ses dépendances automatiques](docs/images/kits-composer.png)

## Un parcours DevOps qui va jusqu’aux preuves

| Étape                    | Agent          | Résultat attendu                                                                        |
| ------------------------ | -------------- | --------------------------------------------------------------------------------------- |
| 1. Challenge             | **Éclaireur**  | Confronter ta demande au code DevOps du dépôt et proposer des alternatives              |
| 2. Plan technique        | **Architecte** | Planifier les changements avec les faits utiles d’Azure DevOps                          |
| 3. Modifications locales | **Bâtisseur**  | Modifier les fichiers selon le plan approuvé                                            |
| 4. Relecture             | **Vigie**      | Examiner le diff, ses risques et les chemins d’échec                                    |
| 5. Guide de test         | **Laborantin** | Décrire le test hors production, ses prérequis, ses résultats attendus et son nettoyage |
| 6. Vérification          | **Contrôleur** | Vérifier le test que tu as exécuté et ses résultats réels                               |

<p>
<img src="webview/public/avatars/business-analyst/idle.png" width="90" alt="Éclaireur">
<img src="webview/public/avatars/cloud-architect/idle.png" width="90" alt="Architecte au travail">
<img src="webview/public/avatars/devops-engineer/idle.png" width="90" alt="Bâtisseur">
<img src="webview/public/avatars/security-engineer/idle.png" width="90" alt="Vigie">
<img src="webview/public/avatars/qa-automation/idle.png" width="90" alt="Laborantin au travail">
<img src="webview/public/avatars/sre-engineer/idle.png" width="90" alt="Contrôleur après validation">
</p>

Les portraits sont transparents et cohérents dans tous les écrans. Chaque personnage dispose d’une pose de repos, d’un GIF de travail à quatre images et d’une pose de réussite. Les animations respectent la réduction des mouvements.

Le pilote s’arrête avant la dernière étape. **Tu mets en place et exécutes le test hors production**, puis fournis les références exactes : pipeline, build, commit, branche et résultats attendus. Le host contrôle ces références, les stages, les artefacts demandés et les tests publiés. Une affirmation de l’agent ne remplace pas ces preuves.

La skill **devops-azure-preflight** adapte **[azure-validate de Microsoft](https://github.com/microsoft/azure-skills/blob/5aa6e04819634ca4945ef57d6aa059eb4f5944e7/skills/azure-validate/SKILL.md)** : contrôles Bicep/Terraform/azd, identités, rôles et périmètres. Sa version, ses sources et sa licence sont embarquées. Elle sert au plan, à la relecture, au guide et à la validation.

Le collecteur vise **Azure DevOps Services / Azure Repos Git**. Il lit les données du dépôt configuré ; le kit ne déploie rien. L’isolation reste une déclaration humaine à confronter au guide : un build vert ne prouve pas à lui seul l’absence d’impact en production. [Parcours, connexion, script et limites](docs/DEVOPS-KIT.md).

## Garde la main sur le travail

- **Des parcours distincts.** Feature complète, relecture seule, session libre, recette visuelle et DevOps ; un éditeur permet d’ajouter, relier ou réordonner les étapes.
- **Un contexte relisible.** Inspecte et ajuste les blocs envoyés : demande, instructions, skills, livrables, mémoire et réponses humaines. Chaque lancement a son aperçu.
- **Un espace par feature.** Worktree isolé depuis un commit, branche dédiée et points de restauration. Les changements préexistants nécessitent une sélection explicite pour être repris.
- **Des validations visibles.** Livrables, questions, verdicts, preuves de tests et critères sont réunis. Le pilote s’arrête aux checkpoints et aux blocages.
- **Une équipe qui corrige avec toi.** Depuis un compte rendu ou une remarque, choisis où reprendre et inspecte le contexte transmis. L’éditeur conserve l’original, tes versions et les corrections du besoin. En fin de parcours, choisis **Valider définitivement** ou **Faire une correction** ; ta validation réussie déclenche la célébration d’équipe.
- **Des agents avec du répondant.** Active un roast léger, piquant ou sans pitié sur chaque profil. Les comptes rendus peuvent te taquiner ; les fichiers produits et les preuves restent précis.
- **Azure DevOps et livraison.** Tableaux PR/tickets, liens aux sessions et préparation de commit, push et PR. Les écritures distantes ont leur confirmation hôte.
- **Des profils personnalisables.** Agents et skills personnels ou propres au projet, vingt avatars de métiers, modèles découverts via le CLI, MCP et commandes de tests explicitement autorisés.
- **Un cockpit à ton goût.** Trois thèmes clairs, deux sombres, suivi de VS Code, contraste élevé et navigation adaptée aux petits écrans.

Les données de session restent dans le stockage local de l’extension. Le PAT Azure DevOps est conservé dans SecretStorage. Les capacités effectives dépendent des permissions de l’étape et de l’agent ; les commandes de tests autorisées s’exécutent sous ton compte. La consommation affiche uniquement les mesures fournies par le SDK, avec les données manquantes signalées. [Détails d’utilisation](docs/GUIDE.md).

## Documentation

| Besoin                                              | Guide                                                                   |
| --------------------------------------------------- | ----------------------------------------------------------------------- |
| Utiliser le cockpit, les profils et les validations | [Guide complet](docs/GUIDE.md)                                          |
| Installer, créer, importer ou exporter un kit       | [Kits](docs/KITS.md)                                                    |
| Travailler sur les pipelines et l’infrastructure    | [Kit DevOps](docs/DEVOPS-KIT.md)                                        |
| Créer un parcours                                   | [Workflows](docs/WORKFLOWS.md)                                          |
| Comprendre les worktrees et restaurations           | [Espaces Git](docs/WORKSPACES.md)                                       |
| Configurer Azure DevOps et préparer une livraison   | [Livraison](docs/devops-delivery.md)                                    |
| Connecter Copilot et des MCP                        | [Copilot](docs/COPILOT.md) · [MCP](docs/MCP.md)                         |
| Vérifier une interface avec Playwright              | [Kit de recette](defaults/quality/README.md)                            |
| Comprendre les mesures de consommation              | [Consommation](docs/consumption.md)                                     |
| Lire l’architecture et les résultats de recette     | [Architecture](docs/ARCHITECTURE.md) · [Validation](docs/VALIDATION.md) |

## Développer et vérifier

Node.js **22.12+** et npm sont nécessaires pour travailler sur les sources.

```sh
npm ci
npm run check           # Format, TypeScript, tests et builds
npx playwright install chromium
npm run test:ui         # Scénarios du cockpit dans Chromium
npm run test:extension  # Vrai hôte VS Code, profil temporaire isolé
npm run package         # releases/feature-studio-1.4.0.vsix
```

**F5 → Feature Studio** ouvre l’hôte de développement. `npm run dev` fournit le frontend ; `http://127.0.0.1:5173/?demo=1` affiche les données de démonstration. Les opérations de fichiers et l’exécution des agents nécessitent l’extension.

La [CI Linux et Windows](https://github.com/MattDevBzh/KerAI/actions/workflows/ci.yml) vérifie le code, l’interface, l’hôte VS Code et le packaging. La publication d’une nouvelle version depuis `main` attend la réussite des deux jobs ; elle vérifie l’intégrité ZIP, les versions du manifeste et du paquet, puis charge le contenu extrait du VSIX dans un vrai hôte VS Code. Le fichier publié est téléchargé à nouveau et son SHA-256 est contrôlé avant de rendre la release visible. Chaque nouvelle version doit fournir ses notes dans `docs/releases/v<version>.md` ; une release déjà publiée reste inchangée.

Les tests automatiques n’envoient aucun prompt Copilot payant. Les contrôles Azure DevOps utilisent des réponses simulées ; ils ne remplacent pas une recette sur ton compte. Le smoke Copilot réel est séparé et exige `FEATURE_STUDIO_LIVE_TEST=1`. Les résultats, plateformes et limites sont consignés dans [VALIDATION.md](docs/VALIDATION.md). Le VSIX actuel et son [SHA256SUMS](https://github.com/MattDevBzh/KerAI/releases/download/v1.4.0/SHA256SUMS) sont joints à la release ; le dossier [releases](releases/README.md) conserve les anciens paquets.

## Licence et provenance

Feature Studio est sous [licence MIT](LICENSE). Le kit Copilot d’origine est conservé avec son [inventaire et sa provenance](defaults/PROVENANCE.md). Les dépendances sont documentées dans [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), et les sources des avatars dans [design/avatars](design/avatars/professions/PROMPTS.md).


## Fenêtre dédiée et espaces de travail

Depuis la version 1.3.0, **Feature Studio : ouvrir le cockpit** ouvre directement toute l’interface dans un espace de travail personnel « Feature Studio ». Les autres dossiers ouverts dans VS Code restent indépendants. Rouvrir ce même espace retrouve sa fenêtre ; les barres latérales, onglets et panneau sont masqués uniquement dans cette fenêtre. Le moteur reste VS Code, avec sa barre de titre et ses dialogues natifs.

1. Dans **Réglages → Espaces de travail**, ajoutez vos dossiers de projets. Donnez-leur des noms distincts si nécessaire. Masquer un dossier le retire des prochaines sélections sans supprimer ses fichiers ni ses sessions.
2. Sous Windows, cliquez sur **Créer le raccourci Windows**. Le raccourci `Feature Studio.lnk` est créé sur le Bureau avec l’exécutable de l’édition en cours (Code ou Code Insiders). Il ouvre le cockpit complet. La commande du même nom est aussi disponible dans la palette.
3. À la création d’une session, cochez un ou plusieurs projets dans **Projets de la session**. La sélection et son ordre sont mémorisés. L’étoile désigne le projet principal, dont les profils, skills et connexions MCP complètent le catalogue utilisateur.
4. Une session à plusieurs projets travaille dans leurs dossiers d’origine. Les sessions à un seul projet peuvent conserver l’isolation en worktree. Les racines imbriquées ne peuvent pas être sélectionnées ensemble.
5. **Projet actif** change le projet affiché dans les réglages et les menus Azure DevOps / Livraison. Ouvrir une session retrouve automatiquement son projet principal. Chaque dépôt conserve ses propres réglages de tests, scripts et connexion Azure DevOps.

Les outils d’une session multi-projets demandent un `projectId` explicite. Les rapports et preuves distinguent les fichiers avec `@projectId/chemin`. Le panneau Git et les points de restauration proposent un choix de dépôt ; restaurer un point ne modifie que ce dépôt. Les branches enregistrées sont vérifiées avant exécution. Une opération à la fois réserve les dossiers concernés pour éviter les écritures concurrentes par plusieurs cockpits.

Le catalogue est conservé dans les données utilisateur de l’extension. En ouvrant le cockpit depuis une fenêtre de projet existante, ses dossiers sont enregistrés et son stockage de sessions existant est réutilisé. Si un dossier a d’abord été ajouté manuellement au nouveau catalogue, il conserve ce nouveau stockage. Aucun workflow, agent ou skill du projet n’est déplacé automatiquement.

Le menu natif du clic droit sur VS Code reste géré par Windows et VS Code. Vous pouvez épingler l’espace de travail « Feature Studio » lorsqu’il apparaît dans les éléments récents ; le raccourci du Bureau fonctionne indépendamment de cette liste. La réutilisation vise la même édition de VS Code et les mêmes données utilisateur. Une autre édition, un autre profil ou un environnement distant conserve son propre contexte. Le lancement natif Windows doit être vérifié sur le poste Windows ; les tests Linux couvrent le script généré et la configuration du cockpit.
