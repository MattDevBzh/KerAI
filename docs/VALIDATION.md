# Validation et limites — v1.2.0 locale, 14 octobre 2026

## Vérifications locales de v1.2.0

- Format, TypeScript, tests et builds réussis : **436 tests métier**, 4 ignorés (3 propres à Windows et le contrôle explicite du catalogue CLI 1.0.96 réservé à la CI).
- **91 scénarios Chromium** réussis, dont 4 nouveaux scénarios de rapport, aperçu, budget, source, export, suppression et petit écran. Le rendu du rapport a été inspecté sur desktop et à 390 px ; le débordement des boutons de session a été corrigé.
- **17 tests spécifiques** de l’Observateur et du stockage : couverture de toutes les phases, snapshot immuable, empreintes et références inventées, annulation et coûts conservés, limites de budget, valeurs inconnues, plus de 3 000 événements, messages longs UTF-8, secrets masqués, refus de liens, migration v4 → v5, suppression d’un journal tronqué, nettoyage après crash et préservation des checkpoints partagés.
- Smoke réussi dans un vrai hôte **VS Code Insiders**, profil temporaire : activation/CSP, commande et profil Observateur, préparation locale d’un dossier et consultation du stockage sans modèle, persistance v5, contrôles Git/checkpoints et parcours existants.

Les tests d’analyse utilisent un adaptateur Copilot simulé et de vrais fichiers temporaires. Ils vérifient les contrats, la comptabilité et les contrôles d’accès ; ils ne constituent pas une mesure de qualité sur un compte Copilot réel. Aucun prompt payant ni opération distante Azure DevOps n’a été exécuté. Les crédits des fixtures ne sont pas une facture réelle. Le contrôle natif de suppression est couvert par le protocole et l’UI simulée ; sa confirmation reste une interaction humaine.

Le package préparé localement est `releases/feature-studio-1.2.0.vsix`, avec son empreinte dans `releases/SHA256SUMS`. Il n’a pas été publié. Le nouveau stockage v5 refuse les anciens binaires ; les données antérieures connues sont migrées, les traces déjà perdues restent explicitement manquantes.


## Vérifications locales de v1.1.1

La relecture statique indépendante d’Astra medium a identifié trois défauts dans la v1.1.0 : anciennes empreintes d’écriture utilisées comme état courant, redirection du pilote hors de la correction sélectionnée et réinjection de remarques décochées. Sol 6.1 high a corrigé ces chemins, puis Astra a validé le correctif sans nouveau défaut substantiel dans ce périmètre. Son verdict est une revue de code, distincte des tests exécutés.

- Format et TypeScript réussis ; **419 tests métier** réussis, 4 ignorés dans cette suite locale pour les raisons détaillées ci-dessous.
- **87 scénarios d’interface** réussis.
- **7 nouveaux cas de régression** réussis : 4 parcours indépendants avec de vrais outils hôtes/fichiers et 3 contrôles des écritures historiques, de leur ordre et de la portée de validation.
- Le contenu extrait du VSIX a passé le smoke dans un vrai hôte VS Code Insiders. Deux premiers lancements se sont terminés avec le code 1 sans diagnostic d’assertion ; le lancement instrumenté a réussi. La cause de ces deux échecs initiaux n’est pas établie. Le test peut conserver son résultat ou son erreur dans le fichier choisi par `FEATURE_STUDIO_SMOKE_DIAGNOSTICS`.

Le parcours réel des outils de fichiers vérifie qu’un développeur peut écrire un test, que le testeur peut le compléter, exécuter une assertion Node, puis valider et terminer la session. Les modifications extérieures restent refusées. Le même scénario est vérifié sur une session ancienne dépourvue de table d’empreintes courantes et avec un parcours dont l’ordre de stockage diffère de l’ordre d’exécution. Les preuves de tests hôtes restent contrôlées contre leurs fichiers et les preuves DevOps contre leur commit.

Le pilote suspend une correction qui demanderait de rejouer une étape conservée. Le contexte conserve uniquement les remarques sélectionnées figées et les nouvelles remarques pertinentes de l’étape ; décocher une remarque bloquante ne résout pas le blocage global. Les snapshots et preuves historiques restent conservés.

Le paquet livré est `releases/feature-studio-1.1.1.vsix`. Les versions précédentes et leurs empreintes restent dans l’historique.

## Vérifications locales de v1.1.0

Cette version ajoute l’édition des comptes rendus et du besoin, les corrections ciblées, la décision finale humaine, le roast par agent et la célébration d’équipe. Le développement et les validations indépendantes ont été répartis entre trois agents Sol 6.1 avec effort high, puis intégrés et vérifiés sur macOS avec Node 24.1.0.

