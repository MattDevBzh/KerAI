# Changelog

## 1.29.1 — 2026-10-23 · Retour visible lors de la création

- Avancement affiché dans la fenêtre de création, avec bouton explicite pendant l’attente.
- Erreur mise en évidence et automatiquement amenée à l’écran, sans perdre le nom ni le contexte saisis.
- Échecs de validation et d’initialisation renvoyés à la demande de création ; diagnostic également conservé dans la sortie Feature Studio.
- Nouvelle tentative identique associée à la même demande pour éviter de recréer une session après un échec d’enregistrement.
- Le refus de création signalé sur le poste Windows concerné reste à diagnostiquer à partir de son message exact ; cette version corrige la visibilité du résultat et la récupération après erreur.

## 1.29.0 — 2026-10-23 · QG grand écran et navigation documentée

- QG détachable en plein écran, bulles BD des messages publics, transmissions animées et ateliers dédiés aux sous-tâches avec pancarte numérotée.
- Tableaux manuscrits par agent et tentative : plan initial conservé, tâche courante en repli, notes, progression, pagination et adaptation à tous les thèmes.
- Espace Applications : profils, droits, bibliothèque de parcours, import, démonstration, édition, variantes, rejeu et historique.
- Agent Navigateur et compétences de navigation, contexte figé par tentative, contributions, relais humain, inspection ciblée de l’écran et pistes de code.
- Captures masquées et preuves liées aux parcours ; journal de campagne A/B avec coûts, échecs et inconnus explicités.
- Runtime navigateur livré dans le VSIX et stockage version 11, avec conservation des historiques et des validations humaines.

## 1.28.0 — 2026-10-23 · Images, documentation et preuves

- Captures par fichier ou collage dans le besoin et les conversations, avec aperçu, persistance et transmission visuelle native.
- Kit Documentation technique à quatre rôles en lecture seule, recherche web autorisée aux chercheurs/relecteurs et validations humaines obligatoires.
- Export local du livrable en Markdown, Word, PowerPoint et HTML, avec sources et notes conservées.
- Dossier de preuves : observations datées, conclusions reliées et révisables sans effacer leur historique, contrôle explicite des empreintes et sources à revérifier.
- Contradictions actuelles bloquantes pour la validation, sans assimilation d’une conclusion d’agent à une preuve ou un accord humain.

## 1.27.0 — 2026-10-22 · Compétences natives et instructions ciblées

- Catalogue KerAI exposé comme fournisseur de skills natifs, avec chargement à la demande et préchargement des compétences explicitement sélectionnées qui interdisent l’invocation automatique. Aperçu éditable, exclusions et profils personnels conservés.
- Découverte native des instructions ciblées et des fichiers d’instructions du projet. Suivi distinct des chargements natifs et des instructions effectivement consultées.
- Panneau dans la conversation et les preuves : nom, provenance, chemin, heure et contenu réellement transmis, conservés après réouverture et dans l’historique des tentatives.
- Aucune autorisation d’outil issue d’un skill ; hooks de fichiers désactivés, lecture seule et validations humaines conservées.
- Compatibilité CLI 1.0.103 : retrait de l’option supprimée `--no-remote`, maintien des sessions locales via le SDK.

## 1.26.0 — 2026-10-22 · Des sessions plus lisibles

