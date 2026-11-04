# Utiliser les applications et les parcours

Le panneau **Applications** rassemble les profils d’application, les parcours, le navigateur dédié et les preuves locales. La recherche, l’import, la démonstration et le rejeu déclaré n’appellent aucun modèle. Décrire un parcours prépare une mission du Navigateur dans le workflow existant, avec les validations humaines du cockpit.

## De zéro à la correction de la fiche voiture Oula

1. Ajouter l’application avec son adresse, le projet de code et le Navigateur responsable. Le profil et les droits se trouvent dans **Configuration de l’application et droits** ; les actions quotidiennes restent en haut de l’écran. Les favoris et le dernier accès sélectionné sont mémorisés par projet sur ce poste.
2. Choisir **Préparer le navigateur**. Le diagnostic indique l’exécutable retenu : Chromium déjà installé, sinon Chrome ou Edge aux emplacements usuels. Le chemin du profil permet de choisir explicitement Edge, y compris sous Windows. Aucun téléchargement n’est lancé. La fenêtre utilise un profil KerAI dédié, pas les onglets personnels déjà ouverts.
3. Passer en **Connexion manuelle**, se connecter puis rendre le contrôle. Le rôle et l’authentification doivent correspondre au compte de recette. Une interaction d’agent ne peut commencer pendant la connexion manuelle.
4. Décrire « ouvrir un garage existant de type Oula, puis une de ses voitures », importer un enregistrement Edge/Chrome, ou montrer cet accès. Relire le brouillon créé, désormais sélectionné automatiquement. La fiche indique ce qui manque : indices d’arrivée, valeurs de formulaire à revoir, gestes manuels à remplacer.
5. Documenter la sélection métier depuis les éléments visibles. Une étape **Sélectionner une donnée métier** choisit un garage selon un filtre relatif (par exemple texte Oula), lit son attribut `data-id` et conserve `garageId`. Une deuxième étape cherche une voiture dans ce garage et conserve `carId`. Choisir un résultat unique ou explicitement le premier ; une sélection ambiguë ne devient pas un succès. Les données doivent déjà exister : la résolution ne crée rien et ne consulte pas une base en dehors de l’écran.
6. Réutiliser ces sorties dans les cibles, adresses et conditions avec `{{garageId}}` et `{{carId}}`. Les substitutions URL et CSS sont échappées. Une valeur absente arrête le parcours. Les identifiants choisis apparaissent dans le compte rendu et **Réutiliser ce cas exact** les reprend. Lors des étapes suivantes, ils deviennent des contraintes : une voiture absente ne sera pas remplacée silencieusement.
7. Si l’accès au garage est déjà publié, le sélectionner dans **Blocs réutilisables avant ces étapes**. Les blocs sont exécutés dans l’ordre choisi, avec leurs conditions d’arrivée. Leurs révisions sont figées ; paramètres et prérequis sont partagés. Les cycles, blocs archivés/étrangers et paramètres incompatibles sont refusés. L’export portable développe les blocs en étapes autonomes.
8. Confirmer les prérequis et les interactions, vérifier le brouillon puis **Rendre disponible**. Une condition qui apparaît avec retard est attendue pendant un délai borné, sans répéter le clic. L’échec désigne l’étape et la cible concernées et donne accès à l’édition, à l’inspection ou à une mission du Navigateur.
9. Depuis le parcours, choisir **Utiliser pour corriger un bug**, saisir ce qui est observé et attendu. La session de correction conserve l’application, la révision et les paramètres pour le plan, le développement et les tests. Depuis l’écran courant, **Corriger ce que je vois** joint une capture initiale vérifiée, son adresse, le rôle et les dimensions ; un accès non documenté reste à compléter.
10. Au lancement d’un agent, choisir **Reproduire** pour repartir de la page initiale et exécuter toute la séquence, ou **Atteindre** pour réutiliser une arrivée/un jalon dont les conditions sont encore vraies. Les étapes sautées restent indiquées ; elles ne sont pas comptées comme des actions rejouées. Les données du serveur ne sont jamais réinitialisées implicitement.
11. Si l’accès bloque, l’agent peut demander l’intervention du Navigateur. L’option **Préparer automatiquement une mission du Navigateur si l’accès bloque** crée une mission liée après l’arrêt de la tentative. Son lancement conserve la préparation habituelle. Après publication de la réparation, sélectionner la révision et **Reprendre ma correction avec cet accès** dans la correction initiale : une nouvelle tentative utilise cette révision, l’ancienne preuve reste intacte et les paramètres compatibles sont conservés.
12. Rejouer le même cas après correction et capturer l’état. Le rapprochement automatique avant/après exige le même parcours, la même révision, les mêmes paramètres, le même rôle et les mêmes dimensions. Deux captures de contextes différents restent comparables explicitement, avec une indication visible.

