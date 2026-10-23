# Utiliser les applications et les parcours

Le panneau **Applications** rassemble les profils d’application, les parcours, le navigateur dédié et les preuves locales. La recherche, l’import, la démonstration et le rejeu déclaré n’appellent aucun modèle. Décrire un parcours prépare une mission du Navigateur dans le workflow existant, avec les validations humaines du cockpit.

## Préparer une application

1. Démarrer l’application locale par sa procédure habituelle.
2. Dans **Applications**, choisir **Ajouter une application**. Renseigner son nom, son origine (par exemple `http://localhost:3000`) et les dépôts associés au cockpit.
3. Déclarer les autres origines locales utiles, le rôle fonctionnel et les consignes de connexion. Les origines HTTPS d’authentification sont des exceptions réservées à la connexion manuelle.
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

Le sous-ensemble Chrome Recorder accepte la navigation locale, la taille de fenêtre standard, le clic principal, le changement de valeur, le défilement et les conditions simples de visibilité. Les touches usuelles doivent avoir une cible explicite et une paire appui/relâchement cohérente. Les cibles CSS, `aria/` et `text/` sont prises en charge dans les cas convertibles ; les chaînes de frames ou de shadow roots sont refusées.

Les expressions JavaScript, actions inconnues, téléchargements, commandes système, gestes maintenus et propriétés non prises en charge provoquent une incompatibilité explicite. Les coordonnées de clic du Recorder ne sont pas reprises : l’avertissement indique que le clic vise le centre de la cible unique. Les alternatives de sélecteurs et titres de navigation non vérifiés sont signalés.

Les valeurs de formulaire importées deviennent des paramètres à renseigner, sans valeur initiale conservée. Elles sont marquées sensibles par défaut : vérifier leur nature dans l’éditeur avant toute transmission au modèle. Les paramètres sensibles restent exclus du contexte IA. Ne pas convertir un identifiant de connexion en valeur fixe pour contourner la connexion manuelle.

Bornes de l’import : 2 Mio, 80 étapes, 20 niveaux JSON et 4 000 caractères par chaîne. Le fichier brut n’est pas archivé automatiquement. Les URLs contenant des identifiants de connexion, des clés de jeton reconnues dans leur requête ou fragment, un code de retour OAuth, un JWT ou un fragment opaque ressemblant à un jeton sont refusées avant sauvegarde et export. Les paramètres métier ordinaires et les fragments d’écran sont conservés. Ce contrôle structurel ne peut pas reconnaître tous les secrets placés librement dans un titre, une note ou une valeur métier : relire ces textes reste nécessaire.

### Montrer

Préparer le navigateur, choisir **Montrer**, puis démarrer l’enregistrement. Réaliser le parcours dans l’application ordinaire. Les commandes Pause, Reprendre, Capturer et Terminer restent dans KerAI.

Suspendre l’enregistrement avant toute connexion. À la fin, donner un titre, une intention et les conditions d’arrivée ; relire les étapes, paramètres et limites avant le rejeu. Une interruption ou une action non prise en charge reste visible. Elle ne devient pas une réussite par simple sauvegarde.

## Vérifier, publier et corriger

La fiche distingue trois informations :

| Information                                          | Signification                      |
| ---------------------------------------------------- | ---------------------------------- |
| Brouillon, Disponible, Archivé                       | État éditorial de la définition    |
| Décrit, Observé, Rejoué avec succès, Échec           | Preuve effectivement disponible    |
| À contrôler, Vérifié pour cette exécution, À réparer | Fraîcheur pour le contexte observé |

Renseigner les paramètres, confirmer les prérequis et les interactions, puis lancer le **rejeu de vérification**. Au moins une condition d’arrivée observable est nécessaire. Une étape manuelle empêche la publication comme parcours automatiquement rejouable.

**Rendre disponible** exige un rejeu hôte réussi de la définition exacte, toutes ses étapes réussies, les prérequis confirmés et l’arrivée vérifiée. Cette publication crée une révision et conserve le reçu du rejeu de vérification. Elle ne valide pas les critères métier de la feature à la place de Matt ou du Testeur.

Une correction crée un nouveau brouillon révisé. L’historique garde les définitions antérieures ; deux sauvegardes concurrentes ne peuvent écraser silencieusement la même révision. Archiver retire le parcours de la sélection courante en conservant ses références historiques. Les autres agents transmettent des contributions ; seul le Navigateur désigné ou une commande humaine explicite modifie la définition canonique.

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

La V1 vise les applications web locales et les interfaces DOM usuelles. Les sessions distantes, SSH/WSL/conteneurs, composants graphiques canvas/WebGL, DOM fermé, dialogues système et gestes non représentables ne sont pas certifiés. Les limites détectées doivent rester visibles, sans ajout d’instrumentation permanente à la cible.

Pour désactiver la navigation, fermer le navigateur depuis **Applications**, retirer la sélection de navigation des prochaines tentatives et désactiver la capacité `navigation` des profils concernés. Les données privées et anciennes preuves restent disponibles. Aucune suppression du profil, des données de l’application ou d’un dépôt cible n’est nécessaire.
