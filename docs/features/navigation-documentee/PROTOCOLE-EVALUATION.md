# Recette et évaluation économique de la navigation documentée

Le protocole distingue ce qui peut être vérifié sans compte Copilot sur le PC personnel et ce que Matt vérifiera ensuite sur son PC professionnel. Aucun projet professionnel, lecteur multimédia ou parcours métier particulier n’est supposé. Les objectifs chiffrés ci-dessous sont des propositions de décision, pas des gains observés.

## 1. Trois niveaux de preuve

| Niveau                          | Lieu et moyens                                                  | Ce que cela prouve                                                                                             |
| ------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Contrats                        | Tests unitaires et transport Copilot simulé                     | Schémas, droits host, catalogue attendu, transitions, stockage, budgets et déduplication                       |
| Fonctionnement navigateur       | Vrai navigateur, IHM KerAI et application synthétique locale    | Description simulée, import, démonstration, inspection, rejeu, captures et absence de modification de la cible |
| Fonctionnement réel et économie | VSIX installé et Copilot réel sur le PC professionnel, par Matt | Outils effectivement offerts/utilisés, permissions, résultat métier et consommation réellement reçue           |

Les deux premiers niveaux permettent de construire un candidat complet. Ils ne démontrent ni les permissions effectives du compte professionnel, ni l’économie fournisseur. Les scripts de test utilisant un fournisseur local déterministe restent dans les deux premiers niveaux.

## 2. Recette locale sans compte fournisseur

Préparer une application synthétique distincte des projets cibles : authentification locale, rôle limité et rôle éditeur, liste/détail, onglets partageant la même URL, dialogue, erreur de formulaire et chargement asynchrone. Ajouter un écran sans attributs de test, un build sans source maps et un cas de composant partagé. L’outillage doit aussi fonctionner sur ces chemins non instrumentés.

Vérifier successivement :

1. Préparation dans KerAI, diagnostic d’URL absente, serveur existant et version non attestable.
2. Description via adaptateur simulé, question, réponse et reprise ; aucun résultat présenté comme raisonnement Copilot réel.
3. Import portable et Chrome Recorder : aperçu, paramètres, rejet des étapes inconnues et expressions JavaScript.
4. Démonstration humaine depuis KerAI, pause pendant connexion, état final nommé, édition et rejeu dans un nouveau contexte.
5. Deux états distincts pour une URL ; distinction des modes atteindre/reproduire.
6. Architecte simulé consommant seulement un extrait ; recherche ciblée et correction d’un faux fichier candidat.
7. Refus d’écriture documentaire par Dev/Testeur ; contribution puis nouvelle révision par le Navigateur.
8. Testeur conservant critères et révision ; échec visible lorsque le parcours ou l’application diverge.
9. Reprise de main, bail périmé, annulation, crash, redémarrage et absence de relance spontanée.
10. Captures avant/après et références hôtes ; contrôle des secrets et exports.
11. Bibliothèque synthétique volumineuse : 5 000 fiches, recherche bornée, récupération progressive et index reconstruisible. Cible exploratoire : recherche chaude locale sous 500 ms au percentile 95 sur la machine de référence documentée ; le premier chargement est mesuré séparément.
12. VSIX extrait et réellement lancé : worker disponible, navigateur préparé explicitement, fichiers de l’application cible inchangés par l’outillage. Les modifications métier éventuelles du scénario de développement sont contrôlées séparément.

La recette IHM couvre clavier, focus, thèmes, contraste, fenêtre étroite, réouverture et demandes humaines. Les captures de KerAI sont fournies à Matt pour validation ; elles ne représentent pas une acceptation anticipée de l’interface.

## 3. Recette réelle sur le PC professionnel

Matt choisit lui-même une application locale et les données dont l’usage est autorisé. Aucune donnée de son projet n’est requise pour terminer les spécifications ou la préparation locale.