## Relier le serveur et les fichiers travaillés

Dans les réglages d’environnement du profil, associe un projet et les noms de tâches VS Code existantes pour démarrer et construire l’application. Les boutons exécutent ces tâches dans le projet choisi ; le Navigateur ne reçoit pas un terminal général. En cas de tâche absente ou ambiguë, le cockpit l’explique.

Pour vérifier ce qui est servi, déclarer un fichier local et l’URL de la même ressource de l’application. Le contrôle compare leurs empreintes, conserve le dossier de travail, le commit disponible et l’état des modifications locales. Il peut être renouvelé après une construction. Le fichier et la réponse sont limités à 8 Mio, sans retour du corps au modèle. Une empreinte identique prouve cette ressource seulement ; elle ne certifie pas tout le serveur ni la base de données. Une différence ou une absence de configuration reste **Version non vérifiée**.

Dans l’inspection, rechercher les sources puis confirmer leur lien avec le parcours sélectionné. Les liens sont conservés et proposés au prochain contexte. Une modification du fichier les marque à revérifier. La liste **Accès à revérifier** remonte aussi les dépendances modifiées, nouvelles révisions et blocs devenus indisponibles. Mettre à jour une dépendance demande un nouveau brouillon puis une vérification ; aucune substitution de révision n’est faite en douce.

## Préparer une application

1. Vérifier que l’application est accessible depuis le poste. Pour une application locale, démarrer son serveur par sa procédure habituelle.
2. Dans **Applications**, choisir **Ajouter une application**. Renseigner son nom, son **Adresse de l’application** et les dépôts associés au cockpit. Tous les domaines HTTP ou HTTPS sont acceptés : `http://localhost:3000`, `https://mon-application.fr`, `http://intranet:8080` ou `https://preprod.mon-app.test:8443`. Une URL complète, par exemple `https://mon-application.fr/espace#tableau`, conserve sa page de départ et autorise son origine. Les identifiants et paramètres reconnus comme secrets sont refusés.
3. Déclarer les autres origines utiles, le rôle fonctionnel et les consignes de connexion. Chaque combinaison protocole, domaine et port doit être explicitement autorisée ; aucun sous-domaine supplémentaire n’est autorisé implicitement. Les origines HTTPS d’authentification restent réservées à la connexion manuelle.
4. Choisir la politique d’interaction : inspection, confirmation ou interactions autorisées dans le périmètre choisi. Un libellé « lecture » dans un import ou une proposition d’agent ne donne aucun droit supplémentaire.
5. Désigner le Navigateur parmi les agents du catalogue. Cette attribution n’altère pas les profils personnels.
6. Choisir **Préparer le navigateur**. Un Chromium autorisé doit déjà être disponible ; un chemin d’exécutable peut être fourni dans le profil. Le diagnostic ne télécharge aucun navigateur et ne démarre aucun serveur applicatif.

Le contexte est local au poste. L’association d’un dépôt, d’un port et d’une application n’atteste pas le build servi. L’interface conserve donc une version non vérifiée lorsque cette correspondance n’est pas prouvée.

## Se connecter et garder la main

Utiliser **Connexion manuelle · suspendre la capture**, puis se connecter dans la fenêtre dédiée. Pendant cette phase, l’inspection, les captures et les interactions d’agent sont suspendues. Rendre explicitement le contrôle à KerAI pour poursuivre sur une origine applicative autorisée.

