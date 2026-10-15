# Changelog

## 1.4.1 — 2026-10-15

- Adopte le logo « L’équipe » dans la fiche de l’extension, le lanceur, l’onglet et le cockpit. Ajoute une déclinaison monochrome pour la barre d’activité VS Code.
- Applique automatiquement une icône Windows contenant sept tailles lors de la création ou recréation du raccourci. Sa copie dans le stockage du cockpit reste indépendante du dossier versionné de l’extension.
- Joint l’ICO à la release avec le VSIX et vérifie les deux empreintes après téléchargement. Conserve le rendu source approuvé et le script de génération des formats d’icône.

## 1.4.0 — 2026-10-15

- Remplace les portraits par une collection de vingt métiers, dans le style pixel art validé : vue de face, silhouettes et accessoires distincts et fond réellement transparent.
- Agrandit les portraits du sélecteur et adapte les libellés aux écrans étroits. Harmonise les listes, équipes, kits et célébrations.
- Conserve les anciens identifiants d’avatars des profils et kits via des correspondances de présentation, sans réécrire les fichiers personnels.
- Conserve une animation GIF à quatre images pour le travail en cours et une pose de réussite distincte ; respecte la réduction des mouvements.

## 1.3.1 — 2026-10-15

- Synchronise le projet actif avec la sélection mémorisée lors de l’ouverture du formulaire de création ; affiche l’enregistrement en cours et aligne le sélecteur sur les pages.
- Affiche le nom personnalisé du projet dans la barre latérale.

## 1.3.0 — 2026-10-15

- Ouvre le cockpit complet dans une fenêtre dédiée réutilisable, indépendante du dossier ouvert dans les autres fenêtres VS Code. Ajoute la création d’un raccourci Windows sur le Bureau.
- Ajoute un catalogue personnel d’espaces de travail dans les réglages : ajout de dossiers, renommage, masquage du sélecteur et choix du projet actif. Les dossiers et personnalisations restent en place.
- Permet de choisir plusieurs projets par session et mémorise la dernière sélection. L’historique réunit les sessions des projets enregistrés ; chaque session conserve ses racines et branches.
- Route explicitement les lectures, éditions, diff Git, tests, scripts, preuves et sauvegardes vers le projet choisi. Les modifications locales restent protégées et les points de restauration portent sur un dépôt identifié.
- Conserve le worktree isolé pour les sessions à un seul projet. Les sessions multi-projets travaillent dans les dossiers sélectionnés.

## 1.2.1 — 2026-10-15

- Corrige la largeur du panneau de composition pour afficher davantage d’agents côte à côte sur grand écran.

## 1.2.0 — 2026-10-15

- Crée les nouvelles features sans équipe et ouvre directement leur fiche. Le brouillon reste disponible après fermeture.
- Ajoute un panneau de composition par glisser-déposer des avatars ou des équipes, sans limite fixe d’interventions : ordre, duplication, retrait, rôle, permissions, modèle et réflexion. Les modèles d’équipes restent inchangés.
- Autorise la modification de la composition jusqu’à la première tentative ; vérifie le verrouillage et la révision côté extension.
- Ajoute les favoris personnels, partagés entre projets et affichés en premier dans les catalogues et sélecteurs.

## 1.1.2 — 2026-10-15

- Permet de préparer l’aperçu du contexte lorsqu’une skill configurée est absente : son identifiant et son origine sont affichés dans un bloc décochable. Le lancement reste bloqué si une skill absente est incluse ; une exclusion explicite permet de continuer sans cette compétence.
- Recharge le catalogue lors de l’aperçu et du lancement afin de prendre en compte les skills installées ou retirées manuellement.

## 1.1.1 — 2026-10-14

- Corrige la validation d’un fichier repris légitimement par une étape suivante : les empreintes des écritures historiques sont distinguées de l’état courant, avec contrôle des preuves de tests et des modifications extérieures conservé.
- Empêche la boucle de correction automatique de relancer une étape hors du périmètre choisi. Un élargissement nécessite une nouvelle sélection humaine.
- Respecte les remarques décochées dans le contexte de correction, y compris dans les blocs de contexte génériques.

## 1.1.0 — 2026-10-14

