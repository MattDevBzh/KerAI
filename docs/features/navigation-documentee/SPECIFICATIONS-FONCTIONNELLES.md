# Spécifications fonctionnelles de la navigation documentée

La feature fournit une connaissance réutilisable des accès aux écrans et de leurs états. Elle sert à préparer une évolution, développer une fonctionnalité, corriger un défaut et vérifier un résultat. Son succès se mesure par la qualité obtenue et par l’économie totale de temps et de consommation.

## 1. Périmètre de la première version

**F-01 — Cible.** Applications web locales accessibles depuis le poste qui exécute KerAI, avec un navigateur Chromium dédié. Connexion manuelle possible. Un même profil d’application peut référencer plusieurs dépôts autorisés. Le choix initial Chromium et le support Windows/macOS sont proposés pour correspondre au produit existant ; les autres navigateurs et l’exécution distante feront l’objet d’une recette séparée.

**F-02 — Aucune intégration dans les applications professionnelles.** Tous les boutons, formulaires, panneaux d’enregistrement et comparaisons sont dans KerAI. Aucun ajout de composant, SDK, attribut `data-testid`, endpoint de version, dépendance, extension applicative ou script permanent n’est requis côté projet cible. Les outils utilisent les éléments et sources disponibles. Une capacité indisponible reste signalée ; elle ne déclenche pas de modification automatique du projet pour faciliter l’outillage.

**F-03 — Trois entrées obligatoires en V1.** Décrire un parcours, importer un JSON supporté et montrer le parcours dans le navigateur dédié aboutissent au même référentiel. La démonstration intégrée n’est pas reportée à une version ultérieure.

La V1 couvre les interfaces DOM usuelles : liens, boutons, formulaires, onglets, menus, dialogues et défilement. Les gestes exclusivement graphiques, canvas, WebGL, composants à DOM fermé et dialogues du système ne sont pas garantis. Une étape non prise en charge demeure visible et empêche de qualifier le parcours d’automatiquement rejouable. Les particularités d’une application seront vérifiées pendant sa préparation, sans promettre une compatibilité universelle.

## 2. Responsabilités

| Acteur      | Responsabilité                                                                                  | Droits sur le référentiel de navigation                                                             |
| ----------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Matt        | Décrit l’objectif, montre un parcours, corrige les informations et valide les décisions prévues | Création et correction explicites dans l’interface dédiée, historisées                              |
| Navigateur  | Cherche l’accès, pose les questions utiles, apprend et entretient les parcours                  | Seul agent autorisé à proposer et enregistrer leurs révisions par le service hôte                   |
| Architecte  | Analyse l’état réel et le code, établit les dépendances et le plan                              | Consultation et contribution d’observations                                                         |
| Développeur | Réalise le plan et utilise le navigateur quand utile                                            | Consultation et contribution d’observations                                                         |
| Testeur     | Rejoue, vérifie les critères indépendamment et fournit des preuves                              | Consultation et signalement de divergence ; aucun changement de l’attendu pour faire passer un test |
| Hôte KerAI  | Applique les droits, persiste les faits et exécute les commandes autorisées                     | Seul composant qui effectue les écritures physiques gérées                                          |

**F-04 — Propriétaire unique.** Aucun agent consommateur ne remplace silencieusement un parcours. Il peut explorer un détour autorisé et transmettre les actions observées au Navigateur. Les rapports et le plan technique restent les livrables propres des autres rôles ; leur existence ne constitue pas une seconde bibliothèque de navigation.

**F-05 — Intervention à la demande.** Un parcours existant peut être recherché et rejoué sans appel au Navigateur ni au modèle. Le Navigateur intervient si la connaissance manque, si un accès échoue ou si une révision est demandée. Il ne devient pas une étape obligatoire devant chaque Architecte, Développeur ou Testeur.

## 3. Ce que la bibliothèque mémorise

**F-06 — L’URL n’est pas l’identité de l’écran.** La bibliothèque distingue application, état initial, état cible, parcours et paramètres. Une même URL peut présenter un onglet différent, un formulaire ouvert, un rôle distinct ou une erreur après une interaction.

| Objet visible | Exemple générique                                    | Règle                                                                                        |
| ------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| État cible    | Fiche client, onglet Facturation, formulaire ouvert  | Reconnu par plusieurs indices observables, au-delà de l’URL                                  |
| Parcours      | Liste → rechercher → fiche → Facturation → Modifier  | Séquence versionnée avec vérifications et attentes                                           |
| Paramètres    | Référence du client et taille de fenêtre             | Valeurs de test séparées du parcours, sans duplication par client                            |
| Variante      | Accès depuis une notification                        | Conservée séparément lorsque l’historique influence le comportement                          |
| Prérequis     | Rôle Gestionnaire, client avec une facture           | Une absence bloque ou demande une précision ; elle n’est pas une régression de l’application |
| Exécution     | Rejeu du parcours révision 3 dans une session dédiée | Journal et preuves liés à cette exécution exacte                                             |