**Reprendre la main**, **Arrêter** et la fermeture du navigateur interrompent les commandes gérées. Un clic déjà produit ne peut être annulé rétroactivement. Une interruption exige une reprise explicite ; la réouverture ne rejoue pas automatiquement le parcours. Aucun bandeau ou bouton KerAI n’est ajouté à l’application cible.

## Apprendre un parcours

### Décrire

Décrire l’objectif, l’état initial, le rôle requis et les indices permettant de reconnaître l’arrivée. **Préparer la mission du Navigateur** ouvre la préparation habituelle : vérifier l’agent, le modèle, les droits et le contexte avant lancement. Sans fournisseur connecté, l’import et la démonstration restent utilisables ; cette mission ne devient pas une analyse réelle par simulation.

### Importer

Coller un JSON portable KerAI ou un JSON Chrome Recorder supporté. L’import crée un **brouillon**, présente les avertissements et ne lance aucune action navigateur.

Le sous-ensemble Recorder Edge/Chrome accepte la navigation HTTP/HTTPS, la taille de fenêtre standard, les clics principal/secondaire/milieu, le double-clic (`doubleClick`, `doubleclick`, ou `clickCount: 2`), les clics de durée limitée (5 secondes maximum), le changement de valeur, le défilement et les conditions simples de visibilité. Toutes les étapes incompatibles sont listées dans un même diagnostic. Le navigateur utilisé pour enregistrer ne décide pas de la compatibilité : ce sont les actions et propriétés du fichier qui comptent. Le rejeu reste limité aux origines du profil. Les touches usuelles doivent avoir une cible explicite et une paire appui/relâchement cohérente. Les cibles CSS, `aria/` et `text/` sont prises en charge dans les cas convertibles ; les chaînes de frames ou de shadow roots sont refusées.

Les expressions JavaScript, actions inconnues, téléchargements, commandes système, combinaisons de touches maintenues et propriétés non prises en charge provoquent une incompatibilité explicite. Les coordonnées de clic du Recorder ne sont pas reprises : l’avertissement indique que le clic vise le centre de la cible unique. Les alternatives de sélecteurs et titres de navigation non vérifiés sont signalés.

Les valeurs de formulaire importées deviennent des paramètres à renseigner, sans valeur initiale conservée. Elles sont marquées sensibles par défaut : vérifier leur nature dans l’éditeur avant toute transmission au modèle. Les paramètres sensibles restent exclus du contexte IA. Ne pas convertir un identifiant de connexion en valeur fixe pour contourner la connexion manuelle.

Bornes de l’import : 2 Mio, 80 étapes, 20 niveaux JSON et 4 000 caractères par chaîne. Le fichier brut n’est pas archivé automatiquement. Les URLs contenant des identifiants de connexion, des clés de jeton reconnues dans leur requête ou fragment, un code de retour OAuth, un JWT ou un fragment opaque ressemblant à un jeton sont refusées avant sauvegarde et export. Les paramètres métier ordinaires et les fragments d’écran sont conservés. Ce contrôle structurel ne peut pas reconnaître tous les secrets placés librement dans un titre, une note ou une valeur métier : relire ces textes reste nécessaire.

### Montrer

Préparer le navigateur, choisir **Montrer**, puis démarrer l’enregistrement. Réaliser le parcours dans l’application ordinaire. Les commandes Pause, Reprendre, Capturer et Terminer restent dans KerAI.

Suspendre l’enregistrement avant toute connexion. Après avoir rendu le contrôle, reprendre explicitement l’enregistrement si une démonstration est conservée. À la fin, donner un titre, une intention et les conditions d’arrivée ; relire les étapes, paramètres et limites avant le rejeu. Une interaction dont la cible a disparu avant vérification reste une étape manuelle à corriger avant publication. Elle ne devient pas une réussite par simple sauvegarde.

## Vérifier, publier et corriger

La fiche distingue trois informations :

| Information                                          | Signification                      |
| ---------------------------------------------------- | ---------------------------------- |
| Brouillon, Disponible, Archivé                       | État éditorial de la définition    |
| Décrit, Observé, Rejoué avec succès, Échec           | Preuve effectivement disponible    |
| À contrôler, Vérifié pour cette exécution, À réparer | Fraîcheur pour le contexte observé |