- Ajoute les corrections ciblées depuis un compte rendu ou une remarque de relecture : choix des étapes de départ, aperçu de l’équipe à rejouer et contexte transmis. Le cycle conserve son historique et respecte les validations, permissions et limites habituelles.
- Réunit la correction du compte rendu et du besoin initial dans un éditeur avec aperçu, original de l’agent et versions humaines conservées. Les modifications invalident les validations concernées ; une sauvegarde obsolète est refusée.
- Sépare la validation des étapes de la décision finale : « Valider définitivement » termine la session, « Faire une correction » relance la partie concernée. Le pilote attend cette décision humaine.
- Ajoute le mode roast par agent, désactivé par défaut, avec trois niveaux : léger, piquant et sans pitié. Le choix est conservé dans les profils et les kits ; les documents professionnels et rapports structurés restent sobres.
- Célèbre la validation finale avec les personnages de l’équipe dans le style des kits, une animation courte et un replay explicite. Les effets respectent la réduction des mouvements.

## 1.0.6 — 2026-10-14

- Livraison : boutons « Générer le titre du commit » et « Valider le commit » près du champ titre. La validation accepte un titre saisi ou modifié sans étape de ré-aperçu, vérifie le dépôt et conserve la confirmation VS Code ainsi que la sélection explicite des fichiers. Le push reste une action distincte.

## 1.0.5 — 2026-10-14

- Corrige la sauvegarde des parcours : les YAML sont désormais enregistrés au niveau utilisateur avec les agents et les skills, sous `~/.copilot/feature-studio/workflows` (ou `COPILOT_HOME`). Les anciens fichiers du projet ne sont ni déplacés ni supprimés automatiquement.

## 1.0.4

- Encadré de crédits du compte Copilot dans le lanceur, actualisé toutes les 10 secondes lorsqu’il est visible, sans appel au modèle. Les quotas absents ou non exprimés en crédits restent indisponibles.
- Consommation des sessions, budgets, tableaux et exports affichés en crédits ; conservation des mesures historiques et des seuils internes en nano-AIU.

## 1.0.3 — 2026-10-14

- Rend accessibles les pipelines, templates et scripts du dossier `.azure` du projet : ils étaient masqués par une exclusion globale destinée aux données Azure CLI.
- Conserve le refus des identifiants, caches MSAL, profils, configuration et journaux Azure CLI, ainsi que des fichiers de secrets habituels. Vérifie l’inventaire, la recherche, la lecture et l’édition ciblée d’un YAML suivi par Git.

## 1.0.2 — 2026-10-14

- Corrige le faux refus « Chemin hors du dépôt » dans le menu Azure DevOps sous Windows : l’inspection Git compare désormais les chemins canoniques, y compris lorsqu’un alias de dossier est utilisé. Les chemins réellement extérieurs au dépôt restent refusés.
- Le message d’aide ne présente plus systématiquement une erreur locale Git comme une erreur de connexion ou de formulaire.

## 1.0.1 — 2026-10-14

- Corrige le lancement de la team DevOps avec Copilot CLI 1.0.96 : le schéma de paramètres de `studio_devops_inspect` est désormais un objet accepté par le CLI. Les combinaisons de paramètres restent strictement validées avant toute lecture Azure DevOps.
- Détaille les outils manquants, inattendus ou dupliqués et le chemin du CLI en cas de refus du catalogue. Supprime le conseil systématique de mise à jour, qui ne permettait pas d’identifier ce défaut de schéma.

## 1.0.0 — 2026-10-13

- Corrige la sauvegarde de profils fournis sous Windows : l’installation des ressources associées exclut le profil en cours d’édition avec les deux séparateurs de chemin.
- Ajoute l’écran Kits : bibliothèque Atelier Copilot / DevOps, import local, composition par parcours/agent/skill, résolution transitive des dépendances, aperçu des instructions et fichiers, export `.fskit.json` puis installation utilisateur.
- Inclut les scripts, références et licences des profils choisis. Vérifie le format, les empreintes, les chemins et les dépendances ; conserve les fichiers personnels différents. Plusieurs révisions d’un kit restent accessibles et un fichier invalide est signalé sans bloquer la bibliothèque.
- Livre le parcours DevOps à six agents, huit skills, son collecteur Azure DevOps en lecture seule et la vérification du test exécuté manuellement. Réutilise la méthode Microsoft azure-validate avec provenance et licence embarquées.
- Ajoute six avatars DevOps distincts, chacun avec repos, animation de travail et validation, intégrés aux agents et au sélecteur de personnalisation.
- Recompose le README autour de l’installation, des kits et du parcours DevOps, avec captures et lien vers la dernière release. Le guide détaillé reste disponible dans `docs/GUIDE.md`.

