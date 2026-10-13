<p align="center"><img src="resources/icon.png" width="84" alt="Feature Studio"></p>

# Feature Studio

**Ton équipe d’agents Copilot, tes parcours, tes validations. Dans VS Code.**

Pars d’un besoin, choisis une équipe et avance étape par étape : challenge, plan, code, tests, relecture. Feature Studio rend visibles les instructions, le contexte, les permissions et les preuves de chaque agent. Tu peux personnaliser les parcours et emporter ta méthode dans un kit.

**[Dernière version et téléchargement](https://github.com/MattDevBzh/KerAI/releases/latest)** · [VSIX v1.0.0](https://github.com/MattDevBzh/KerAI/releases/download/v1.0.0/feature-studio-1.0.0.vsix) · [Nouveautés](CHANGELOG.md) · [Guide complet](docs/GUIDE.md)

![La bibliothèque des kits : Atelier Copilot et DevOps](docs/images/kits-library.png)

## Commencer

1. Télécharge le **[VSIX de la dernière version](https://github.com/MattDevBzh/KerAI/releases/latest)**.
2. Dans VS Code : **Extensions → … → Installer à partir du VSIX…**. Si une ancienne version tourne déjà, recharge la fenêtre.
3. Ouvre ton dépôt et approuve le workspace. Clique sur le **geek au portable** dans la barre latérale, puis **Ouvrir le cockpit**.
4. Dans **Réglages**, clique sur **Vérifier la connexion** pour contrôler le CLI, le compte et les modèles disponibles.
5. Ouvre **Nouvelle session**, choisis un parcours et décris ton besoin. Prépare l’aperçu du contexte avant de lancer le premier agent.

**Prérequis :** VS Code **1.110+**, Git et GitHub Copilot CLI installé et authentifié avec un accès au CLI. Le VSIX utilise le moteur Node de VS Code ; il ne nécessite pas une installation séparée de npm. L’extension utilise le CLI local et ton authentification Copilot. Elle possède son propre cockpit et peut coexister avec la vue Chat de GitHub Copilot.

Si le CLI est introuvable, renseigne `featureStudio.cliPath` dans les réglages VS Code. [Installation et diagnostic du CLI](docs/COPILOT.md). Les appels aux modèles utilisent ton quota Copilot ; consulter, configurer et exporter un kit ne lance aucun agent.

## Une bibliothèque pour tes équipes

L’écran **Kits** propose deux équipes prêtes à utiliser :

| Kit | Contenu | Usage |
| --- | --- | --- |
| **Atelier Copilot** | 4 parcours, 12 agents, 7 skills et leurs ressources | Cadrer, développer, tester, relire et préparer la livraison |
| **DevOps** | 1 parcours, 6 agents, 8 skills et un script Azure DevOps | Challenger les changements CI/CD et IaC, puis vérifier un test manuel |

Les profils fournis sont immédiatement disponibles dans le cockpit. **Installer ce kit** les copie dans ton catalogue personnel Copilot, accessible depuis tes autres projets.

**Créer un kit** ouvre un sélecteur de parcours, agents et skills. Choisir un parcours ajoute ses agents ; choisir un agent ajoute ses skills. Les dépendances communes apparaissent une seule fois, avec la raison de leur présence. Tu peux retirer tes choix, consulter les instructions et vérifier tous les fichiers avant d’exporter.

Le fichier **`.fskit.json`** emporte les profils, parcours, scripts, références et licences nécessaires. **Importer un fichier** présente son contenu et les éventuels conflits. Les fichiers personnels différents restent préservés ; les connexions MCP, secrets et hooks actifs ne font pas partie du format. [Utilisation et format des kits](docs/KITS.md).

![Composer un kit avec ses dépendances automatiques](docs/images/kits-composer.png)

## Un parcours DevOps qui va jusqu’aux preuves

| Étape | Agent | Résultat attendu |
| --- | --- | --- |
| 1. Challenge | **Éclaireur** | Confronter ta demande au code DevOps du dépôt et proposer des alternatives |
| 2. Plan technique | **Architecte** | Planifier les changements avec les faits utiles d’Azure DevOps |
| 3. Modifications locales | **Bâtisseur** | Modifier les fichiers selon le plan approuvé |
| 4. Relecture | **Vigie** | Examiner le diff, ses risques et les chemins d’échec |
| 5. Guide de test | **Laborantin** | Décrire le test hors production, ses prérequis, ses résultats attendus et son nettoyage |
| 6. Vérification | **Contrôleur** | Vérifier le test que tu as exécuté et ses résultats réels |

<p>
<img src="webview/public/avatars/devops-scout/idle.png" width="90" alt="Éclaireur">
<img src="webview/public/avatars/devops-architect/working.gif" width="90" alt="Architecte au travail">
<img src="webview/public/avatars/devops-builder/idle.png" width="90" alt="Bâtisseur">
<img src="webview/public/avatars/devops-sentinel/idle.png" width="90" alt="Vigie">
<img src="webview/public/avatars/devops-lab/working.gif" width="90" alt="Laborantin au travail">
<img src="webview/public/avatars/devops-controller/approved.png" width="90" alt="Contrôleur après validation">
</p>

Chaque nouvel avatar possède trois états : repos, travail animé et validation. Les animations respectent la réduction des mouvements.

Le pilote s’arrête avant la dernière étape. **Tu mets en place et exécutes le test hors production**, puis fournis les références exactes : pipeline, build, commit, branche et résultats attendus. Le host contrôle ces références, les stages, les artefacts demandés et les tests publiés. Une affirmation de l’agent ne remplace pas ces preuves.

La skill **devops-azure-preflight** adapte **[azure-validate de Microsoft](https://github.com/microsoft/azure-skills/blob/5aa6e04819634ca4945ef57d6aa059eb4f5944e7/skills/azure-validate/SKILL.md)** : contrôles Bicep/Terraform/azd, identités, rôles et périmètres. Sa version, ses sources et sa licence sont embarquées. Elle sert au plan, à la relecture, au guide et à la validation.

Le collecteur vise **Azure DevOps Services / Azure Repos Git**. Il lit les données du dépôt configuré ; le kit ne déploie rien. L’isolation reste une déclaration humaine à confronter au guide : un build vert ne prouve pas à lui seul l’absence d’impact en production. [Parcours, connexion, script et limites](docs/DEVOPS-KIT.md).

## Garde la main sur le travail

- **Des parcours distincts.** Feature complète, relecture seule, session libre, recette visuelle et DevOps ; un éditeur permet d’ajouter, relier ou réordonner les étapes.
- **Un contexte relisible.** Inspecte et ajuste les blocs envoyés : demande, instructions, skills, livrables, mémoire et réponses humaines. Chaque lancement a son aperçu.
- **Un espace par feature.** Worktree isolé depuis un commit, branche dédiée et points de restauration. Les changements préexistants nécessitent une sélection explicite pour être repris.
- **Des validations visibles.** Livrables, questions, verdicts, preuves de tests et critères sont réunis. Le pilote s’arrête aux checkpoints et aux blocages.
- **Azure DevOps et livraison.** Tableaux PR/tickets, liens aux sessions et préparation de commit, push et PR. Les écritures distantes ont leur confirmation hôte.
- **Des profils personnalisables.** Agents et skills personnels ou propres au projet, quatorze avatars, modèles découverts via le CLI, MCP et commandes de tests explicitement autorisés.
- **Un cockpit à ton goût.** Trois thèmes clairs, deux sombres, suivi de VS Code, contraste élevé et navigation adaptée aux petits écrans.

Les données de session restent dans le stockage local de l’extension. Le PAT Azure DevOps est conservé dans SecretStorage. Les capacités effectives dépendent des permissions de l’étape et de l’agent ; les commandes de tests autorisées s’exécutent sous ton compte. La consommation affiche uniquement les mesures fournies par le SDK, avec les données manquantes signalées. [Détails d’utilisation](docs/GUIDE.md).

## Documentation

| Besoin | Guide |
| --- | --- |
| Utiliser le cockpit, les profils et les validations | [Guide complet](docs/GUIDE.md) |
| Installer, créer, importer ou exporter un kit | [Kits](docs/KITS.md) |
| Travailler sur les pipelines et l’infrastructure | [Kit DevOps](docs/DEVOPS-KIT.md) |
| Créer un parcours | [Workflows](docs/WORKFLOWS.md) |
| Comprendre les worktrees et restaurations | [Espaces Git](docs/WORKSPACES.md) |
| Configurer Azure DevOps et préparer une livraison | [Livraison](docs/devops-delivery.md) |
| Connecter Copilot et des MCP | [Copilot](docs/COPILOT.md) · [MCP](docs/MCP.md) |
| Vérifier une interface avec Playwright | [Kit de recette](defaults/quality/README.md) |
| Comprendre les mesures de consommation | [Consommation](docs/consumption.md) |
| Lire l’architecture et les résultats de recette | [Architecture](docs/ARCHITECTURE.md) · [Validation](docs/VALIDATION.md) |

## Développer et vérifier

Node.js **22.12+** et npm sont nécessaires pour travailler sur les sources.

```sh
npm ci
npm run check           # Format, TypeScript, tests et builds
npx playwright install chromium
npm run test:ui         # Scénarios du cockpit dans Chromium
npm run test:extension  # Vrai hôte VS Code, profil temporaire isolé
npm run package         # releases/feature-studio-1.0.0.vsix
```

**F5 → Feature Studio** ouvre l’hôte de développement. `npm run dev` fournit le frontend ; `http://127.0.0.1:5173/?demo=1` affiche les données de démonstration. Les opérations de fichiers et l’exécution des agents nécessitent l’extension.

La recette locale de v1 compte **374 tests métier réussis**, **76 scénarios d’interface** et un smoke réussi dans VS Code Insiders. Trois tests spécifiques à Windows sont ignorés sur macOS. Les tests automatiques n’envoient aucun prompt Copilot payant. Les contrôles Azure DevOps utilisent des réponses simulées ; ils ne remplacent pas une recette sur ton compte. Le smoke Copilot réel est séparé et exige `FEATURE_STUDIO_LIVE_TEST=1`. Les résultats, plateformes et limites sont consignés dans [VALIDATION.md](docs/VALIDATION.md). Les VSIX livrés possèdent leurs empreintes dans [SHA256SUMS](releases/SHA256SUMS).

## Licence et provenance

Feature Studio est sous [licence MIT](LICENSE). Le kit Copilot d’origine est conservé avec son [inventaire et sa provenance](defaults/PROVENANCE.md). Les dépendances sont documentées dans [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), et les sources des avatars dans [design/avatars](design/avatars/PROMPTS.md).