Renseigner les paramètres, confirmer les prérequis et les interactions, puis lancer le **rejeu de vérification**. Au moins une condition d’arrivée observable est nécessaire. Une étape manuelle empêche la publication comme parcours automatiquement rejouable.

**Rendre disponible** exige un rejeu hôte réussi de la définition exacte, toutes ses étapes réussies, les prérequis confirmés et l’arrivée vérifiée. Cette publication crée une révision et conserve le reçu du rejeu de vérification. Elle ne valide pas les critères métier de la feature à la place de Matt ou du Testeur.

Une correction crée un nouveau brouillon révisé. La dernière révision publiée reste sélectionnable et recherchable pendant cette correction. L’historique garde les définitions antérieures ; deux sauvegardes concurrentes ne peuvent écraser silencieusement la même révision. Archiver retire le parcours de la sélection courante en conservant ses références historiques. Les autres agents transmettent des contributions ; seul le Navigateur désigné ou une commande humaine explicite modifie la définition canonique.

## Utiliser les parcours dans une tentative

Dans la préparation, sélectionner l’application et, si utile, un parcours disponible. Choisir **Atteindre cet état** ou **Reproduire ce parcours**, renseigner les paramètres non sensibles et vérifier les droits d’interaction.

L’hôte fige le profil, la révision, les paramètres, les droits et le binding dans une empreinte. Une nouvelle révision ou un changement de contexte impose une nouvelle préparation ; un consommateur ne remplace pas la révision figée par celle qu’il vient de découvrir. Une tentative sans navigation conserve son fonctionnement habituel.

Le Navigateur dispose d’outils de navigation et de lecture ; il ne reçoit pas les outils d’édition du code ou de terminal. L’Architecte, le Dev et le Testeur disposent des droits prévus par leur propre workflow, avec lecture/contribution du référentiel. Les permissions navigateur sont indépendantes de la politique d’écriture du code.

La recherche fournit jusqu’à cinq résultats dans 6 000 caractères. Le contexte sélectionné est limité à 12 000 caractères ; une définition trop grande demande une sélection plus ciblée. Les observations détaillées sont demandées progressivement. Ces volumes locaux ne constituent pas une mesure d’économie fournisseur.

## Écran, code et preuves

L’inspection cible les éléments, styles et métadonnées utiles. Les corps de réponses réseau et données d’authentification ne sont pas retournés par défaut. La recherche de sources produit des candidats avec chemins relatifs, motifs et empreintes ; un nom de fichier ressemblant à un libellé ne prouve pas une correspondance.

Les captures sont des fichiers privés avec empreinte SHA-256 et métadonnées hôtes. La comparaison avant/après affiche les états observés ; elle n’établit pas leur acceptation métier. Les pixels ne sont pas automatiquement transmis au modèle. Une capture altérée ou hors stockage privé est refusée.

L’export de parcours retire auteur hôte, références de rejeu, valeurs initiales de paramètres et valeurs fixes de formulaire. Il n’inclut ni profil navigateur ni capture. Relire l’aperçu exporté : titres, notes, URLs et conditions d’arrivée peuvent contenir des informations métier que l’utilisateur a explicitement rédigées.

L’export de mesures distingue actions, durée, volume local, réussites, échecs et interruptions. Il ne calcule aucun gain économique. Pour comparer les coûts complets, joindre les consommations d’apprentissage, d’entretien et de revue des sessions selon le [protocole d’évaluation](PROTOCOLE-EVALUATION.md).

## Tenir une campagne comparative A/B

Dans **Applications → Évaluer la qualité, le temps et la consommation**, créer une campagne avec son périmètre, les tickets, les phases attendues et les répétitions indépendantes. A conserve les moyens habituels ; B utilise les mêmes moyens avec la bibliothèque. Le journal fonctionne sans profil d’application et ne lance aucun agent.