**F-07 — Deux intentions de rejeu.** « Atteindre cet état » autorise le choix d’un parcours déjà vérifié et compatible. « Reproduire ce parcours » conserve la séquence exacte, y compris les étapes qui paraissent évitables. Une correction de bug utilise ce second mode lorsque l’historique intervient.

**F-08 — Statuts distincts.** L’interface sépare la définition (`Brouillon`, `Disponible`, `Archivé`), la preuve (`Décrit`, `Observé`, `Rejoué avec succès`, `Échec`) et la fraîcheur (`À contrôler`, `Vérifié pour cette exécution`, `À réparer`). Une validation humaine ne fabrique pas un résultat de rejeu. Une observation ne devient pas automatiquement une exigence métier.

Une description, un import ou une démonstration crée d’abord un brouillon consultable. Il devient disponible pour la sélection automatique lorsque son format est valide, ses prérequis sont renseignés, ses étapes sont prises en charge et un rejeu hôte a atteint l’état cible pour cette révision. Avant cela, Matt ou le Navigateur peuvent lancer explicitement un rejeu de vérification. Un chemin comportant une étape manuelle reste identifié comme assisté et n’entre pas dans le rejeu automatique.

La mission autorisée du Navigateur peut inclure l’enregistrement automatique de ces révisions vérifiées ; le changement apparaît dans l’historique avec son diff, sans demander une validation humaine pour chaque note. Matt peut aussi créer, corriger et rendre disponible un parcours par l’interface, y compris sans Copilot, sous les mêmes conditions de vérification. L’auteur est alors `human`. Le Navigateur reste le seul auteur **agent**. L’archivage retire une recette de la sélection courante tout en préservant les références historiques.

**F-09 — Historique.** Les révisions consommées par une tentative sont figées. Une correction produit une nouvelle révision et un changement explicite de contexte ; elle ne modifie pas rétroactivement les preuves avant/après.

Un changement de parcours, paramètres, binding ou droits qui modifie le contexte figé ouvre une nouvelle tentative liée à la précédente. Les fichiers déjà modifiés sont préservés et le travail antérieur reste consultable. La reprise de la même tentative n’est possible que lorsque ce contexte reste compatible ; elle ne remplace jamais son instantané initial.

## 4. IHM dans KerAI

Le point d’entrée proposé s’appelle **Applications** afin de distinguer les parcours de navigation des workflows d’agents déjà présents. Il respecte les thèmes, le clavier, le contraste et les petites fenêtres du cockpit.

| Écran ou zone               | Contenu et actions                                                                      | Résultat attendu                                                             |
| --------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Applications                | Liste des applications du projet, disponibilité, bouton Ajouter                         | Choisir l’application sans connaître le détail du monorepo                   |
| Profil d’application        | URL locale, dépôts, connexion, navigateur, serveur déjà lancé ou commande approuvée     | Préparer le contexte une fois et voir ce qui manque                          |
| Bibliothèque                | Recherche par intention, écran, rôle et tags ; état de fraîcheur                        | Trouver quelques parcours pertinents sans charger toute la base              |
| Fiche de parcours           | Objectif, prérequis, états, étapes, paramètres, variantes, révisions et derniers rejeux | Lire, corriger explicitement, rejouer, archiver et consulter les différences |
| Apprendre un parcours       | Trois actions : Décrire, Importer un JSON, Montrer                                      | Entrée unique et résultat homogène                                           |
| Démonstration               | Démarrer, Pause, Capturer cet état, Terminer, Annuler ; compteur d’actions              | Piloter l’enregistrement depuis KerAI, sans panneau ajouté au site           |
| Préparation de tentative    | Parcours sélectionnés, révisions, indices de code, taille du contexte, omissions        | Comprendre exactement ce qui sera transmis au rôle                           |
| Travail en cours            | Acteur qui contrôle le navigateur, étape, blocage, Reprendre la main, Arrêter           | Contrôle visible, commandes gérées exclusives et reprise de main             |
| Observations et preuves     | État atteint, capture, inspection, avant/après, version connue ou inconnue              | Distinguer l’observation, l’analyse et la validation                         |
| Contributions au Navigateur | Détours observés, éléments introuvables, suggestions ; accepter ou conserver en attente | Maintenir un référentiel unique                                              |
| Consommation                | Apprentissage, exploitation, entretien, mesures connues/inconnues                       | Évaluer le coût total, sans gain fictif                                      |