## 0.5.1 — 2026-10-13

- Réutilise la skill Microsoft `azure-validate` 1.2.3 dans une adaptation autonome `devops-azure-preflight`, reliée aux étapes de plan, relecture, guide et validation.
- Ajoute les contrôles Bicep/Terraform/azd, la correspondance opérations-identités-rôles-scopes et les preuves attendues, en conservant l’exécution manuelle du test.
- Embarque la licence MIT et la provenance exacte des sources ; vérifie l’injection de la skill et sa copie utilisateur.

## 0.5.0 — 2026-10-13

- Ajoute le kit DevOps : six agents, sept skills, un parcours fourni et un script autonome de collecte Azure DevOps en lecture seule.
- Prépare les critères et l’isolation dès le plan, puis détaille le guide de test après relecture des modifications locales.
- Expose des outils hôtes GET pour les définitions, builds, timelines, noms d’artefacts et résultats de tests du dépôt configuré, avec sources, pagination et limites explicites ; les valeurs de variables, logs et URL de téléchargement restent exclus.
- Arrête le pilote avant la validation du test manuel. Le formulaire humain fixe pipeline, build, SHA, branche, stages, artefacts et besoin de résultats de tests ; une preuve hôte complète, cohérente avec le workspace, et une relecture structurée sont exigées pour approuver.
- Conserve ces preuves et leurs limites dans la session. L’installation utilisateur du kit préserve les personnalisations et fournit le même collecteur sous forme de script Node autonome.

## 0.4.4 — 2026-10-13

- Remplace le geek frontal par un avatar en pixel art plus soigné, vu de trois quarts devant un ultrabook, avec une déclinaison monochrome assortie pour la barre d’activité.
- Affiche l’avatar en couleur dans le volet d’accueil et conserve l’ouverture du cockpit existant ou d’un dossier. Le volet reste indépendant des sessions et des appels modèle.

## 0.4.3 — 2026-10-13

- Ajoute une entrée Feature Studio à la barre d’activité de VS Code, avec un geek au portable en pixel art et un volet natif pour ouvrir le cockpit existant. Sans projet, le volet propose d’ouvrir un dossier.
- Garde le volet indépendant des sessions et des appels modèle ; les commandes et le bouton de barre d’état restent disponibles.
- Évite la création de plusieurs onglets si le cockpit est demandé plusieurs fois pendant son ouverture.

## 0.4.2 — 2026-10-13

- Ajoute trois thèmes clairs — Aube (crème et corail), Brume (bleu et ardoise), Sauge (vert et lin) — et deux thèmes sombres — Minuit (bleu et indigo), Forêt (vert et cuivre) — en plus du mode automatique Suivre VS Code.
- Ajoute un sélecteur de six cartes en haut de Réglages. Le choix s’applique après confirmation de son enregistrement, sans redémarrage, et persiste dans le réglage utilisateur VS Code `featureStudio.appearance.theme`, sans écriture projet ni invalidation du travail en cours.
- Donne priorité au contraste élevé de VS Code tout en conservant la préférence choisie. La démonstration permet un aperçu pendant la session sans enregistrer de préférence.

## 0.4.1 — 2026-10-13

- Ajoute les sous-menus Azure DevOps **PR** et **Tickets**, toujours visibles et utilisables sans session active, avec accès à la configuration même sans connexion. Le menu parent conserve son aperçu.
- Ajoute deux tableaux dédiés avec compteurs, recherche, filtres par état et lien feature, tri par date, numéro ou titre, et états de chargement, d’erreur et de liste partielle explicites.
- Enrichit les cartes PR avec auteur, dates, description et relecteurs lorsqu’ils sont disponibles ; les cartes tickets présentent type, dates, tags, itération, zone, description, critères et commentaires chargeables. Les cartes conservent les liens Azure DevOps et les actions sur les features liées. Les votes restent indicatifs et ne remplacent pas les politiques de validation Azure DevOps.
- Conserve les filtres pendant la navigation, signale un état filtré disparu après actualisation et les réinitialise au changement de périmètre. Efface les données, dates et limites de l’ancien compte après déconnexion ou remplacement du jeton ; une simple actualisation échouée conserve les dernières données reçues.

## 0.4.0 — 2026-10-13

