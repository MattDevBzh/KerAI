# Navigation documentée — implémentation et recette locale

## Livraison

L’espace **Applications** est intégré dans le cockpit KerAI : profils et droits, bibliothèque versionnée, description vers une mission préparée du Navigateur, import JSON, démonstration intégrée, édition, variantes, rejeu, publication, historique, contributions, inspection ciblée, pistes de code et comparaison des captures.

Les étapes Architecte, Développeur et Testeur sélectionnent un contexte dans leur préparation habituelle. Le profil, les droits, le parcours et sa révision, les paramètres et les dépôts sont figés par tentative. Les demandes de contexte manquant préservent le travail et proposent une intervention du Navigateur choisie par l’humain. Une nouvelle révision nécessite une nouvelle tentative ; elle n’altère pas l’historique.

Le Navigateur est le seul agent autorisé à écrire les parcours canoniques. Les autres rôles contribuent ; l’édition humaine est identifiée. Les validations existantes du plan, du code avant tests agent et des preuves métier restent appliquées. Les profils personnels ne sont pas remplacés automatiquement : la capacité `navigation` et les compétences sont proposées dans le catalogue.

## Ce qui a été ajouté

| Couche | Réalisation |
| --- | --- |
| IHM KerAI | Espace Applications, préparation des tentatives, relais Navigateur, preuves et journal de campagne A/B |
| Agent | Profil `fs-navigator`, adaptation des profils Architecte, Dev et Testeurs fournis |
| Skills du kit | `navigation-discovery`, `navigation-context`, `screen-code-analysis`, `navigation-verification` |
| Hôte | Bibliothèque à révisions immuables, droits, import/export, contexte figé, index de code, reçus de preuves et journal économique |
| Navigateur | Processus séparé Playwright/Chromium, profil privé application/rôle, enregistrement par événements temporaires, rejeu sans modèle, inspection CDP ciblée |
| Persistance | Données privées sous le stockage KerAI ; migration additive des sessions vers le schéma 11, anciens historiques conservés |
| Distribution | Worker et runtime Playwright exact livrés dans le VSIX ; aucun téléchargement automatique de navigateur |

Aucun composant, SDK, attribut de test, endpoint ou script permanent n’est ajouté aux applications cibles. Le navigateur utilise des écouteurs temporaires et les API d’inspection ; les captures sont masquées après acquisition, sans surcouche dans l’IHM cible.

## Comportements vérifiés localement

| Critères | Contrôle réalisé |
| --- | --- |
| AC-01, AC-10 | Distinction des états, cibles uniques, URL incluant query/fragment, arrivée observable et échec localisé |
| AC-02, AC-14 | Recherche et contexte bornés ; rejeu déterministe sans appel modèle, budget explicite d’exploration |
| AC-03 | Missions et questions via le workflow existant, requête de contexte bloquant les outils, budget/répétitions ; transport SDK simulé |
| AC-04 à AC-06 | Import compatible, refus des opérations inconnues/JavaScript, enregistrement réel, édition puis publication après rejeu |
| AC-07 | Connexion manuelle et suspension des observations, masquage des champs privés, rejet des URLs portant des secrets identifiables |
| AC-08, AC-09 | Propriétaire hôte, contributions, conflits de révision, snapshots figés et reprise explicite |
| AC-11 | Sources/CSS/CDP et recherches textuelles ciblées ; fichiers candidats hashés, racines autorisées, obsolescence et budgets de lecture |
| AC-12, AC-13 | Captures PNG réelles vérifiées, lien aux tentatives/preuves, rôle et binding conservés ; serveur/checkout inconnu affiché comme tel |
| AC-15 | Arrêt, annulation d’outil ou de tentative, fermeture, crash du processus hôte, journal récupéré et reprise explicite |
| AC-16 | Parcours local IHM → service → Chromium → stockage → rechargement sans Copilot |
| AC-17 | Interface sombre, fenêtre étroite claire, navigation clavier et demandes humaines dans les tests UI |
| AC-18 | Exports privés de mesures et journal A/B, références pseudonymisées, code/URLs/captures exclus des exports économiques |

Les tests SDK utilisent un transport simulé. Ils vérifient les outils proposés, les refus du runtime, les capacités visuelles, l’attente humaine et la préparation du contexte. Ils ne prouvent pas l’exécution par le compte Copilot de Matt.

Le journal économique lie aussi les tentatives A sans navigation. Les reçus fournisseur sont figés depuis les sessions et dédupliqués ; les temps humains sont déclarés explicitement. Les inconnus restent inconnus. Les modèles, critères, configurations, répétitions, échecs et coûts d’apprentissage/entretien conditionnent l’admissibilité des comparaisons et l’amortissement. Aucune mesure des fixtures n’est annoncée comme un gain Copilot.

## Limites opérationnelles conservées

- L’application locale doit déjà être démarrée par sa procédure habituelle ; cette version n’ajoute pas de gestionnaire de commandes serveur.
- Le rejeu ouvre un contexte frais et revient à l’origine, en conservant le profil privé d’authentification. Il ne remet à zéro ni les données serveur ni les données persistantes de l’application. Les prérequis doivent être déclarés et confirmés.
- Le build servi ne peut être attesté à partir d’une URL seule. L’association au dépôt reste déclarée/non vérifiée tant qu’aucune preuve ne l’établit.
- Les sources mappées et les recherches de fichiers sont des **candidats**, à confirmer par l’Architecte. Aucun diagnostic global du code n’est déduit d’un nom de fichier.
- Une fenêtre visible ne permet pas un verrouillage physique parfait. Les gestes inattendus interrompent les commandes gérées ; un geste humain identique au geste attendu peut être indiscernable. Les effets déjà produits ne sont pas annulés.
- Les pixels ne sont pas transmis automatiquement au modèle. L’outil de consultation explicite exige un modèle visuel identifié et applique les limites d’images ; les reçus seuls restent utilisables sans vision.
- La recette locale concerne macOS/Chromium. Windows, les contraintes de sécurité professionnelles, le compte Copilot et le rendement sur un grand projet restent à vérifier par Matt selon le protocole.

## Recette reproductible

1. Exécuter les contrôles de types, les tests unitaires/intégration et la construction.
2. Exécuter les tests Playwright du cockpit, dont `ui-navigation-live.spec.ts` avec Chromium déjà installé.
3. Construire le VSIX candidat puis exécuter `scripts/verify-vsix.py --match-build` avec extraction dans un nouveau dossier.
4. Exécuter le smoke VS Code avec `FEATURE_STUDIO_EXTENSION_PATH` pointant sur l’extension extraite et `FEATURE_STUDIO_TEST_NAVIGATION=1`. Le smoke lance le vrai worker du paquet sur la fixture locale, importe, édite, rejoue, capture et rend le parcours disponible sans fournisseur.
5. Sur le poste professionnel, suivre [UTILISATION.md](UTILISATION.md) et [PROTOCOLE-EVALUATION.md](PROTOCOLE-EVALUATION.md), en conservant les données professionnelles sur ce poste.

La navigation est intégrée au paquet 1.29.0 avec le QG grand écran. Les [notes de version](../../releases/v1.29.0.md), la [validation de livraison](../../VALIDATION.md) et la release GitHub distinguent les vérifications locales, la CI et l’empreinte du paquet distribué. La recette professionnelle reste distincte.