**F-10 — Préparation.** KerAI vérifie l’accès au navigateur, à l’URL et aux dépôts sélectionnés. Il ne lance pas de serveur, n’installe pas de navigateur et n’ajoute pas de fichier au projet cible à son insu. Une commande de démarrage est choisie et approuvée dans KerAI ; une application déjà lancée peut être attachée. Si le lien entre serveur et checkout n’est pas attestable, l’interface indique « Version de l’application non vérifiée ».

**F-11 — Authentification.** Matt se connecte dans le navigateur dédié. L’enregistrement est suspendu pour la connexion. Le profil est privé et lié à l’application et au rôle déclarés. Les mots de passe, cookies et jetons ne sont pas intégrés à la documentation ou au contexte IA. Une session expirée provoque une demande de reconnexion. Un fournisseur d’identité externe peut être autorisé pour cette connexion manuelle ; cela n’étend pas la V1 à la navigation générale sur des sites distants.

## 5. Apprendre un parcours

### Description

**F-12.** Matt décrit son objectif, fournit une adresse et, s’il le souhaite, une capture ou des étapes. Le Navigateur cherche d’abord un parcours existant. Il explore ensuite dans le budget prévu et pose une question contextualisée lorsqu’il ne peut plus progresser : dernier état atteint, obstacle et information manquante. Il ne relance pas indéfiniment la même action.

### Import JSON

**F-13.** KerAI accepte le format portable KerAI et un sous-ensemble annoncé du JSON Chrome Recorder. Avant toute exécution, l’écran montre les étapes comprises, les paramètres à renseigner, les actions à effet métier et les incompatibilités. Une étape non supportée n’est jamais supprimée silencieusement. L’import n’est pas un lancement. Le JSON ne peut pas apporter du JavaScript arbitraire ou des instructions d’installation.

### Démonstration intégrée

**F-14.** Matt choisit Montrer. KerAI prépare le navigateur visible, attend l’arrêt des actions agent puis affiche « À toi ». Matt navigue dans l’application normale. Les commandes d’enregistrement restent dans KerAI ; aucune barre ni surcouche n’est injectée dans l’IHM du projet cible. Matt peut suspendre la capture, nommer l’état final et terminer. Une liste éditable des étapes, champs paramétrables et limites détectées est produite sans appel IA obligatoire.

Le Navigateur peut ensuite nommer et documenter la proposition avec un appel visible et comptabilisé. Sans Copilot, la démonstration et le rejeu manuel restent utilisables ; l’enrichissement par l’agent est affiché comme indisponible. Une session interrompue garde un brouillon et ne devient pas un parcours réussi.

**F-15 — Vérification.** Le rejeu repart d’un état connu dans un contexte contrôlé. L’état serveur et les données ne sont pas remis à zéro implicitement. Une préparation de données nécessaire utilise une procédure explicitement configurée ou une intervention humaine. Les captures et résultats déterminent le statut observé ; la simple fin d’un script ne suffit pas.

## 6. Utilisation par les autres rôles

**F-16 — Recherche économique.** Le rôle reçoit des résumés de quelques candidats, puis les détails retenus à la demande. Les longues traces, historiques de conversation, captures et bibliothèques complètes ne sont pas injectés systématiquement. La recherche et le rejeu connus n’appellent aucun modèle.

**F-17 — Architecte.** Il utilise le parcours et l’inspection ciblée pour retrouver routes, éléments, styles, requêtes et fichiers candidats. Il vérifie le code et les dépendances pertinentes. Un nom de fichier ressemblant au libellé visible ne constitue pas une correspondance prouvée. Le plan conserve les références de navigation et les sources techniques utiles.

**F-18 — Développeur.** Il reçoit ce plan et les références figées, relit les portions nécessaires et élargit la recherche si les faits le demandent. L’économie de contexte ne doit pas interdire la compréhension des composants partagés. Le navigateur est disponible lorsqu’il apporte une information ; il n’est pas relancé mécaniquement à chaque étape.

**F-19 — Testeur.** Il atteint l’état prévu puis vérifie les critères du besoin. Ses assertions de résultat restent indépendantes des vérifications d’arrivée du Navigateur. Il ne change ni le parcours figé ni l’attendu pour masquer un échec. Une nouvelle révision nécessite un nouveau rejeu identifié. Les validations du plan, du code avant les tests agent et de l’acceptation finale restent appliquées.