| Périmètre                   | Résultat observé                                                                                                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format, TypeScript et build | `npm run check` réussi                                                                                                                                                                 |
| Métier et intégration       | **412 tests Vitest réussis**, 4 ignorés : 3 propres à Windows et le contrôle explicite du catalogue CLI 1.0.96 exécuté en CI                                                           |
| Interface Chromium          | **87 scénarios Playwright réussis**, dont 10 nouveaux scénarios de correction, édition, roast et décision finale                                                                       |
| Validation indépendante     | 9 tests d’intégration et 3 scénarios UI indépendants : branches conservées, ancien contexte écarté, versions éditées, reprise et preuves physiques à la finalisation                   |
| Vrai hôte VS Code Insiders  | Smoke réussi dans un profil temporaire : activation/CSP, profils roast personnel/projet, refus d’une décision finale prématurée, catalogue, Git, points de restauration et persistance |
| Rendu                       | Équipe en poses de validation inspectée ; éditeur et contexte de correction contrôlés sur petit écran ; mouvement réduit et préférence d’animation vérifiés                            |

Les tests de service utilisent un adaptateur Copilot simulé et de vrais fichiers temporaires, les messages d’interface sont contrôlés avec un pont hôte simulé. Aucun prompt Copilot payant ni opération Azure DevOps réelle n’est exécuté. La qualité du roast interprété par un modèle et le parcours sur un compte réel restent à éprouver pendant l’utilisation.

Les contre-exemples ont corrigé la reprise depuis un rapport devenu obsolète après édition du besoin, l’entraînement d’une branche indépendante, la réinjection d’anciens rapports décochés ou réponses, la poursuite après une validation intermédiaire et la fermeture d’un cycle terminé. Le contrôle final refuse également une preuve dont les fichiers ont été modifiés en dehors du cockpit.

Le schéma de stockage **4** conserve les versions et les cycles ; les versions 0 à 3 migrent. Les anciennes sessions terminées sans décision finale humaine explicite attendent cette décision. Les anciens binaires refusent ce schéma et ne peuvent pas réécrire silencieusement les nouveaux historiques. Le VSIX est conservé dans `releases/feature-studio-1.1.0.vsix` avec son empreinte dans `releases/SHA256SUMS`.

![Validation finale et célébration de l’équipe — données de recette simulées](images/final-validation.png)