- Accès direct à l’étape en cours, focus clavier sur le détail après sélection d’une carte et présentation compacte du cadre de la session.
- Sous-équipes : mission lisible en tête de page, contexte complet dépliable, niveau et numéro d’itération explicites, retour vers le travail actif. Les cartes gardent leur illustration dédiée dans les catalogues et le QG.
- Historique des sous-tâches : itération active mise en avant, progression, états distincts, lien vers l’itération corrigée, recherche sans accents et filtres pour les grandes listes. Les résultats à revérifier ne sont plus comptés comme validés dans la progression courante.
- Composition ouverte directement depuis la carte, en-tête du panneau toujours accessible, retour du focus à la fermeture, adaptation aux petites fenêtres et au zoom. Les modifications imbriquées restent un brouillon jusqu’à l’enregistrement de l’équipe parente.
- Conversation allégée : outils et réflexions regroupés, détails consultables à la demande, questions humaines dans une popin réductible avec brouillon partagé avec le chat.
- Permissions natives : accord ponctuel, par type pour la session ou pour les lectures dans le dossier de travail, quand le runtime le permet. Les règles gérées et demandes de contournement restent prioritaires ; un changement de mode efface les accords mémorisés.
- Appels et relances manuels sans plafond par défaut ; limites explicites existantes conservées et configurables. L’autopilot conserve son propre plafond.

## 1.25.2 — 2026-10-22 · Compatibilité native apply_patch

- Accepte les catalogues qui exposent `apply_patch` à la place de `edit` et `create`, tout en conservant les contrôles de lecture, recherche, terminal, questions, doublons et outils autorisés.
- Garde les outils d’écriture et de terminal interdits en lecture seule.
- Ajoute des tests du catalogue Windows signalé, des alternatives d’écriture et du diagnostic sans appel modèle, exécutés sous Linux et Windows.
- Synchronise les versions du manifeste, du lockfile et du VSIX. Restaure la seule métadonnée de dépendance altérée par le précédent changement de version, sans mise à jour des dépendances.

## 1.25.1 — 2026-10-22 · Diagnostic natif et validation

- Le diagnostic Copilot natif conserve les outils réellement annoncés par le runtime en cas d’échec et indique les capacités obligatoires manquantes.
- Les tests vérifient le détail du catalogue et des capacités absentes.
- Le contrôle de formatage Prettier n’est plus bloquant dans `npm run check` ; le typage TypeScript, les tests et la compilation restent obligatoires.

## 1.25.0 — 2026-10-22 · Mes équipes

- Le menu **Parcours** devient **Mes équipes**.
- La création d’une équipe utilise le compositeur visuel partagé avec les features : avatars, cartes, catalogue d’agents et d’équipes, réorganisation et réglages des interventions.
- Le correctif `grep` / `rg` de la version 1.24.1 est conservé.

## 1.24.1 — 2026-10-22 · Compatibilité de la recherche native

- Les catalogues natifs acceptent `grep`, `rg`, ou les deux. Un seul outil de recherche suffit, en lecture seule comme pendant le travail.
- Les catalogues incomplets, les doublons, les outils non autorisés et les outils d’écriture ou de terminal en lecture seule restent refusés.
- Le diagnostic invite à vérifier la compatibilité de Feature Studio et du CLI ; il ne prescrit plus systématiquement une mise à jour du CLI. Le couple de référence est distingué des versions réellement installées.

## 1.24.0 — 2026-10-22 · Sous-plans et sous-équipes

- Carte Sous-plan dédiée, sans portrait ni nom d’orchestrateur, compatible avec les thèmes et le QG vivant. Composition dans une équipe enregistrée ou une feature, configuration récursive dans le même panneau.
- Orchestrateur configurable, en lecture seule. Découpage automatique ou accompagné avec discussion et validation du plan. Une carte incomplète porte un avertissement et bloque le lancement.
- Une exécution complète de la sous-équipe par tâche, avec historique, conversation et validations séparés. Chaque étape attend une validation humaine, notamment le développement avant les tests.
- Navigation entre niveaux, retour à l’équipe de base, sélection des itérations et consultation des résultats précédents. Les corrections d’une tâche validée créent une nouvelle itération ; les suivantes restent signalées à revérifier jusqu’à leur propre vérification liée.
- Modification des compositions pendant l’utilisation, mise en attente pendant un appel, conservation des membres déjà exécutés et de leurs historiques. Une insertion antérieure passe par le parcours de correction ; les futures itérations reprennent la composition mise à jour.
- Profils d’agents actualisés dans toutes les équipes ; modèle et réflexion conservés par carte, y compris le choix automatique. Budgets et statistiques agrègent les sous-équipes.
- Stockage version 10, validation des liens entre niveaux, préservation des interruptions et reprise manuelle. Les sous-équipes utilisent le worktree de leur équipe de base.

