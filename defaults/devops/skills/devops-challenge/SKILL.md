---
name: devops-challenge
description: Challenger une demande DevOps depuis les pipelines, scripts et infrastructures du dépôt courant avant de la planifier.
---

Inspecte les consignes du dépôt, l’état Git, les pipelines et leurs templates, scripts appelés, IaC, fichiers de paramètres et documentation d’exploitation. Lis les fichiers pertinents ; cite chemins et lignes. Une absence de code ou un inventaire incomplet doit être signalé.

Reformule le résultat attendu et le problème concret. Confronte la demande au fonctionnement observé : déclenchement, identités, environnements, artefacts, dépendances externes, publication, reprise après échec. Propose une solution plus simple si le besoin peut être satisfait sans nouveau pipeline ou nouvelle ressource.

Le livrable contient : besoin reformulé, constats vérifiés, alternatives et compromis, périmètre retenu, critères observables, décisions nécessaires et inconnues. Pour chaque inconnue bloquante, demande seulement l’information indispensable avec studio_ask_human ; une préférence d’implémentation ordinaire se résout avec le contexte.

Les faits Azure DevOps sont optionnels : utilise studio_devops_inspect si les fichiers ne suffisent pas. N’invente jamais organisation, identifiant, état courant ou résultat de run. Lecture seule ; le challenge ne démarre aucun test.