- Ajoute les menus Azure DevOps et Livraison utilisables sans session active : configuration organisation/projet/dépôt, PAT dans SecretStorage, tickets et PR du compte, liens persistés vers les features.
- Prépare des commits sur une sélection explicite de fichiers complets en préservant le staging des autres fichiers. Commit, push sans force et PR brouillon ont chacun leur aperçu et leur confirmation hôte. Le profil Markdown de livraison expose des règles `delivery-rules` déterministes ; ces opérations et la conversation locale ne font aucun appel modèle.
- Ajoute le parcours `quality-feature` : recette Playwright, contre-exemples indépendants puis relecture. Les étapes et agents de qualité exigent un rapport réussi du bon type, lié à la tentative et aux critères existants, avec scénarios, captures et traces locales. Les rapports absents, invalides, périmés ou échoués bloquent les validations humaine et automatique. Le reporter exige une installation explicite dans la racine d’exécution et une commande Playwright approuvée, sans installation automatique de dépendances ou navigateurs.
- Rend les profils Agents et Skills éditables dans les portées personnel/projet avec versions, chemins, priorité visible, brouillons séparés et refus des sauvegardes concurrentes ou obsolètes.
- Pagine les listes et recherches de fichiers avec curseurs vérifiés ; applique les exclusions Git et les `.gitignore` imbriqués hors Git, sans limite arbitraire de profondeur ni résultats partiels silencieux.
- Ajoute un menu Consommation pour explorer les mesures par session, parcours et modèle ; affiche les mesures disponibles pendant les tentatives et conserve les valeurs inconnues comme telles.
- Protège les fichiers humains et sensibles face aux alias de casse/Unicode tout en conservant les chemins Git et physiques macOS. Les diffs HEAD refusent les blobs tronqués et résolvent les chemins depuis la racine Git lorsque le workspace est un sous-dossier.
- Conserve le texte, les choix, la réponse et la provenance des questions lors d’une continuation ; une nouvelle question portant le même identifiant ne réutilise pas une ancienne réponse différente.
- Invalide les critères et preuves devenus obsolètes après replay, édition de livrable ou changement de configuration. Le stockage reste compatible avec le schéma v3.

## 0.3.6 — 2026-10-13

- Ajoute une sélection explicite des fichiers déjà modifiés que l’agent peut reprendre, dans l’aperçu avant lancement. Une autorisation conversationnelle seule n’ouvre plus une fausse piste : le refus indique directement ce contrôle.
- Lie cette autorisation aux octets vérifiés par l’aperçu et sauvegarde les fichiers sélectionnés avant l’exécution. Les changements externes ultérieurs, fichiers non sélectionnés et restrictions du profil restent protégés.
- Affiche les motifs de blocage près du bouton de validation, un état de validation en cours, les refus hôtes et une confirmation explicite de fin de session. Le parcours n’est annoncé entièrement validé que lorsque la feature est réellement terminée.

## 0.3.5 — 2026-10-13

- Ajoute des cases à cocher et une édition par bloc dans l’aperçu de lancement : livrables, instructions d’agent, skills, mémoire, besoin et retours humains.
- Ajoute le réglage personnel « Contexte vide par défaut » aux agents, ainsi que Tout cocher / Tout décocher et la restauration du contenu original pour une tentative.
- Calcule le prompt et son budget uniquement à partir des blocs inclus. Conserve le cadre d’exécution, vérifie l’aperçu avant lancement et enregistre les choix dans l’historique de la tentative sans modifier les sources.
- Utilise une nouvelle session Copilot lorsque le contexte est personnalisé, pour ne pas réintroduire les blocs exclus via l’ancien historique.

## 0.3.4 — 2026-10-13

- Ajoute aux agents les comparaisons contre une branche locale ou distante déjà connue (`develop`, `origin/develop`), depuis l’ancêtre commun ou directement entre les deux versions.
- Sépare la comparaison des commits de l’inclusion explicite des changements locaux ; conserve le diff local contre HEAD quand aucune branche n’est fournie.
- Ajoute la liste paginée des branches et fichiers modifiés, les SHA de comparaison et la pagination des diffs avec détection des changements entre pages.
- Refuse les références absentes, ambiguës et les résultats Git tronqués. Préserve les exclusions de fichiers sensibles et le fonctionnement en lecture seule.

## 0.3.3 — 2026-10-13

- Enregistre les créations et éditions d’agents et skills au niveau utilisateur et corrige les libellés de l’éditeur.
- Ajoute une migration sélectionnable des anciens profils du projet, avec scripts et ressources de skills, sauvegardes, adaptation des liens du kit et vérification avant retrait des doublons.
- Conserve les deux versions en cas de personnalisations différentes et refuse les sources ou destinations modifiées depuis l’aperçu.