## 1.23.0 — 2026-10-21 · La conversation de l’étape

- Un même chat dans les onglets de l’agent : messages, réflexions transmises par Copilot et outils réellement exécutés, en solo comme en pair.
- Passage solo/pair dans la tentative active, reprise de la même conversation native et interruption confirmée avant de rendre la main.
- Cadrage et explications avec les outils de lecture du code ; travail après accord sur l’organisation. Pas à pas, par blocs ou en une fois après cadrage, avec des explications réglables.
- Messages conservés pendant le travail, transmission immédiate quand Copilot l’accepte et traitement au point de contrôle sinon. Un envoi incertain exige un choix avant renvoi.
- Le lien du livrable revient à sa conversation. Les questions préservent le résultat ; les corrections convenues le mettent à jour avant validation humaine. Conversation consultable après validation, discussion libre indépendante.
- Stockage version 9 : modes, messages, états de transmission et événements conservés ; aucune reprise automatique après fermeture.

## 1.22.0 — 2026-10-21 · Copilot natif et permissions

- Nouvelles sessions sur les outils natifs Copilot : lecture, recherche locale, création, édition, terminal et questions humaines. Les outils métier Studio restent disponibles selon le profil.
- Choix des permissions à la création, avant un lancement et pendant une exécution : manuel, assisté si le runtime le permet, ou tout autoriser. Le choix reste indépendant du solo/pair et de la validation du résultat.
- Demandes natives rendues dans le cockpit avec commande, dossier ou modification concernée ; accord unique ou refus, sans réponse inventée.
- Journal des outils natifs avec origine, état, dossier, commande, sortie et code de retour structuré lorsqu’il est fourni. Les fichiers Git observés ne deviennent pas une preuve de propriété ni un résultat de tests.
- Diagnostic réel des capacités, respect des politiques Copilot et réapplication des permissions après reprise. CLI 1.0.102 / SDK 1.0.20 vérifiés ; le mode assisté est indisponible sur le runtime testé et désactivé dans l’interface.
- Arrêt du runtime et des processus enfants ordinaires, conservation du travail partiel et des activités interrompues. Stockage version 8 pour préserver les permissions et traces natives.
- Aucun changement automatique du régime des anciennes sessions ; aucun chantier de reprise de celles-ci dans ce lot.

## 1.21.0 — 2026-10-21 · Mode pair complet

- Lancement d’une étape en pair avec aperçu du contexte, rythme et niveau d’explication indépendants, organisation proposée et validation humaine explicite.
- Espace de travail avec conversation, contexte consultable, avancement par blocs, changements d’organisation et corrections avant validation du résultat.
- Messages enregistrés pendant le travail, passage en solo limité à l’étape, retour en pair au prochain point de contrôle et pause avec conservation du travail partiel.
- Conservation des échanges, organisations, décisions et sorties dans la même tentative ; historique des tentatives et brouillons de messages retrouvés à la réouverture. Reprise manuelle après interruption.
- Vérification des versions, des permissions, du budget et du contexte avant reprise ; les propositions de l’agent ne peuvent pas valider l’organisation ou l’étape.
- Cumul de consommation entre les appels, budget comptant chaque appel du binôme, export des échanges et exclusion du temps de réponse humain du délai d’exécution.
- Stockage version 7 avec migration des anciennes sessions et conservation des travaux interrompus.

## 1.20.0 — 2026-10-20