La CI du commit poussé est une preuve distincte de cette recette locale ; son résultat est consultable dans [GitHub Actions](https://github.com/MattDevBzh/KerAI/actions/workflows/ci.yml).

## Vérifications locales de v1.0.0

Cette version réunit le kit DevOps, ses six avatars et l’écran de composition/import/export des kits. Recette exécutée sur macOS, Node 24.1.0 et VS Code Insiders 1.141.0.

| Périmètre                   | Résultat observé                                                                                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format, TypeScript et build | `npm run check` réussi                                                                                                                                               |
| Métier et intégration       | **374 tests Vitest réussis**, 3 spécifiques à Windows ignorés sur macOS                                                                                              |
| Interface Chromium          | **76 scénarios Playwright réussis**, dont les trois parcours de la bibliothèque de kits et les deux du kit DevOps                                                    |
| Vrai hôte VS Code Insiders  | Smoke réussi : activation, CSP, catalogue DevOps, six identités d’avatars et leurs 18 fichiers, installation utilisateur, profils, persistance, Git et restaurations |
| Rendu                       | Bibliothèque et composition inspectées à 1440 px ; import avec conflit contrôlé à 390 px sans débordement                                                            |
| Avatars DevOps              | Six sprites source inspectés, exports PNG 192×192 et GIF de travail à quatre images vérifiés                                                                         |
| Ressources de skills        | Huit skills DevOps validées ; licence Microsoft et provenance vérifiées et embarquées                                                                                |

La première CI Windows a révélé un défaut de comparaison entre chemins avec `/` et `\` : l’installation des ressources associées ne préservait pas l’exclusion du profil en cours d’édition, provoquant un refus de sauvegarde. La comparaison est normalisée et un test de non-régression vérifie les deux séparateurs. Les assertions des rapports d’installation utilisent les chemins natifs de chaque plateforme.

Les nouveaux tests utilisent le vrai `KitService` avec des répertoires temporaires : sélection transitive, ressources partagées personnalisées, export de fichier et réimport, installation puis relecture du registre, conflits apparus après aperçu, révisions multiples, kit sauvegardé invalide, checksum erroné, dépendance ou référence locale absente, collision fichier/dossier, chemins interdits et liens symboliques. Les boîtes de dialogue natives de choix de fichiers sont remplacées par un pont dans les scénarios Chromium ; leurs opérations de fichiers et leur validation métier sont réelles. Le smoke VS Code couvre l’activation et le catalogue, sans pilote UI des boîtes natives.

Les lectures Azure DevOps restent testées avec des fixtures HTTP : **aucun test sur un compte Azure DevOps réel ni prompt Copilot payant n’a été lancé pour cette recette**. L’isolation effective du test hors production exige la préparation humaine et les preuves du projet concerné. Voir [les limites du validateur](DEVOPS-KIT.md#ce-que-le-verdict-couvre).

La CI configure Node 22 sous Linux et Windows, vérifie les empreintes des VSIX livrés, puis exécute les suites prévues dans `.github/workflows/ci.yml`. Son résultat distant est consultable dans [GitHub Actions](https://github.com/MattDevBzh/KerAI/actions/workflows/ci.yml) ; les résultats locaux ci-dessus ne s’y substituent pas. La release v1.0.0 fournit le VSIX et son empreinte de téléchargement.

Les validations des versions antérieures restent ci-dessous comme historique.

## Vérifications locales de v0.5.1

Le kit comprend désormais huit skills. `devops-azure-preflight` adapte `azure-validate` 1.2.3 de Microsoft aux étapes de plan, relecture, guide et validation, avec sources figées et licence MIT embarquée.

| Périmètre du complément                 | Résultat observé                                                                                                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TypeScript                              | `npm run typecheck` réussi                                                                                                                                                                       |
| Registre, migration, contexte et DevOps | **50 tests Vitest ciblés réussis** ; injection unique de la nouvelle skill dans le contexte des quatre étapes, avant et après installation utilisateur ; copie de sa licence et de sa provenance |
| Interface du parcours DevOps            | **2 scénarios Playwright réussis** : duplication et lancement manuel avec contrat de preuve                                                                                                      |
| Skills                                  | **8 skills validées** avec `quick_validate.py`                                                                                                                                                   |

La recette complète de la v0.5.0 figure ci-dessous ; le complément porte sur les ressources du kit et leurs associations. Aucune commande IaC n’a été exécutée pour cette adaptation, et son interprétation par un modèle sur un projet Azure réel reste à éprouver. Les profils utilisateur existants restent prioritaires : les associations à ajouter sont expliquées dans [Kit DevOps](DEVOPS-KIT.md).

## Vérifications locales de v0.5.0

Le kit DevOps apporte six agents, sept skills, un parcours et un script autonome partageant le collecteur en lecture seule avec l’extension. Le test hors production est mis en place et exécuté manuellement, puis sa vérification exige des références humaines et des preuves hôte.

| Périmètre                   | Résultat observé                                                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format, TypeScript et build | `npm run check` réussi                                                                                                                               |
| Métier et intégration       | **363 tests Vitest réussis**, 3 ignorés sur cette plateforme ; dont 18 nouveaux scénarios DevOps                                                     |
| Interface                   | **73 scénarios Playwright réussis**, dont les nouveaux parcours de duplication et de lancement DevOps ; formulaire contrôlé à 390 px                 |
| Skills et script            | Sept skills validées avec `quick_validate.py` ; copie utilisateur du script réellement exécutée avec `--help`, conflits personnels conservés         |
| Vrai hôte VS Code Insiders  | Smoke réussi, avec présence des six étapes DevOps et du validateur dans le catalogue ; installation utilisateur et parcours hôtes existants vérifiés |

Les fixtures HTTP vérifient les routes GET, le périmètre du dépôt, l’absence des valeurs de variables et des URL de téléchargement, la pagination, les données tronquées et les erreurs de droits. Les cas négatifs couvrent mauvais pipeline/SHA/branche, stage ignoré ou échoué malgré un build vert, reprise de stage échouée, absence d’artefact ou de tests, résultats partiels et incohérence des fichiers locaux. Les tests d’intégration couvrent la persistance, le rattachement de la preuve à la tentative, le contrat de relecture, l’arrêt du pilote et l’invalidation de l’aperçu.

Les réponses Azure DevOps sont des fixtures : **aucun compte Azure DevOps réel ni prompt Copilot payant n’a été utilisé pour cette recette**. Les droits réels du PAT et l’interprétation du guide par un modèle restent à éprouver sur ton projet. Cette validation locale ne constitue ni une exécution CI ni une publication distante. Les limites du contrôle d’isolation et des données collectées sont détaillées dans [Kit DevOps](DEVOPS-KIT.md).

Les anciennes sessions restent lisibles. Les nouveaux champs du parcours et des preuves nécessitent la v0.5.0 pour rouvrir les sessions DevOps ; les anciens binaires ne connaissent pas ce contrat.

## Vérifications locales de v0.4.4

La version 0.4.4 remplace l’avatar frontal par un geek de trois quarts devant un ultrabook. L’illustration en couleur apparaît dans un petit volet local ; sa déclinaison SVG monochrome reste dans la barre d’activité.

| Périmètre                   | Résultat observé                                                                                                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format, TypeScript et build | `npm run check` réussi                                                                                                                                                                                                                                  |
| Métier et intégration       | **345 tests Vitest réussis**, 3 tests spécifiques Windows ignorés sur macOS                                                                                                                                                                             |
| Volet d’accueil             | **16 cas Chromium réussis** sur le HTML réel du provider, avec pont VS Code simulé : 200/320 px, clair/sombre et classes de contraste élevé, avec/sans projet ; image locale chargée sous CSP, absence de débordement, focus et activation clavier/clic |
| Vrai hôte VS Code Insiders  | Vue ouverte, image et script réellement chargés sous CSP nonce, état métier et DevOps non initialisés avant l’ouverture du cockpit ; double ouverture dédupliquée et parcours hôtes existants vérifiés                                                  |
| Assets                      | Illustration PNG transparente inspectée dans le volet ; icône SVG de trois quarts inspectée à 24, 48 et 192 px sur fonds clair et sombre                                                                                                                |

Le pont du volet accepte seulement `ready` et `open`, sans commande, URL ni arguments injectables. Le choix entre ouverture du cockpit et ouverture d’un dossier dépend du workspace courant côté hôte. Les tests couvrent les changements de dossier, la fermeture et la résolution répétée d’une vue, ainsi que l’inactivité des anciens callbacks après remplacement ou destruction. Les ressources sont limitées au dossier local `resources`, avec scripts/styles autorisés uniquement par nonce et connexions réseau interdites.

La source imagegen, son prompt et la provenance de l’adaptation SVG sont conservés dans `design/cockpit-avatar` et `design/cockpit-icon.md`. Le PNG livré est un export de 448 px avec transparence conservée. Aucun prompt Copilot payant ni appel au compte Azure DevOps réel n’a été effectué pendant la recette ; l’illustration a été créée séparément avec imagegen. Cette validation est locale, sans nouvelle CI ni essai Windows. Les fichiers du cockpit React et ses dépendances n’ont pas changé ; sa dernière campagne complète reste celle de v0.4.2.

## Vérifications locales de v0.4.3

La version 0.4.3 ajoute le raccourci **Feature Studio** à la barre d’activité, son icône de geek au portable en pixel art et le volet natif **Cockpit**. La recette locale du 13 octobre 2026 donne les résultats suivants :

| Périmètre                   | Résultat observé                                                                                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format, TypeScript et build | `npm run check` réussi                                                                                                                                     |
| Métier et intégration       | **341 tests Vitest réussis**, 3 tests spécifiques Windows ignorés sur macOS                                                                                |
| Vrai hôte VS Code Insiders  | Activation par `featureStudio.launcher.focus`, vue native visible, magasin et DevOps non initialisés, cockpit non ouvert à la simple consultation du volet |
| Ouverture du cockpit        | Deux commandes simultanées créent un seul onglet ; une ouverture ultérieure réutilise cet onglet ; les parcours hôtes existants restent vérifiés           |
| Icône                       | SVG original sur grille 24 × 24, transparent et monochrome ; rendus inspectés sur fonds clair et sombre à 24, 48 et 192 px                                 |

Le smoke vérifie les contributions et la ressource réellement chargées par l’extension, ainsi que les deux accueils déclarés : **Ouvrir le cockpit** avec un dossier et **Ouvrir un dossier** sans projet. L’affichage réel du volet a été vérifié avec un projet par le test d’hôte. Le Mac s’étant verrouillé avant la recette manuelle, le clic physique dans la barre d’activité et l’accueil sans dossier n’ont pas été inspectés manuellement. Les fichiers React/CSS n’ont pas changé ; la campagne Playwright de v0.4.2 ci-dessous reste la dernière recette du cockpit web.

Aucun prompt Copilot payant ni appel au compte Azure DevOps réel n’a été effectué. Cette recette locale ne confirme aucune nouvelle exécution CI, aucun essai Windows ni publication distante. Les dépendances n’ont pas changé.

## Vérifications locales de v0.4.2

La version 0.4.2 ajoute les thèmes clairs **Aube, Brume et Sauge**, les thèmes sombres **Minuit et Forêt** et le choix **Suivre VS Code** dans les Réglages. La recette locale du 13 octobre 2026 donne les résultats suivants :

| Périmètre                   | Résultat observé                                                                                                                                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format, TypeScript et build | `npm run format:check`, `npm run typecheck` et `npm run build` réussis                                                                                                                                            |
| Métier et intégration       | **341 tests Vitest réussis**, 3 tests spécifiques Windows ignorés sur macOS                                                                                                                                       |
| Interface                   | **71 scénarios Playwright réussis**, dont 8 consacrés aux thèmes                                                                                                                                                  |
| Rendu visuel                | Cinq palettes capturées en Réglages et sur le dashboard à 1440 et 390 px ; contrôle visuel et absence de débordement                                                                                              |
| Accessibilité               | Navigation clavier avec sauvegarde différée et focus conservé ; contrastes des paires de texte vérifiées ≥ 4,5:1 et bordures de contrôles ≥ 3:1 ; modes contraste élevé clair/sombre et couleurs forcées couverts |
| Vrai hôte VS Code Insiders  | Six choix enregistrés dans un profil utilisateur isolé, ordre des écritures, modification externe et réouverture vérifiés ; index Git et état des sessions conservés                                              |

Les tests d’interface utilisent les couleurs natives de VS Code dans les deux sens : thème personnel clair avec éditeur sombre, et thème personnel sombre avec éditeur clair. Le contraste élevé garde la priorité sans effacer la préférence. Les erreurs de sauvegarde conservent le choix précédent ; la préférence reste indépendante des brouillons et des agents en cours. Le protocole accepte uniquement les six identifiants et l’écriture cible les réglages personnels, sans fichier de configuration dans le projet. La démonstration ne conserve le choix que pendant sa session.

Les contrôles de contraste portent sur les éléments et paires vérifiés, sans constituer une certification d’accessibilité exhaustive. Aucun prompt Copilot payant ni appel au compte Azure DevOps réel n’a été effectué. Cette recette locale ne confirme aucune nouvelle exécution CI, aucun essai Windows ni publication distante. Les dépendances n’ont pas changé. Les résultats des versions précédentes restent historiques.

## Vérifications locales de v0.4.1

La version 0.4.1 ajoute les sous-menus permanents **PR** et **Tickets** à Azure DevOps, leurs tableaux dédiés et les métadonnées facultatives récupérées dans les appels existants. La recette locale du 13 octobre 2026 donne les résultats suivants :

| Périmètre                   | Résultat observé                                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Format, TypeScript et build | `npm run check` réussi                                                                                                                                                               |
| Métier et intégration       | **336 tests Vitest réussis**, 3 tests spécifiques Windows ignorés sur macOS                                                                                                          |
| Interface                   | **63 scénarios Playwright réussis** lors de la campagne complète, dont 8 nouveaux scénarios dédiés aux dashboards ; les 5 anciens parcours Azure DevOps restent inchangés            |
| Rendu visuel                | PR et Tickets inspectés dans Chromium à 1440 et 390 px ; thèmes clair et contrastés, mouvement réduit, absence de débordement et navigation clavier à 800×600 couverts par les tests |
| Vrai hôte VS Code Insiders  | Activation React sous CSP, configuration Azure DevOps hors ligne et réouverture, inspection Git, profils, reporter et protections des worktrees vérifiés sur les sources compilées   |

Les scénarios couvrent la navigation persistante, les brouillons conservés, la recherche et le tri, les liens vers les features, les commentaires chargés à la demande, les métadonnées inconnues et les listes partielles. Les compteurs distinguent un tableau non chargé d’un tableau vide. Un filtre dont l’état disparaît après actualisation reste explicite. Les transitions de configuration, de déconnexion et de remplacement de jeton effacent les données de l’ancien compte ; une actualisation ordinaire échouée conserve le dernier tableau reçu.

Les fixtures Azure DevOps sont déterministes : aucun compte réel n’a été contacté et aucun prompt Copilot payant n’a été envoyé pour cette recette. Elle ne confirme ni les droits du PAT, ni les politiques de fusion, ni une publication distante. Les dépendances n’ont pas changé. Les preuves v0.4.0 ci-dessous restent historiques.

## Vérifications locales de v0.4.0

La recette a été exécutée sur macOS le 13 octobre 2026. Les résultats ci-dessous concernent le lot 0.4.0 ; les preuves historiques v0.3 restent séparées.

| Périmètre                     | Résultat observé                                                                                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Format, TypeScript et build   | `npm run check` réussi ; vérification de format et reconstruction après les dernières corrections d’interface                                                                                                                                    |
| Métier et intégration         | **312 tests Vitest réussis**, 3 tests spécifiques Windows ignorés sur macOS                                                                                                                                                                      |
| Interface                     | **55 scénarios Playwright vérifiés** : 54 lors de la campagne complète, puis le scénario de navigation à 800×600 après correction de son assertion ; recette visuelle des trois nouveaux menus à 1440, 800 et 390 px                             |
| Vrai hôte VS Code Insiders    | Activation React sous CSP, configuration ADO hors ligne conservée après réouverture, inspection Git et index humain intact, priorité personnel/projet et copies conservées, installation explicite du reporter, worktrees et restauration ciblée |
| Recette Playwright du produit | Parcours réel Chromium avec formulaire local, capture et trace ZIP ; collecte hôte liée aux critères et refus des rapports inconnus, périmés, incomplets ou du mauvais type                                                                      |
| Dépendances de production     | `npm audit --omit=dev --audit-level=low` : aucune vulnérabilité signalée à la date du contrôle                                                                                                                                                   |

Les tests portent notamment sur les alias physiques de chemins (y compris Unicode sur le disque macOS), les réponses liées à leur question exacte, les critères devenus obsolètes, les diffs depuis un sous-dossier Git, la pagination/exclusion, les scopes de profils, les mesures et les preuves qualité. Les tests Azure DevOps utilisent une API simulée et les tests de livraison des dépôts Git temporaires ; ils ne confirment ni droits PAT ni push/PR sur le compte réel. Aucun prompt payant n’a été envoyé. L’organisation et le projet restent à configurer depuis le menu. Aucune nouvelle exécution CI ou Windows ni publication distante n’est attestée par cette recette locale.

Le package local cible `releases/feature-studio-0.4.0.vsix`. Son empreinte est enregistrée dans `releases/SHA256SUMS` ; la recette de livraison inclut l’inspection de ses ressources et le chargement de son contenu extrait dans le vrai hôte VS Code.

La recette qualité cible d’abord les applications web locales disposant de Playwright. L’installation explicite du reporter, une commande approuvée et les dépendances/navigateurs préparés par l’utilisateur sont nécessaires. Les contre-exemples possèdent une étape indépendante dans `quality-feature`. Une preuve hôte vérifie l’exécution et les rapports fournis ; elle ne garantit pas la qualité de toute application. [Reporter et limites](../defaults/quality/README.md).

Les opérations de Livraison ne font aucun appel modèle. Chaque commit, push et création de PR demande sa propre confirmation hôte après aperçu. Les tests déterministes ne constituent pas une autorisation ni une preuve de publication. [Contrat Git et ADO](devops-delivery.md).

## Vérifications historiques de v0.3

| Périmètre                        | Preuve observée                                                                                                                                                                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript, format et builds     | `npm run check` : hôte esbuild et webview Vite produits                                                                                                                                                                                       |
| Métier et intégration            | **158 tests Vitest** : vrais dépôts/worktrees, protection de l’index source, restauration et exclusions, migration v3, contexte/fingerprint, pilote, budgets, preuves, mémoire, politique MCP et persistance                                  |
| Interface                        | **35 tests Playwright** : création isolée, points/diffs/restauration, cycle réel des états hôtes de comparaison, sélection/confirmation, clavier/mobile, parcours MCP, pilote, validation, mémoire et workflows                               |
| Vrai hôte VS Code                | Activation React sous CSP, contexte/MCP/SecretStorage, worktree depuis HEAD, source/index intacts, diff snapshot, refus de buffer non enregistré, restauration ciblée puis récupération, refus d’empreinte obsolète, fermeture/réouverture v3 |
| CLI installé                     | Diagnostic réel depuis l’hôte : version 1.0.63, protocole 3, authentification et modèles, sans prompt                                                                                                                                         |
| MCP, CLI installé (recette v0.2) | Découverte et catalogue exact sur 1.0.63 ; l’adaptateur refuse les runs MCP avant prompt faute d’attestation de politique. Voir [mcp-smoke.json](mcp-smoke.json)                                                                              |
| MCP, runtime SDK (recette v0.2)  | **7 scénarios natifs** de permissions sur le wrapper runtime 1.0.96 : lectures automatiques/humaines, écritures autorisées/refusées, opération sans annotation ; zéro appel modèle. Voir [mcp-smoke-bundled.json](mcp-smoke-bundled.json)     |
| Package                          | VSIX versionné dans `releases/`, empreinte SHA-256 et tests d’hôte sur son contenu extrait                                                                                                                                                    |
| Dépendances                      | `npm audit` : **aucune vulnérabilité signalée** à la date du contrôle                                                                                                                                                                         |

Le cycle à cinq étapes est testé avec un adaptateur déterministe et les **vrais outils fichiers/runner local**, dont un test Node réellement exécuté. Le pilote s’arrête au checkpoint, repart après approbation humaine et exige une preuve hôte réussie pour valider automatiquement Tests. Les tests couvrent aussi l’arrêt à une question, l’annulation, les budgets, les remarques bloquantes, la mémoire invalidée par replay et les preuves devenues obsolètes. Tests et écritures hôtes partagent une file pour empêcher leur chevauchement.

Les tests Git utilisent des dépôts temporaires réels. Ils vérifient le checkout de HEAD sans recopier les changements stagés/non stagés/non suivis, l’index source inchangé, les hooks et filtres Git neutralisés, l’environnement Git indépendant et les chemins UTF-8 exacts. Les outils, hooks et tests sont exécutés dans le worktree de la feature ; les preuves sont revérifiées à cette même racine. Les points avant/après couvrent aussi les tentatives échouées et annulées.

La restauration couvre ajouts, modifications, suppressions, binaires et permissions, les fichiers précédemment exclus/ignorés, les limites de taille, la persistance du point de récupération avant écriture, un échec de cette persistance et une édition humaine injectée après la synchronisation du temporaire. Une restauration invalide les validations et permet un nouvel essai sans attribuer à l’agent une modification humaine ultérieure. Les tests de concurrence modélisent le verrou de la fenêtre source pendant toute sa vie et celui du worktree pendant son utilisation.

Les aperçus compilent réellement les prompts à partir du contexte manuel, des agents/skills, des derniers livrables valides et de la mémoire choisie. Les parcours UI utilisent un bridge de test ; le vrai hôte VS Code vérifie séparément la validation des messages et la persistance. Aucune réponse d’agent simulée n’est présentée comme un run Copilot en production.

**Aucun prompt Copilot supplémentaire n’a été envoyé pour développer ou valider cette itération.** Les sous-agents de développement ont servi à répartir le travail de construction ; le produit n’ajoute pas de modèle orchestrateur ni de résumeur de mémoire. Une session démarrée par l’utilisateur consomme normalement son quota Copilot.

La recette IA réelle historique de v0.1 reste dans [live-smoke.json](live-smoke.json) : un seul prompt en lecture seule, lecture d’un marqueur inconnu par outil hôte, résultat exact, événements et usage mesurés. La reprise sans nouveau prompt a retrouvé l’échange et le résultat de lecture. Cela ne prouve ni l’accès Azure DevOps, ni la qualité d’une feature arbitraire développée entièrement par IA, ni un coût futur.

Versions locales : macOS arm64, Copilot CLI **1.0.63**, SDK **1.0.20**, VS Code Insiders **1.141.0**. Les restrictions sont vérifiées par capacités/catalogue, pas seulement par numéro de version. La CI [GitHub Actions](https://github.com/MattDevBzh/KerAI/actions) reprend format, TypeScript, tests métier, UI, vrai hôte VS Code Linux sous affichage virtuel et packaging sur chaque push. Le résultat d’un run est distinct d’une validation locale.

Le VSIX livré est vérifié par `releases/SHA256SUMS`. Le stockage des artefacts GitHub Actions ayant atteint son quota sur la première livraison, leur copie supplémentaire reste optionnelle (`FEATURE_STUDIO_UPLOAD_ARTIFACTS=true`). Les tests et le packaging sont toujours obligatoires.

## Limites à connaître

- Feature Studio ouvre un onglet indépendant du Chat Copilot natif. Un cockpit par racine et une tentative à la fois dans ce cockpit sont autorisés. Les nouvelles sessions peuvent créer leur worktree ; les anciennes restent dans le dossier courant. La création exige la racine Git et un commit HEAD. Seul le contenu commité est copié : dépendances, LFS/smudge et modifications locales demandent une préparation explicite.
- Les points capturent des fichiers, sans commit Git, staging ou index. Limites : 4 MiB par fichier, 64 MiB de contenus et 10 000 entrées par point. Les ignorés non suivis, secrets usuels, configurations et liens sont exclus. La restauration est ciblée et peut être partielle en cas d’échec tardif ; son point de récupération reste disponible. Les buffers non enregistrés sont vérifiés uniquement dans la fenêtre courante. Les modifications sur disque sont recontrôlées, sans sandbox système. [Contrat détaillé](WORKSPACES.md).
- Le MCP de l’organisation Azure DevOps de Matt n’a pas été connecté : son authentification et ses droits restent à tester par l’utilisateur. Le preset, la découverte locale, le catalogue et les contrôles de permissions sont distingués dans [MCP.md](MCP.md).
- Le CLI 1.0.63 ne fournit pas `session.managedSettings.get` : les sessions MCP sont bloquées avant prompt et nécessitent une mise à jour manuelle du CLI. La découverte et les sessions sans MCP restent compatibles. Les invocations natives ont été validées séparément sur le wrapper runtime SDK 1.0.96, qui n’est pas livré dans le VSIX ; elles ne constituent pas un test de la distribution CLI classique de même version ni un appel MCP piloté par un modèle. OAuth distant MCP n’est pas implémenté dans le cockpit.
- Les budgets contrôlent **la prochaine tentative**. Un run actif peut dépasser le seuil de tokens/nano-AIU. Une mesure partielle reste signalée comme incomplète et bloque les nouveaux appels si ce plafond est requis. Les nano-AIU ne sont pas des euros, et aucun plafond de facture n’est garanti.
- La mémoire est locale et injectée seulement sur choix explicite. Elle peut ajouter des tokens au prompt quand elle est sélectionnée. Son enregistrement, sa sélection et son aperçu n’appellent aucun modèle. L’aperçu ne comptabilise pas les instructions internes, outils et historique de reprise ajoutés par le SDK.
- Le pilote ne repart pas tout seul après une question, un redémarrage ou une erreur. Une tentative échouée/interrompue se reprend manuellement. Les corrections sont désactivées par défaut et leurs cycles se configurent explicitement.
- Une preuve de test porte sur la commande exécutée et les fichiers connus du host : fichiers lus pendant la tentative et fichiers modifiés par la feature. Ce n’est pas une empreinte exhaustive et immuable de tout le dépôt. Le diff de fichiers affiche **HEAD ↔ dossier de la feature** ; le panneau des points compare aussi **point ↔ dossier actuel** et **point ↔ point**. Les critères et commentaires restent des validations humaines ; les constats du modèle ne prouvent pas l’exécution d’un test.
- Les agents n’ont aucun shell générique, commande Git d’écriture ou outil de publication fourni par l’hôte. Ils peuvent créer/modifier des fichiers et utiliser les tests/MCP explicitement autorisés. Les scripts, hooks et serveurs MCP approuvés sont des processus/services ordinaires, sans sandbox système ; leurs effets dépassent potentiellement les outils fichiers hôtes.
- Les écritures préexistantes, suppressions humaines, chemins sensibles et liens sont protégés. Le contrôle par empreinte détecte les modifications concurrentes ordinaires ; il ne protège pas contre tout programme local malveillant. Les outils de lecture paginée et de remplacement exact sont bornés à 4 MiB par fichier UTF-8 ; le remplacement intégral reste borné à 256 Ko et les binaires ne sont pas éditables par ces outils ; les points de restauration ont leur propre limite de 4 MiB et peuvent conserver des binaires. Liste, recherche, journaux et sorties sont bornés.
- L’arrêt conserve les changements déjà effectués. Le CLI 1.0.63 ne supporte pas `session.detach` ; le nettoyage se termine avec `forceStop` si nécessaire. Son transcript peut manquer le dernier message assistant : Feature Studio conserve le livrable dans son état et le réinjecte lors d’une reprise.
- Les modèles et niveaux de raisonnement sont ceux annoncés par le compte. La machine testée expose `auto` ; aucune liste fictive ni réduction de prix supposée n’est ajoutée. Les noms économie/équilibré/qualité sont des profils à configurer.
- Windows n’a pas été testé. Les tests/hooks emploient des exécutables natifs, pas les lanceurs `.cmd` avec le runner sans shell. Les connexions MCP dépendent aussi de leur serveur et de sa disponibilité sur la plateforme.
- Les modifications directes des agents/skills/workflows sont rechargées avec **Actualiser**. Un workflow existant conserve sa définition copiée. Le stockage migre v0/v1/v2 vers v3, préserve les versions inconnues/corrompues et ne propose pas de migration inverse, synchronisation multi-machine ou import d’un export Markdown. La v0.2 refuse les données v3. Archiver ne supprime ni worktree ni points sur disque ; leur nettoyage automatique n’est pas implémenté.

Les captures du README portent un bandeau **démonstration**. Les huit avatars pixel art et leurs GIF sont les mêmes assets que dans le VSIX ; leur provenance et leur reconstruction restent dans `design/avatars`.