**F-20 — Contributions.** Les autres rôles peuvent transmettre une observation structurée au Navigateur sans perdre leur travail. Une contribution attend sa consolidation ; elle n’oblige pas à appeler immédiatement un modèle. Le contexte nécessaire à une reprise est conservé et borné.

## 7. Limites, péremption et contrôle humain

**F-21.** Chaque contexte navigateur a un seul acteur autorisé à émettre des commandes gérées. La reprise de main attend l’arrêt confirmé des commandes. Un navigateur visible ne permet pas d’empêcher physiquement un clic humain anticipé : en cas d’intervention concurrente, arrêter les prochaines commandes et vérifier de nouveau l’état. Un clic déjà exécuté n’est pas annulé. Fermer la fenêtre ou perdre le processus interrompt l’exécution ; la réouverture propose une reprise explicite, sans clic automatique.

**F-22.** Une navigation peut déclencher un effet métier même si le code est en lecture seule. Le profil d’application distingue les interactions autorisées, les opérations nécessitant confirmation et celles interdites. Les bibliothèques importées n’étendent pas ces droits. Le système ne déduit pas l’innocuité d’un bouton de son seul libellé.

**F-23.** La fraîcheur dépend des indices disponibles : rejeu, fichiers associés, changement de rôle, environnement et erreurs. Un changement Git sans rapport ne périme pas toute la bibliothèque. Une version inconnue ou une dépendance non cartographiée est affichée comme incertaine, sans certificat de validité global.

**F-24.** Les données sont privées et locales par défaut. Exporter produit un aperçu des informations incluses ; profils d’authentification, données professionnelles et captures ne sont jamais joints par défaut. Archiver un parcours conserve les révisions référencées par des preuves. Une suppression indique ses conséquences et respecte ces références.

## 8. Critères d’acceptation

| ID    | Situation                                            | Résultat vérifiable                                                                                                     |
| ----- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| AC-01 | Même URL, deux onglets ou dialogues différents       | Deux états distingués par des observations, sélection non ambiguë                                                       |
| AC-02 | Parcours connu                                       | Recherche et rejeu sans appel modèle supplémentaire                                                                     |
| AC-03 | Description ambiguë                                  | Question précise, reprise avec la réponse, pas de boucle sans progrès                                                   |
| AC-04 | Import compatible                                    | Aperçu puis rejeu, définition et provenance conservées                                                                  |
| AC-05 | Import avec action inconnue ou expression JavaScript | Incompatibilité explicite, aucune exécution implicite                                                                   |
| AC-06 | Démonstration depuis KerAI                           | Contrôle humain exclusif, étapes éditables, aucun ajout dans l’IHM cible                                                |
| AC-07 | Connexion puis expiration                            | Identifiants absents des fiches et prompts, demande de reconnexion                                                      |
| AC-08 | Architecte ou Dev propose un détour                  | Contribution conservée ; consolidation par le seul agent Navigateur, ou édition humaine explicite avec auteur identifié |
| AC-09 | Tentative consommant une ancienne révision           | Référence inchangée ; remplacement explicite et nouveau contrôle                                                        |
| AC-10 | Élément déplacé ou introuvable                       | Échec localisé, aucun faux succès ni réparation silencieuse du contrat                                                  |
| AC-11 | Architecture puis développement                      | Plan et code reliés aux bonnes sources, recherche élargissable et mesurée                                               |
| AC-12 | Test après développement                             | Parcours identifié, critères indépendants, captures et résultats réels                                                  |
| AC-13 | Mauvais serveur ou checkout non attestable           | Observation possible selon autorisation, preuve de version clairement limitée                                           |
| AC-14 | Bibliothèque volumineuse                             | Résultats bornés, récupération à la demande, aucune injection intégrale                                                 |
| AC-15 | Fermeture pendant une démonstration ou un rejeu      | Brouillon/journal conservé, interruption, reprise explicite                                                             |
| AC-16 | Nouvelle fonction entièrement locale sans Copilot    | Import, enregistrement, recherche, édition humaine et rejeu fonctionnent ; enrichissement IA indisponible explicite     |
| AC-17 | Thème sombre, clavier et fenêtre étroite             | Toutes les actions essentielles et demandes humaines restent accessibles                                                |
| AC-18 | Export de recette professionnelle                    | Agrégats transférables sans code, URL, capture ou donnée métier par défaut                                              |

La recette locale utilise une application synthétique extérieure aux projets professionnels. La recette Copilot et la mesure économique seront réalisées par Matt selon le [protocole](PROTOCOLE-EVALUATION.md).