- **Passage de contexte dans le QG vivant** : quatre avions en papier partent du personnage de l’étape n−1 vers celui qui démarre. Les départs sont décalés sur une animation totale de cinq secondes.
- Déclenchement au démarrage réel d’une nouvelle tentative, classique ou en pair, à partir de la deuxième étape. Le lancement et les interactions restent immédiats ; les réponses, reprises de lots et réouvertures ne rejouent pas l’effet.
- Trajectoires adaptées aux postes, au retour à la ligne et au zoom. Réduction des animations respectée avec une indication textuelle, couleurs forcées prises en charge et arrêt lorsque la vue est masquée.

## 1.19.0 — 2026-10-20

- **Mode pair** dans les étapes : contexte confirmé, conversation dédiée et organisation proposée avant tout accès aux outils du projet.
- Rythmes **Guidé**, **Par lots** et **Autonome après cadrage**. Les messages ajustent le plan ; un bouton autorise le prochain lot. Les pauses libèrent le projet.
- **Continuer en solo** depuis une pause ou pendant un tour : relais après la réponse en cours, avec les décisions et le travail existants. Quitter la page conserve le rythme convenu.
- Contexte et profil figés, conversation persistante, reprise explicite après interruption, contrôles de révision et protection des modifications humaines entre les lots.
- Une seule tentative pour toute la conversation ; crédits cumulés sans double comptage. Chaque tour compte dans le budget de runs. Validation du livrable par les contrôles existants, puis retour à la session.
- Cette livraison inclut également la page **Stats** introduite dans les sources 1.18.0.

## 1.18.0 — 2026-10-20

- **Stats** : nouvelle page dans la navigation principale avec filtres par projet, parcours et période, dates personnalisées inclusives et regroupement par jour, semaine ou mois. Les filtres restent mémorisés au retour d’une session.
- Huit indicateurs de synthèse : sessions du périmètre, créations, finalisations datées, tentatives, crédits observés, durée moyenne, étapes et tentatives par session. Les archives sont incluses par défaut.
- Graphique d’activité avec tableau accessible, podium des agents et avatars, répartition des modèles par tentatives ou crédits, carte des jours/heures, jours actifs et séries de jours consécutifs.
- Relances, échecs, annulations, interruptions, volumes moyens des contextes et livrables, répartition par projet/parcours/état, accès aux sessions les plus actives.
- Mesure du stockage privé à la demande par lots de 50, sans lecture des journaux ni appel Copilot. Moyenne calculée sur les seules mesures réussies ; réponses obsolètes ignorées après changement de périmètre.
- Calendrier local respectant les changements d’heure ; sessions multi-projets non doublées dans les totaux ; crédits absents, partiels et zéros mesurés distincts. Les limites et règles d’attribution sont expliquées dans la page.

## 1.17.0 — 2026-10-20

- **Sessions** devient une liste compacte sur toute la largeur, avec projet, état, progression et actions par ligne. Le bandeau et la colonne décorative laissent la place aux sessions ; les petites fenêtres conservent les informations et les actions.
- Filtre par projet, recherche dans les noms de projets et tri mémorisés au retour sur la liste. Les sessions multi-projets apparaissent dans chacun des filtres concernés ; les anciens enregistrements retrouvent le projet de leur stockage.
- Sélection au clic ou par case, plage inclusive avec **Maj+clic**, sélection de toutes les lignes affichées et désélection. Modifier un filtre ou le tri efface la sélection ; les lignes cachées ne participent pas à une plage.
- Archivage, restauration et suppression depuis la liste, individuellement ou en masse. Une seule confirmation native pour supprimer le lot, progression et bilan détaillé en cas de résultat partiel. Les fichiers sources, branches et worktrees restent conservés.

## 1.16.1 — 2026-10-19