## 0.3.2 — 2026-10-13

- Lit les fichiers UTF-8 jusqu’à 4 Mio par plages de lignes, avec réponses bornées, pagination explicite et empreinte du fichier entier.
- Recherche également dans les gros fichiers et dans un fichier précis, avec indication des résultats tronqués et fichiers ignorés.
- Ajoute `studio_replace_text` pour modifier un bloc unique effectivement lu, sans réécrire le fichier entier dans le contexte du modèle. Vérifie l’empreinte, préserve les fins de ligne et conserve les restrictions de permissions et de changements préexistants.
- Interdit le remplacement intégral après une lecture partielle et conserve la compatibilité avec les points de restauration.

## 0.3.1 — 2026-10-13

- Résout les chemins Windows complets sans extension vers le fichier `.exe`, `.cmd` ou `.bat` existant. Signale les chemins introuvables avant de démarrer le transport SDK.

- Corrige la résolution du CLI dans le PATH et le lancement des shims Windows `.bat`/`.cmd`, tout en conservant le SDK JSON-RPC, les outils hôtes et la reprise des sessions.
- Ajoute `featureStudio.debugCli`, les diagnostics de sortie filtrés, le nettoyage des processus et les tests de transport réels sans appels Copilot.
- Installe le kit au niveau utilisateur dans `~/.copilot`, avec lecture des profils personnels et priorité aux surcharges du projet. Préserve les fichiers existants et ne modifie aucun fichier du projet pendant l’installation.

## 0.3.0 — 2026-10-13

- Espace Git par feature : branche et worktree frère créés localement depuis HEAD commité, sans copier les modifications source ni installer les dépendances.
- Isolation proposée par défaut pour les features et sessions libres ; relectures et sessions historiques conservées dans le dossier courant.
- Bandeau dossier/branche, ouverture dans une nouvelle fenêtre VS Code et résolution des fichiers/diffs/tests/hooks dans l’espace de la feature.
- Points automatiques avant les hooks et après les tentatives isolées, y compris annulées ou échouées ; points manuels dans les sessions historiques.
- Comparaisons point-vers-actuel et point-vers-point, diffs VS Code et accès aux points avant/après depuis chaque tentative.
- Restauration des seuls fichiers explicitement sélectionnés, après contrôle du fingerprint et sauvegarde de récupération persistée avant écriture ; validations invalidées et pilote en pause.
- Captures locales bornées et exclusions des fichiers sensibles usuels, configurations, dépendances, builds et liens ; l’index Git n’est pas restauré.
- Stockage v3 avec migrations v0/v1/v2 ; aucune migration inverse vers v0.2. Archives et points restent sur disque.
- Opérations Git locales sans requête IA supplémentaire ni publication automatique. Les règles et limites MCP de la v0.2 sont conservées.

## 0.2.0 — 2026-10-13

- Préparation obligatoire de chaque lancement manuel : US/contexte, aperçu exact du prompt métier, MCP et mémoire sélectionnés.
- Questions interactives pendant une tentative et permissions MCP par appel.
- Connexions stdio/HTTP/SSE, découverte sans prompt, coffre VS Code et preset Azure DevOps.
- Pilote local avec checkpoints, pauses, budget de runs et corrections bornées sur preuves/verdicts structurés.
- Centre de validation : preuves hôtes, critères, commentaires, versions et obsolescence des tests.
- Consommation cumulée, données inconnues explicites, seuils et profils de modèles configurables.
- Mémoire projet manuelle, optionnelle, bornée à 4 000 caractères injectés, sans résumé IA.
- Éditeur visuel des workflows, sauvegarde YAML et migration du stockage v0/v1 vers v2.

## 0.1.0 — 2026-10-13

- Cockpit React pour features, relectures et sessions libres.
- Étapes configurables, validation, questions, feedback, reprise et historique.
- GitHub Copilot CLI via SDK officiel, événements, modèle et consommation mesurée.
- Outils hôtes avec profils lecture seule, édition du workspace et tests autorisés.
- Catalogue agents/skills, kit Copilot 2.0.0 intégré et installation sans écrasement.
- Pseudos et huit personnages pixel art : repos, GIF de travail et validation.
- Hooks locaux facultatifs, export Markdown, diffs Git et persistance atomique.
