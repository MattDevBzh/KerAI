# Validation et limites — v0.2, 13 octobre 2026

## Vérifications de cette itération

| Périmètre | Preuve observée |
| --- | --- |
| TypeScript, format et builds | `npm run check` : hôte esbuild et webview Vite produits |
| Métier et intégration | **125 tests Vitest** : contexte/fingerprint, migration v2, pilote, budgets partiels, preuves, mémoire, questions, politique MCP, fichiers et persistance |
| Interface | **24 tests Playwright** : parcours existants, saisie d’US/MCP/aperçu, permissions humaines, secrets, pilote, validation, mémoire, workflows, mobile à 390 px et captures de démonstration |
| Vrai hôte VS Code | Activation et chargement React sous CSP, contexte initial/aperçu sans modèle, refus d’un lancement sans aperçu, MCP/SecretStorage, budget/pilote/mémoire, avatars, kit, fermeture/réouverture |
| CLI installé | Diagnostic réel depuis l’hôte : version 1.0.63, protocole 3, authentification et modèles, sans prompt |
| MCP, CLI installé | Découverte et catalogue exact sur 1.0.63 ; l’adaptateur final refuse les runs MCP avant prompt faute d’attestation de politique. Voir [mcp-smoke.json](mcp-smoke.json) |
| MCP, runtime SDK | **7 scénarios natifs** de permissions sur le wrapper runtime 1.0.96 : lectures automatiques/humaines, écritures autorisées/refusées, opération sans annotation ; zéro appel modèle. Voir [mcp-smoke-bundled.json](mcp-smoke-bundled.json) |
| Package | VSIX versionné dans `releases/`, empreinte SHA-256 et tests d’hôte sur son contenu extrait |
| Dépendances | `npm audit` : **aucune vulnérabilité signalée** à la date du contrôle |

Le cycle à cinq étapes est testé avec un adaptateur déterministe et les **vrais outils fichiers/runner local**, dont un test Node réellement exécuté. Le pilote s’arrête au checkpoint, repart après approbation humaine et exige une preuve hôte réussie pour valider automatiquement Tests. Les tests couvrent aussi l’arrêt à une question, l’annulation, les budgets, les remarques bloquantes, la mémoire invalidée par replay et les preuves devenues obsolètes. Tests et écritures hôtes partagent une file pour empêcher leur chevauchement.

Les aperçus compilent réellement les prompts à partir du contexte manuel, des agents/skills, des derniers livrables valides et de la mémoire choisie. Les parcours UI utilisent un bridge de test ; le vrai hôte VS Code vérifie séparément la validation des messages et la persistance. Aucune réponse d’agent simulée n’est présentée comme un run Copilot en production.

**Aucun prompt Copilot supplémentaire n’a été envoyé pour développer ou valider cette itération.** Les sous-agents de développement ont servi à répartir le travail de construction ; le produit n’ajoute pas de modèle orchestrateur ni de résumeur de mémoire. Une session démarrée par l’utilisateur consomme normalement son quota Copilot.

La recette IA réelle historique de v0.1 reste dans [live-smoke.json](live-smoke.json) : un seul prompt en lecture seule, lecture d’un marqueur inconnu par outil hôte, résultat exact, événements et usage mesurés. La reprise sans nouveau prompt a retrouvé l’échange et le résultat de lecture. Cela ne prouve ni l’accès Azure DevOps, ni la qualité d’une feature arbitraire développée entièrement par IA, ni un coût futur.