- Ajoute **Télécharger .md** dans le Livrable d’une étape : enregistrement du Markdown intégral dans le fichier choisi, avec un nom proposé pour la feature, l’étape, la tentative et la version.
- L’export suit la tentative affichée, y compris une ancienne tentative. Les brouillons non enregistrés et les tentatives encore en cours doivent être terminés avant le téléchargement. Une version devenue obsolète est signalée.
- Aucun appel d’agent ni crédit consommé pour cet export. Publication sans suites de tests à la demande de l’utilisateur ; compilation et intégrité de l’archive contrôlées.

## 1.16.0 — 2026-10-19

- Les agents ajoutés seuls et les membres d’équipes reprennent leur profil courant au lancement : instructions, skills, outils, permissions, contexte par défaut et ton. Les anciennes copies de skills dans les modèles d’équipe ne masquent plus le profil.
- Dans la composition et l’édition d’une équipe, seuls le modèle et le niveau de réflexion du membre peuvent être remplacés. Les autres paramètres sont affichés en lecture seule et se modifient dans Agents. Les champs « Hériter » restent vides dans l’équipe ; chacun reprend indépendamment la valeur courante du profil.
- Ajout de la réflexion et des permissions par défaut dans l’éditeur d’agent. Les récapitulatifs et les lancements utilisent les mêmes valeurs ; modifier un profil après un aperçu nécessite de recalculer cet aperçu.
- Les modèles d’équipes existants sont adaptés à leur lecture. Les sessions déjà enregistrées conservent leur définition jusqu’à une modification explicite de leur équipe ; aucune tentative passée n’est réécrite.

## 1.15.0 — 2026-10-19

- Relecture distante Git : outils dédiés pour récupérer deux branches dans un cache utilisateur bare, figer leurs commits, parcourir les diffs et lire le contexte sans checkout.
- Lecture des documents personnels d'agents, skills et templates, avec pagination, sans ouvrir l'accès aux secrets ou à un shell.
- Écriture et ouverture des rapports personnels depuis un agent en lecture seule, sans modifier le projet. Les capacités distantes sont activées explicitement dans le profil de l'agent.
- Les sessions utilisent le moteur fourni par l'extension ; aucun script personnel n'est exécuté. La méthode de relecture et le template restent ceux du profil personnel existant.

## 1.14.0 — 2026-10-19

- **Thèmes réellement appliqués** : un thème explicite du cockpit garde ses couleurs, ses agents et ses décors même avec un thème VS Code classé « contraste élevé », comme Bearded Milkshake Vanilla Banana. Le suivi automatique de VS Code et les couleurs forcées du système restent disponibles. L’enregistrement automatique des thèmes est désormais indiqué près du choix et du bouton réservé aux réglages du projet.
- **Approbation du projet** : les réglages affichent l’état réel de confiance et donnent accès à l’écran d’approbation de VS Code. Les modifications en cours restent dans le formulaire pendant cette étape ; aucun script n’est autorisé automatiquement.
- **Dragon Ball, thème secret** : saisir ↑ ↑ ↓ ↓ ← → ← → sur le Dashboard révèle et active un dojo orange et bleu, Shenron, sept boules de cristal et vingt costumes avec poses de repos, travail et réussite. Le secret reste acquis entre projets, accessible ensuite dans les réglages ; les champs, dialogues et autres pages ignorent la combinaison.
- **Six récompenses de trophées** : thème Noob à 5, titre Architecte du dimanche à 20, feu d’artifice devant la tour Eiffel à 40, thème Matrix à 70, titre Dresseur d’agents à 110 et chaton qui se promène dans le QG à 200. Les trophées déjà gagnés comptent et ne sont jamais dépensés.
- **Prochain cadeau dans Quêtes** : aperçu, jauge entre deux paliers et nombre de trophées restants. Une seule récompense à venir est dévoilée ; les suivantes restent cachées. Les cadeaux acquis forment une collection avec activation facultative et choix personnels conservés entre les projets.
- Les nouveaux thèmes habillent aussi le QG. Le chaton et les feux d’artifice respectent la réduction des animations et le contraste élevé ; la célébration suit la validation finale existante ou son bouton de relecture.
- **QG vivant dans une session** : la case « Afficher le QG vivant » remplace uniquement la bande des agents par un atelier animé. Chaque poste sélectionne la même étape et son détail reste en dessous ; le Dashboard conserve sa vue habituelle.
- **QG assorti au thème** : décors Jardin, Papier, Guilde et Halloween, lumière claire ou sombre, plans de travail et lampes coordonnés. Le mode automatique suit la palette de VS Code et le contraste élevé conserve une présentation épurée. Changer de thème préserve l’étape sélectionnée et les brouillons.
- Préférence personnelle mémorisée dans VS Code pour tous les projets, retour à la bande classique en décochant et erreurs de sauvegarde explicites. Les brouillons du compte rendu restent conservés pendant le changement de vue.
- Des décors partagés avec les vingt avatars et leurs états existants. Les postes suivent les étapes réelles, y compris les agents répétés, les questions humaines et les échecs. Réduction des animations, contraste élevé, costumes et petits écrans pris en charge.

