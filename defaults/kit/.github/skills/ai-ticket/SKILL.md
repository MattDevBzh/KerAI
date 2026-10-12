---
name: ai-ticket
description: "Analyser et reformuler un ticket, clarifier les décisions utiles et définir les critères d’acceptation. Invocation explicite avant le développement."
argument-hint: "[ticket ou contenu de la demande]"
user-invocable: true
disable-model-invocation: true
---

# Cadrer un ticket

Agent recommandé : `ai-cadrage`. Travailler en lecture seule, sans commande ni sous-agent.
Lire la [carte du dépôt](../../../.ai/project.md), le ticket et seulement le code
nécessaire pour vérifier le comportement actuel. Consulter le [format ticket](../../../templates/ticket.md).

1. Extraire le résultat métier attendu, les acteurs, les contraintes et les exclusions.
2. Distinguer les faits prouvés par un fichier, les demandes du ticket et les hypothèses.
   Ne pas demander à l'utilisateur une information trouvable dans les fichiers accessibles.
3. Repérer les ambiguïtés sur le comportement, la compatibilité, les données et les erreurs.
   Poser au plus trois questions bloquantes par tour, avec recommandation et conséquence.
   Attendre les réponses lorsque le choix change le contrat. Pour un choix réversible
   sans effet métier, proposer une hypothèse visible et poursuivre le cadrage.
4. Reformuler sans élargir le besoin. Donner des critères AC1, AC2… observables et testables,
   y compris les erreurs ou la compatibilité réellement pertinentes.
5. Identifier les fichiers utiles, les décisions ouvertes et le niveau de plan nécessaire.
   Pour un bug, proposer `/ai-debug` si la cause reste incertaine.

Rendre un Markdown compact : contexte, évolution, critères, exclusions, questions/décisions.
Marquer « prêt pour planification » ou « bloqué par décision ». Ne pas transformer une
hypothèse en validation humaine. Ne pas publier dans Azure DevOps ou modifier le dépôt.
Éviter l'interview exhaustive : arrêter dès que le comportement et les critères sont clairs.