Versions locales : macOS arm64, Copilot CLI **1.0.63**, SDK **1.0.20**, VS Code Insiders **1.141.0**. Les restrictions sont vérifiées par capacités/catalogue, pas seulement par numéro de version. La CI [GitHub Actions](https://github.com/MattDevBzh/KerAI/actions) reprend format, TypeScript, tests métier, UI, vrai hôte VS Code Linux sous affichage virtuel et packaging sur chaque push. Le résultat d’un run est distinct d’une validation locale.

Le VSIX livré est vérifié par `releases/SHA256SUMS`. Le stockage des artefacts GitHub Actions ayant atteint son quota sur la première livraison, leur copie supplémentaire reste optionnelle (`FEATURE_STUDIO_UPLOAD_ARTIFACTS=true`). Les tests et le packaging sont toujours obligatoires.

## Limites à connaître

- Feature Studio ouvre un onglet indépendant du Chat Copilot natif. Un seul cockpit et une seule tentative par dossier sont autorisés. Les sessions sont liées à leur branche ; elles ne créent pas de worktree ou snapshot Git.
- Le MCP de l’organisation Azure DevOps de Matt n’a pas été connecté : son authentification et ses droits restent à tester par l’utilisateur. Le preset, la découverte locale, le catalogue et les contrôles de permissions sont distingués dans [MCP.md](MCP.md).
- Le CLI 1.0.63 ne fournit pas `session.managedSettings.get` : les sessions MCP sont bloquées avant prompt et nécessitent une mise à jour manuelle du CLI. La découverte et les sessions sans MCP restent compatibles. Les invocations natives ont été validées séparément sur le wrapper runtime SDK 1.0.96, qui n’est pas livré dans le VSIX ; elles ne constituent pas un test de la distribution CLI classique de même version ni un appel MCP piloté par un modèle. OAuth distant MCP n’est pas implémenté dans le cockpit.
- Les budgets contrôlent **la prochaine tentative**. Un run actif peut dépasser le seuil de tokens/nano-AIU. Une mesure partielle reste signalée comme incomplète et bloque les nouveaux appels si ce plafond est requis. Les nano-AIU ne sont pas des euros, et aucun plafond de facture n’est garanti.
- La mémoire est locale et injectée seulement sur choix explicite. Elle peut ajouter des tokens au prompt quand elle est sélectionnée. Son enregistrement, sa sélection et son aperçu n’appellent aucun modèle. L’aperçu ne comptabilise pas les instructions internes, outils et historique de reprise ajoutés par le SDK.
- Le pilote ne repart pas tout seul après une question, un redémarrage ou une erreur. Une tentative échouée/interrompue se reprend manuellement. Les corrections sont désactivées par défaut et leurs cycles se configurent explicitement.
- Une preuve de test porte sur la commande exécutée et les fichiers connus du host : fichiers lus pendant la tentative et fichiers modifiés par la feature. Ce n’est pas une empreinte exhaustive et immuable de tout le dépôt. Les diffs affichent **HEAD ↔ workspace courant**. Les critères et commentaires restent des validations humaines ; les constats du modèle ne prouvent pas l’exécution d’un test.
- Les agents n’ont aucun shell générique, commande Git d’écriture ou outil de publication fourni par l’hôte. Ils peuvent créer/modifier des fichiers et utiliser les tests/MCP explicitement autorisés. Les scripts, hooks et serveurs MCP approuvés sont des processus/services ordinaires, sans sandbox système ; leurs effets dépassent potentiellement les outils fichiers hôtes.
- Les écritures préexistantes, suppressions humaines, chemins sensibles et liens sont protégés. Le contrôle par empreinte détecte les modifications concurrentes ordinaires ; il ne protège pas contre tout programme local malveillant. Les fichiers de plus de 256 Ko et les binaires ne sont pas pris en charge. Liste, recherche, journaux et sorties sont bornés.
- L’arrêt conserve les changements déjà effectués. Le CLI 1.0.63 ne supporte pas `session.detach` ; le nettoyage se termine avec `forceStop` si nécessaire. Son transcript peut manquer le dernier message assistant : Feature Studio conserve le livrable dans son état et le réinjecte lors d’une reprise.
- Les modèles et niveaux de raisonnement sont ceux annoncés par le compte. La machine testée expose `auto` ; aucune liste fictive ni réduction de prix supposée n’est ajoutée. Les noms économie/équilibré/qualité sont des profils à configurer.
- Windows n’a pas été testé. Les tests/hooks emploient des exécutables natifs, pas les lanceurs `.cmd` avec le runner sans shell. Les connexions MCP dépendent aussi de leur serveur et de sa disponibilité sur la plateforme.
- Les modifications directes des agents/skills/workflows sont rechargées avec **Actualiser**. Un workflow existant conserve sa définition copiée. Le stockage migre v0/v1 vers v2, préserve les versions inconnues/corrompues et ne propose pas encore de synchronisation multi-machine ou d’import d’un export Markdown.

Les captures du README portent un bandeau **démonstration**. Les huit avatars pixel art et leurs GIF sont les mêmes assets que dans le VSIX ; leur provenance et leur reconstruction restent dans `design/avatars`.
