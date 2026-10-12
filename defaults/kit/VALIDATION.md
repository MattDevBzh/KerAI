# Validation du kit

Contrôles effectués dans cet environnement le 12 octobre 2026.

- JSON : profils et exemples de configuration analysables
- Agent ai-revue : outils limités, pas de modèle imposé
- Agent ai-dev : outils limités, pas de modèle imposé
- Agent ai-cadrage : outils limités, pas de modèle imposé
- Agent ai-tests : outils limités, pas de modèle imposé
- Snapshot : staged + unstaged final et nouveau fichier inclus
- Snapshot : noms sensibles et binaires signalés sans contenu
- Snapshot : index Git inchangé
- Snapshot : troncature visible
- Snapshot : traversée hors dépôt refusée
- TU : dry-run sans lancement, build conservé, restore évité
- TU simulés : pass
- TU simulés : fail
- TU simulés : exit7
- TU simulés : no-trx
- TU simulés : zero
- TU simulés : malformed
- TU : minimum de tests attendu contrôlé
- TU : délai et arrêt de processus testés sous Linux
- TU : runner MTP déclaré refusé
- Snapshot de branche : base explicite et worktree inclus

## Limites
- Les TU .NET réels n’ont pas été exécutés : aucun SDK .NET ni dépôt applicatif fourni.
- Les scénarios de lancement utilisent un faux exécutable dotnet dans un dépôt Git temporaire.
- Le comportement Windows (py, taskkill) et l’intégration dans ta version de VS Code restent à valider sur ton poste.
- Le wrapper cible VSTest et n’est pas un bac à sable ni un détecteur de secrets.
- Les modèles ne sont pas fixés dans le YAML du kit : les sélectionner puis les fixer avec l’éditeur du moteur utilisé.
- Aucun test ne mesure la qualité des modèles ou les économies de crédits sur tes tickets.

## Contrôles supplémentaires de la version 2

- 7 skills et 4 agents présents
- Skill ai-debug : nom, description et invocation manuelle valides
- Skill ai-implement : nom, description et invocation manuelle valides
- Skill ai-plan : nom, description et invocation manuelle valides
- Skill ai-relecture : nom, description et invocation manuelle valides
- Skill ai-tdd : nom, description et invocation manuelle valides
- Skill ai-ticket : nom, description et invocation manuelle valides
- Skill ai-verifier : nom, description et invocation manuelle valides
- Agent ai-cadrage : liste d’outils exacte, sans terminal ni délégation
- Agent ai-dev : liste d’outils exacte, sans terminal ni délégation
- Agent ai-revue : liste d’outils exacte, sans terminal ni délégation
- Agent ai-tests : liste d’outils exacte, sans terminal ni délégation
- Tous les liens relatifs des documents et procédures pointent sur un fichier
- Runner de snapshot et TU identique à la version initiale
- Aperçu : aucune écriture, même dans un chemin avec espaces
- Destination absente : refus sans création
- Installation neuve : 7 skills et README du projet préservé
- Réinstallation identique : aucune nouvelle écriture ni journal
- Mise à jour v1 : agent reconnu remplacé et copie exacte sauvegardée
- Configuration et skill personnel conservés
- Conflit : fichier personnalisé conservé et proposition v2 disponible
- Conflit : code 3 et journal explicite
- Après fusion du conflit : installation répétable sans nouveau conflit
- Lien symbolique de destination : refus avant écriture externe
- Lien symbolique du journal : prévalidation avant toute installation
- Fichier du kit altéré : empreinte refusée avant toute copie
- Traversée hors dépôt dans le manifeste : refus sans écriture

## Portée de ces contrôles

- Exécution réelle de l’installateur sous Linux sur des dossiers temporaires, sans accès à ton poste.
- Validation structurelle des skills, des agents et des liens ; pas d’évaluation de qualité par un modèle Copilot.
- Aucun lancement réel de tests .NET ; le runner est testé avec des fixtures simulées.
- Intégration VS Code/Insiders, outils disponibles et Windows/macOS à vérifier sur ton poste.
- Ni ton skill Matt Pocock ni ton template personnalisé n’étaient fournis.