| Étape | Action de Matt                                                    | Preuve attendue                                                                         |
| ----- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1     | Installer le candidat dans un environnement autorisé              | Version KerAI, version du runtime et identité du paquet                                 |
| 2     | Configurer l’application dans KerAI et ouvrir le navigateur dédié | Application accessible, dépôts associés, prérequis et binding affichés                  |
| 3     | Se connecter manuellement                                         | Rôle utilisé, absence d’identifiants dans les propositions et exports                   |
| 4     | Apprendre un accès par description                                | Appel réel du Navigateur, éventuelle question, états observés et recette enregistrée    |
| 5     | Apprendre un accès par import puis un autre par démonstration     | Même bibliothèque, rejeu réel et aucune modification d’IHM du projet cible              |
| 6     | Demander une analyse à l’Architecte                               | Parcours/révision utilisés, fichiers pertinents et raisonnement vérifiable              |
| 7     | Réaliser une modification autorisée puis la vérifier              | Plan/code validés selon le workflow, Testeur utilisant le contexte, preuves comparables |
| 8     | Refaire une tâche liée et provoquer une péremption contrôlée      | Réutilisation, contribution, réparation bornée et coût d’entretien compté               |
| 9     | Fermer puis reprendre                                             | Références et historique conservés, reprise explicite                                   |
| 10    | Examiner le bilan et l’export agrégé                              | Couverture des mesures et décision distincte sur qualité et économie                    |

Une incompatibilité de runtime, de politique du poste ou d’enregistrement ne doit pas être contournée en modifiant le projet professionnel. Fournir le diagnostic filtré et conserver le statut bloqué/partiel approprié.

## 4. Comparaison équitable

Comparer deux conditions sur les mêmes tâches :

- **A — KerAI sans nouvelle bibliothèque**, avec les accès habituels au code, documentation, recherche et les mêmes capacités navigateur mises à disposition pour la comparaison.
- **B — Les mêmes moyens avec la bibliothèque**, son apprentissage, ses références et son entretien.

Le contrôle A ne doit pas être forcé à lire tout le dépôt ni privé de Playwright pour améliorer artificiellement B. Un second bilan avant/après produit peut être présenté séparément, car il mêle l’apport du navigateur et celui de la bibliothèque.

Corpus proposé : six tickets indépendants, dont deux évolutions, deux adaptations touchant plusieurs composants et deux corrections, partageant certains accès sans réutiliser exactement la même solution. Prévoir une modification contrôlée de navigation pour mesurer l’entretien. Chaque ticket part d’un snapshot de code et de données défini ; les changements d’une exécution ne contaminent pas la suivante.

Le premier passage peut être limité à une paire A/B par ticket, soit 12 exécutions, après choix du budget par Matt. Deux répétitions donnent 24 exécutions et réduisent la sensibilité au hasard. Ce sont des campagnes proposées, jamais des appels autorisés par le présent document. Un essai de deux tickets peut d’abord vérifier l’instrumentation, sans servir à annoncer un pourcentage général.

Conserver modèle effectif, effort de raisonnement lorsque connu, runtime, permissions, critères, délais, version initiale et rôle utilisateur comparables. Alterner ou randomiser l’ordre. Utiliser des conversations distinctes et éviter de transmettre les solutions de A à B. La connaissance initiale est construite depuis l’application et les indications disponibles, sans accès anticipé aux solutions des tickets évalués.

Geler la bibliothèque avant la campagne, puis compter toute modification comme entretien avec sa révision. Les conditions de cache fournisseur ne sont pas supposées contrôlables : relever les informations disponibles, les inconnus et les différences.

Chaque répétition de la séquence repart du même catalogue initial et du même index d'ancres techniques ; elle ne bénéficie pas des solutions de la répétition précédente. À l'intérieur d'une séquence de réutilisation, suivre un ordre de tickets préétabli et conserver toutes les évolutions datées et comptées. Les répétitions estiment la variabilité ; elles ne sont pas autant de nouveaux besoins métier pour calculer l'amortissement. Le temps d'apprentissage humain de Matt entre A et B reste un biais possible à signaler malgré l'alternance des conditions.

## 5. Mesures

| Catégorie     | Mesures                                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Qualité       | Critères satisfaits, erreurs critiques, mauvaises zones de code modifiées, régressions, tâches réussies ou bloquées    |
| Fournisseur   | Tokens entrée/sortie, cache si reçu, unité de coût réellement reçue, modèle effectif, couverture et déduplication      |
| Temps         | Durée totale, temps actif, attente humaine, préparation/connexion et interruptions ; frontières de phases enregistrées |
| Exploration   | Recherches, lectures, octets/extraits remis au modèle, inspections, actions, captures envoyées et largeur de recherche |
| Réutilisation | Parcours trouvés, rejoués, échoués, réparés, références techniques réutilisées et invalidées                           |
| Apprentissage | Appels, temps humain de démonstration/import/revue, rédaction et premiers rejeux                                       |
| Entretien     | Réparations, revalidations, reprises et nettoyage requis par la campagne                                               |