- Intègre les interventions facultatives de la v1.13 dans le QG : choix humain attendu, passage non exécuté et validation finale cohérente. Corrige la réapparition de la célébration Eiffel en mouvement réduit à la réouverture d’une session terminée.
- Vérifie avant publication les fonctionnalités des bundles et tous les visuels inclus dans le VSIX, pour détecter les nouveautés absentes du paquet.

## 1.13.0 — 2026-10-18

- Ajoute le choix obligatoire/facultatif par intervention dans les parcours réutilisables, les propositions issues d’une discussion et les compositions propres à une feature. Le modèle d’équipe reste intact quand on adapte une feature.
- Suspend le pilote avant une intervention facultative jamais exécutée : notification VS Code et bandeau persistant avec exécution, passage ou décision différée. La fermeture et la réouverture conservent la pause.
- Distingue clairement les interventions passées des interventions validées dans la session, les cartes, le Métro, le bilan, les exports et l’Observateur. Aucun livrable, test réussi ou lancement n’est inventé.
- Conserve les décisions humaines et invalide les choix concernés après une modification du contexte, une correction en amont ou une restauration. Une intervention passée peut être exécutée ensuite, avec revalidation de ses dépendants.
- Refuse les doubles décisions, les notifications obsolètes et le passage d’une intervention déjà tentée. Préserve les checkpoints, budgets, critères, remarques bloquantes et la validation finale humaine.
- Migre le stockage vers la version 6 sans rendre facultatives les anciennes interventions. Corrige les validations finales avec étapes passées, l’affichage des refus de décision et les reprises de correction visant une étape passée.

## 1.12.0 — 2026-10-17

- Dashboard Métro distinct de la page Sessions : progression réelle par étape, agent courant, attentes humaines, erreurs et durées sans estimation artificielle.
- Tour de contrôle dans une fenêtre auxiliaire VS Code, plein écran, retour vers la session et son étape, moteur partagé et fermeture des vues sans double exécution.
- Six modules personnalisables, déplaçables, redimensionnables et duplicables, avec titres et filtres indépendants enregistrés ; actualisation Azure réglable, erreurs et limites visibles.
- Tickets Azure DevOps tous types : recherche distante combinée, pagination, détail complet, commentaires et liens sûrs. Préparation d’une session dans le dossier courant ou un worktree, contexte source conservé et création sans lancement automatique.
- Menus Atelier et DevOps regroupés ; Réglages dans l’en-tête près du quota Copilot. L’ancien Dashboard devient Sessions.

## 1.11.0 — 2026-10-17

