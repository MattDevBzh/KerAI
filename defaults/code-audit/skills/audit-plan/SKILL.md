---
name: audit-plan
description: "Plan et couverture de l’audit. Utiliser pour l’étape plan du kit Audit de code et restitution, à partir des livrables validés et des réponses de l’utilisateur."
---

# Plan et couverture de l’audit

Appliquer d’abord le [contrat commun](../audit-method/SKILL.md).

À partir du contrat validé, inventorier réellement les fichiers accessibles et leurs dépendances utiles. Pour un audit des instructions IA, inclure les agents, compétences, prompts, conventions, mémoires, scripts et références liées dans le périmètre ; suivre les liens locaux autorisés. Une configuration qui référence une ressource absente doit être inscrite dans le registre, pas ignorée.

Planifier les lots dans l’ordre des dépendances et répartir les critères Cxx. Préparer le registre de couverture par fichier, le mode de lecture paginée des fichiers volumineux et les points de contrôle. Définir preuves attendues, règle de déduplication, échelle de gravité/confiance et conditions de conclusion. Ne jamais promettre une lecture exhaustive avec un simple grep. Si le volume dépasse les moyens disponibles, proposer des lots, un ordre de priorité et une reprise explicite ; demander de réduire le périmètre seulement si nécessaire, sans marquer le reste comme lu.

Rendre un plan vérifiable et la couverture initiale (non lue), plus les accès manquants. Ne pas rédiger les conclusions de l’audit avant les lectures. Attendre la validation du plan.