**Ajouter une mesure** pour chaque condition, ticket, répétition et phase. Déclarer le résultat et l’acceptation de qualité, puis saisir séparément préparation, connexion, démonstration, travail et attente humaine. Ces secondes sont **déclarées manuellement** : ne pas compter deux fois une durée. Une case vide signifie inconnu ; saisir zéro seulement pour une durée effectivement nulle. Le temps actif additionne les quatre premières catégories et le temps total ajoute l’attente humaine.

Pour les consommations fournisseur, lier les tentatives du registre, y compris celles de la condition A sans navigation. L’hôte fige les reçus existants et refuse de compter une même tentative dans plusieurs mesures. Conserver les reprises échouées avec la tentative finalement réussie. Une tentative mélangeant plusieurs phases reste **Non ventilé**. Si aucun reçu n’est disponible, laisser l’usage inconnu ; **Aucun appel fournisseur** est une déclaration explicite, pas une mesure automatique. La saisie d’une campagne ne consomme aucun appel fournisseur.

Renseigner modèle effectif, runtime, permissions, rôle, critères d’acceptation et snapshots initiaux de code, données, bibliothèque et index. Chaque répétition recommence dans son état initial. Les reçus de modèles incompatibles, les résultats non acceptés et les configurations différentes excluent la paire ; les raisons restent visibles. **Réutiliser ce contexte** prépare une nouvelle mesure sans recopier ses durées ni ses usages. **Corriger la mesure** permet une correction déclarée ; **Retirer cette mesure** retire une saisie erronée du journal.

Enregistrer également l’**Apprentissage** et l’**Entretien** pour A et B dans chaque répétition, même lorsqu’un coût est explicitement nul. Leur ordre dans la séquence situe ces coûts avant ou après les usages. Une couverture absente, un coût inconnu ou une phase non ventilée empêche le gain cumulé complet et l’amortissement. Une médiane calculée sur les seules paires admissibles n’établit pas le gain de toute la campagne. Une dépense d’entretien ultérieure peut annuler un premier amortissement ; les répétitions ne sont pas additionnées comme des usages successifs.

**Aperçu d’export de campagne** conserve les valeurs exactes, les échecs, les références opaques, les totaux, la couverture et les exclusions. Les noms, chemins, observations libres et captures restent locaux. Les données synthétiques des tests vérifient les calculs et la persistance ; elles ne démontrent aucune économie réelle. La validation métier et économique suit le [protocole d’évaluation](PROTOCOLE-EVALUATION.md).

## Compatibilité et vérification

| Périmètre                                                | État à établir                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Schémas, stockage, import, contexte et permissions hôtes | Tests locaux déterministes, sans fournisseur                                         |
| Catalogue configuré et métadonnées SDK                   | Transport simulé ; ce résultat ne prouve pas le compte Copilot professionnel         |
| Chromium, enregistreur, rejeu et captures                | Tests avec un navigateur réel déjà disponible sur le poste de test                   |
| Interface du cockpit                                     | Parcours UI, rechargement, clavier et captures visuelles à valider                   |
| Archive VSIX et worker extrait                           | Contrôle du candidat réellement construit, distinct du code source                   |
| Windows/macOS, règles du poste et Copilot professionnel  | Recette sur le poste concerné ; aucune certification déduite d’une autre plateforme  |
| Économie et acceptation métier                           | Recette de Matt sur corpus autorisé ; aucune économie annoncée à partir des fixtures |

Les applications web locales ou en ligne sont acceptées en HTTP/HTTPS, avec les interfaces DOM usuelles. Le navigateur s’exécute sur le poste et conserve les contrôles habituels des certificats HTTPS. Les sessions distantes SSH/WSL/conteneurs, composants graphiques canvas/WebGL, DOM fermé, dialogues système et gestes non représentables ne sont pas certifiés. Les limites détectées doivent rester visibles, sans ajout d’instrumentation permanente à la cible.

Pour désactiver la navigation, fermer le navigateur depuis **Applications**, retirer la sélection de navigation des prochaines tentatives et désactiver la capacité `navigation` des profils concernés. Les données privées et anciennes preuves restent disponibles. Aucune suppression du profil, des données de l’application ou d’un dépôt cible n’est nécessaire.
