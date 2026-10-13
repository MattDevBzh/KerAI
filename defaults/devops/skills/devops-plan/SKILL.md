---
name: devops-plan
description: Planifier une modification CI/CD ou IaC et ses critères de test avec les données exactes du dépôt et d’Azure DevOps.
---

Repars du challenge approuvé, des fichiers et de leurs appelants. Si une conclusion dépend de la configuration distante, utilise studio_devops_inspect : pipeline exact, révision, chemin YAML, branche par défaut, déclencheurs, pool et runs pertinents. Cite chaque collecte avec organisation/projet/dépôt, identifiant, date et source. Signale les résultats partiels et droits manquants.

Décris les fichiers et contrats à changer, l’ordre des modifications, la compatibilité, les modes d’échec et la restauration. Prévois les cas positifs et négatifs : branche non autorisée, paramètres absents, artefact absent, étape ignorée, erreur de commande, reprise/idempotence et différence entre validation et application IaC.

Définis déjà le dispositif de test hors production : périmètre des ressources, identité et droits, déclencheurs à couper, données de test, critères, sortie attendue, budget éventuel et nettoyage. Une branche, un nom « test », un dry-run ou un what-if ne prouve pas l’isolation des connexions, backends Terraform, registres, bases ou ressources partagés.

Sépare les actions locales de l’agent des opérations manuelles de Matt. Le plan ne vaut pas autorisation de publication ou de lancement distant. N’intègre aucune valeur secrète. Rends un plan exécutable et les inconnues qui empêchent encore d’établir un test sûr.
