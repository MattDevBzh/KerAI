# Navigation documentée et contexte applicatif

Ce dossier définit une évolution de KerAI qui permet aux agents de retrouver un état d’application, d’en examiner le fonctionnement, puis de cibler le code et les vérifications nécessaires. L’objectif est de réduire les recherches répétées, les tokens consommés et le temps humain sur de gros projets.

**Statut : intégrée à la version 1.29.0 du 23 octobre 2026, candidate à la recette professionnelle.** Le [guide d’utilisation](UTILISATION.md) décrit le parcours complet. Le [compte rendu d’implémentation](IMPLEMENTATION.md) distingue les contrôles locaux, le paquet et les validations restant à réaliser sur le poste professionnel. Aucun gain économique ni fonctionnement avec le compte Copilot professionnel n’est encore mesuré.

## Avis et conditions de réussite

L’idée mérite d’être développée : un parcours connu peut être rejoué sans appel IA et quelques références pertinentes peuvent remplacer des recherches répétées. Sa rentabilité dépend toutefois du taux de réutilisation, de la fraîcheur des parcours et de la qualité du lien écran–code. Une bibliothèque exhaustive, un Navigateur appelé à chaque étape ou des captures systématiquement envoyées au modèle pourraient annuler le gain.

La proposition retient un référentiel ciblé, appris à la demande, une récupération progressive du contexte et un bilan incluant apprentissage, entretien et échecs. Elle ne promet pas de comprendre toutes les dépendances du code à partir d’un écran.

## Décisions exprimées par Matt

- Le Navigateur est l’unique agent responsable de la découverte, de la rédaction et de l’entretien des parcours de navigation.
- L’Architecte utilise ce contexte et Playwright pour analyser l’application, identifier le code et établir le plan.
- Le Développeur utilise le plan, le contexte et Playwright ; le Testeur utilise le contexte et Playwright pour vérifier les critères.
- La première version cible les applications web locales, éventuellement authentifiées.
- Description naturelle, import JSON et démonstration intégrée font tous partie de la première version complète.
- Toute nouvelle IHM appartient à **KerAI**. Aucun ajout de bouton, composant, SDK, attribut de test, script permanent ou endpoint n’est exigé dans les applications professionnelles cibles.
- Le développement se prépare sur le PC personnel, sans compte Copilot disponible pour cette recette. Matt réalisera ensuite la validation Copilot et métier sur son PC professionnel. Aucun projet professionnel précis n’est présumé.

## Documents à lire

| Document                                                          | Contenu                                                                                             |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [Spécifications fonctionnelles](SPECIFICATIONS-FONCTIONNELLES.md) | Rôles, écrans KerAI, parcours utilisateur, règles de gestion et critères d’acceptation              |
| [Spécifications techniques](SPECIFICATIONS-TECHNIQUES.md)         | Architecture, données, outils, stockage, enregistreur, permissions et raccordement au code existant |
| [Plan d’implémentation](PLAN-IMPLEMENTATION.md)                   | Lots ordonnés, dépendances, composants à modifier, livrables IHM et conditions de sortie            |
| [Protocole d’évaluation](PROTOCOLE-EVALUATION.md)                 | Recette locale sans Copilot, recette professionnelle par Matt et mesure des économies               |

## Ce qui change concrètement

| Couche               | Évolution                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| IHM de KerAI         | Espace Applications, bibliothèque, profil d’application, démonstration, import, aperçu du contexte, observations et consommation                  |
| Agent Navigateur     | Nouveau profil, propriétaire éditorial des parcours ; appelé pour apprendre ou réparer une connaissance manquante                                 |
| Agents existants     | Capacités et instructions adaptées pour l’Architecte, le Développeur et les Testeurs                                                              |
| Skills               | Méthodes de découverte, exploitation du contexte, localisation dans le code et vérification ; elles n’assurent ni stockage ni contrôle des droits |
| Hôte de l’extension  | Services de navigation, droits, relais humain, import, recherche, preuves et orchestration                                                        |
| Processus navigateur | Playwright, navigateur dédié, enregistrement et rejeu déterministe, inspection ciblée                                                             |
| Données              | Référentiel privé versionné et index local ; références immuables dans les sessions                                                               |
| Scripts et packaging | Construction du processus navigateur, préparation explicite du navigateur, fixtures, recette et paquet VSIX                                       |
| Applications cibles  | Aucun ajout requis pour utiliser l’outillage ; seules les modifications métier demandées et approuvées suivent le workflow normal                 |

Il s’agit d’une feature du produit, livrée avec son IHM, ses services et sa recette. Un agent ou un ensemble de prompts ne suffirait pas à la réaliser.

## Lecture des engagements

Les exigences `F-*` sont fonctionnelles, les décisions `T-*` techniques et les lots `L*` décrivent la réalisation. Les cibles de performance sont des seuils proposés, pas des résultats observés. Les capacités génériques documentées de Playwright ne constituent pas une preuve de leur intégration dans KerAI.

La première livraison complète comprend tous les lots L0 à L7, dont la démonstration intégrée. Les jalons intermédiaires permettent de vérifier les difficultés tôt ; ils ne réduisent pas ce périmètre. L8 correspond à la recette réelle conduite par Matt et à la décision d’élargissement.