- Zoom global de 80 à 200 % et mode Auto adapté à la taille disponible ; commandes dans le bandeau et les réglages, préférence personnelle conservée entre projets. Les pages profitent davantage des grands écrans.
- Détection automatique du Copilot CLI installé dans le PATH de VS Code, puis les emplacements utilisateur npm, MSI, WinGet, `.local/bin` et Homebrew. Les lanceurs intermédiaires VS Code sont ignorés.
- Chemin et provenance du CLI visibles après diagnostic, même en cas d’échec d’authentification. Bouton **Détection automatique** pour remplacer un ancien chemin invalide ; les chemins personnalisés restent possibles.
- L’icône Feature Studio ouvre directement le cockpit dans la fenêtre VS Code courante, sans second clic. Les commandes et la restauration d’onglet restent dans cette fenêtre ; le raccourci Windows et la commande dédiée conservent leur fenêtre à part.
- Le compteur global des crédits GitHub Copilot est visible dans l’en-tête du cockpit. Un clic affiche les détails du compte ; l’actualisation reste limitée aux périodes où le cockpit est visible.

## 1.10.0 — 2026-10-16

- Connexion Copilot automatique à l'ouverture du cockpit, après approbation de l'espace de travail et lors du passage à un projet encore non vérifié. Réutilise l'authentification locale, charge les modèles et conserve un diagnostic avec réessai manuel en cas d'échec ; aucun prompt n'est envoyé au démarrage.
- Menu compact avec libellés, recherche des écrans, navigation au clavier et retour au contenu. Menu bureau plus lisible et outils secondaires repliables.
- Textes et cibles de clic agrandis, rapports plus confortables, actions et noms longs adaptés aux petites fenêtres. Dialogues avec focus et défilement maîtrisés, commandes persistantes et protection contre les fermetures par clic à côté.
- Accueil avec compteurs filtrants, tri des sessions, progression lisible, dates, remise à zéro des filtres et raccourcis explicites vers les catalogues.
- Recherche des agents et skills, filtres par origine, favoris et recherche sans accents. Sommaire des réglages et sauvegarde/annulation toujours accessibles après une modification.
- Discussions avec agents disponibles dès l'ouverture, options repliables, historique compact, retour aux derniers messages, aide à l'envoi et compteur de caractères.
- [68 évolutions ergonomiques classées](docs/ERGONOMIE.md), dont les 44 de priorité 1 à 5 corrigées et vérifiées localement.

## 1.9.0 — 2026-10-16

- **Discuter avec l’agent** depuis un compte rendu : conversation persistante liée à la tentative et à la version sélectionnées, avec le profil, le modèle, le raisonnement et le contexte archivés. Un nouveau clic retrouve le même fil.
- Retour direct au compte rendu ou à son éditeur. La copie discutée reste figée si le rapport évolue ; les modifications et validations restent humaines.
- **Créer une feature** depuis une discussion : l’agent prépare le besoin, des critères vérifiables et une équipe ordonnée. Le formulaire permet de changer les textes, les agents, leurs missions, leur ordre et leurs autorisations avant création.
- Propositions enregistrées, ajustements conservés dans la vue, erreurs sans perte de saisie et protection contre les créations répétées. Une feature créée reste en brouillon avec ses critères à vérifier et un lien vers la discussion d’origine.
- Les discussions restent sans outils ; ouvrir un rapport ne déclenche aucun appel IA. Les lacunes des anciennes archives et les limites de contexte sont explicites.

## 1.8.0 — 2026-10-16

- Un écran Quêtes avec 100 missions : 16 séries de 5 paliers et 20 défis uniques, répartis entre premiers pas, composition, collaboration, maîtrise et exploration.
- Récompenses de 1 à 10 trophées, compteur dans le menu, progression, aide et accès à l’écran utile. La mission suivante remplace celle terminée ; les réussites restent dans la collection.
- Progression personnelle partagée entre projets, conservée après redémarrage et suppression d’une session. Attribution atomique et unique, fondée sur les actions enregistrées par l’hôte ; aucune demande de récompense envoyée par l’interface n’est acceptée.
- Identité d’exécution figée pour les nouveaux lancements : changer un agent, un modèle ou une skill après coup ne transforme pas les anciennes interventions en nouvelles preuves.
- Pas de dépense ni de bonus pour l’instant ; les trophées s’accumulent. Les missions n’exécutent aucune action à votre place.