L’implémentation actuelle estime les tokens du prompt par caractères/4 et agrège les usages mesurés. Cette estimation sert à dimensionner le contexte, pas à prouver l’économie. Les tokens d’images, descriptions d’outils et historiques ne sont pas supposés gratuits. Les champs de cache ou de durée présents dans le SDK sont exploités uniquement s’ils sont effectivement reçus.

Le coût monétaire n’est pas déduit du nombre de tokens. Respecter l’unité remontée par Copilot, notamment `nano-AIU` lorsque disponible, sans inventer un taux de conversion. Une baisse de tokens sans coût fournisseur connu est présentée comme une baisse de tokens seulement.

## 6. Calculer le gain et l’amortissement

Pour une métrique comparable `M`, compter :

```text
Total_A = préparation_A + somme(exécutions_A + reprises_A)
Total_B = apprentissage_B + préparation_B + somme(exécutions_B + reprises_B) + entretien_B
Gain_cumulé = (Total_A - Total_B) / Total_A
```

Si `Total_A` vaut zéro ou si la couverture est incomplète, ne pas publier ce pourcentage comme un gain complet. Compter les échecs et annulations, pas seulement les tâches réussies. Ne pas additionner le registre par appel aux snapshots cumulatifs qui représentent déjà les mêmes événements. Si un appel couvre plusieurs phases sans ventilation fiable, le conserver comme mixte ; le total reste la référence.

Présenter séparément apprentissage initial, utilisation à chaud, entretien et cumul. Un seuil d’amortissement observé est le premier nombre d’utilisations pour lequel le cumul B devient inférieur à A. Une projection fondée sur une économie moyenne positive est possible, mais elle doit être nommée projection et inclure une hypothèse d’entretien explicite. Ne pas compter les données manquantes comme des zéros.

Ce premier croisement n'est pas définitif : une réparation ultérieure peut l'annuler. Afficher aussi le bilan de fin de séquence après la dérive contrôlée. Pour chaque paire de qualité comparable, complète et de dénominateur positif, calculer `gain_i = 1 - M_B_i / M_A_i`, puis la médiane de ces gains appariés. Afficher nombre de paires admissibles/nombre prévu et raisons d'exclusion. Une mesure partielle décrit uniquement ce sous-ensemble ; elle ne permet pas de généraliser le gain à toute la campagne. Les échecs exclus d'une comparaison de qualité restent comptés dans les totaux de campagne.

Pour le temps, présenter à la fois le total et le temps actif ; le temps de démonstration et de réponse aux questions est un coût réel même lorsqu’il ne consomme pas de tokens.

## 7. Décisions proposées

| Axe              | Condition de passage proposée                                                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fonctionnel      | Les trois entrées fonctionnent, parcours versionnés, propriété Navigateur appliquée, cible non modifiée par l’outillage                                           |
| Qualité          | Aucun ticket supplémentaire non accepté en B, aucun défaut critique supplémentaire, mêmes critères et plafonds ; aucun gain obtenu en supprimant une vérification |
| Mesure           | Chaque comparaison est accompagnée de sa couverture ; économie fournisseur non démontrée si la métrique nécessaire manque                                         |
| Gain à chaud     | Cible de médiane : au moins 25 % de tokens totaux en moins et 15 % de temps actif en moins, sur les paires complètes et comparables                               |
| Coût fournisseur | Pas d’augmentation observée sur les comparaisons complètes ; aucune affirmation lorsque le coût est inconnu                                                       |
| Amortissement    | Cible : apprentissage et entretien récupérables en dix réutilisations comparables au maximum ; distinguer observation et extrapolation                            |
| Maintenabilité   | Une dérive localisée se répare sans relire toute la bibliothèque ni invalider tous les projets                                                                    |

Ces seuils servent à décider du pilote, pas à garantir une rentabilité générale. Un petit corpus donne une indication, pas une preuve statistique universelle. Si les gains à chaud existent mais que l’entretien annule le cumul, conserver éventuellement l’intérêt ergonomique tout en refusant de présenter la feature comme une économie démontrée.

## 8. Export et confidentialité

Par défaut, le rapport transférable contient identifiants opaques, versions, agrégats, couverture, verdicts et limites. Il exclut code, noms de fichiers, chemins locaux, URLs, prompts, captures, valeurs métier et profils de connexion. Les détails restent sur le poste professionnel. Matt peut examiner et autoriser un export plus détaillé séparément selon ses règles.

Le bilan final distingue explicitement : contrats vérifiés, navigateur local vérifié, Copilot réel vérifié, acceptation métier et économie mesurée. Aucun de ces états ne remplace les autres.