## 1.7.0 — 2026-10-16

- Trois univers complets, chacun en clair et sombre : Jardin des idées, Papier vivant et Guilde pixel, avec décors, matières et cartes dédiés.
- Halloween, un septième thème événement : vingt costumes dérivés des portraits existants, avec poses de repos, travail animé et réussite.
- Les costumes suivent le thème sur les cartes, les discussions, les kits et le choix d’avatar ; les profils restent compatibles et les portraits originaux sont conservés.
- Migration des cinq anciennes préférences, repli vers le portrait habituel si un asset manque, contraste élevé prioritaire et réduction des animations respectée.

## 1.6.0 — 2026-10-15

- Anime le scan de l’Observateur sur la session : avatar, balayage, phase active, progression réelle et synthèse. Le bandeau reste accessible lorsque le rapport est fermé et respecte la réduction des mouvements.
- Intègre l’Observateur au cockpit multi-projets et à sa fenêtre dédiée, en conservant discussions, équipes et paramètres de la v1.5.0.

- Récupère les événements intacts lorsqu’un journal se termine par une ligne coupée. La reprise sauvegarde les octets incomplets avant nettoyage, puis permet de continuer la session ; les rapports et le stockage signalent durablement la couverture partielle. Une corruption sur une ligne terminée reste refusée.
- Aligne les exports HTML et Markdown sur le cockpit : modèle demandé, ensemble des modèles mesurés et consommation par modèle, avec prise en charge des anciennes mesures.

### Observateur de session

- Ajoute l’Observateur d’une seule session feature : aperçu local, modèle et budget explicites, analyse de toutes les phases, améliorations sourcées, commentaires globaux, consommation par phase et bilan des appels de l’Observateur. Les rapports versionnés s’exportent en HTML autonome ou Markdown.
- Conserve les traces complètes sur disque, y compris contextes effectivement envoyés, instructions, outils et intentions humaines. Limite initiale de 256 Mio configurable ; activité récente et pagination du journal sans supprimer les événements anciens.
- Passe au stockage v5 avec index léger et états de session séparés, migration des formats 0 à 4 et vérification des empreintes.
- Ajoute la suppression définitive confirmée : journaux, rapports, sauvegardes et données locales associées, collecte des objets non partagés et reprise après crash. Les fichiers du projet, branches, worktrees et exports externes restent conservés.
- Conserve les consommations inconnues ou partielles, les coûts des échecs et annulations et les modèles réellement observés ; les plafonds sont contrôlés entre les appels.

## 1.5.0 — 2026-10-15

- Nouveau menu **Discussion** après Dashboard : agent au choix, modèle et raisonnement par conversation, réponses progressives, arrêt, bulles et avatars adaptés aux thèmes.
- Historique local classé par date, recherche, reprise après rechargement et suppression confirmée. Les mesures des discussions rejoignent Consommation.
- Marquage **Agent de discussion** à la création et dans l’éditeur, profils prioritaires et bouton **Voir plus**. Le marquage est conservé dans les kits.
- Menus réordonnés : Dashboard, Discussion, Validation, Consommation, Parcours, Agents, Skills, Automatisations, Kits, Réglages, Livraison, Azure DevOps (PR, Tickets), Mémoire.
- Choix de projet limité aux écrans qui en utilisent les données ; les réglages communs précèdent une liste de projets et leurs paramètres. Les sauvegardes ciblent explicitement le projet affiché.
- Suppression confirmée des parcours du catalogue personnel, avec conservation des sessions et des fichiers de définition.
- Tests de persistance, annulation, erreurs, consommation, profils, catalogue Copilot sans outils et interface dans les cinq thèmes, en contraste élevé et en fenêtre compacte.

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
