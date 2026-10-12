---
name: ai-plan
description: "Préparer un plan de développement proportionné à partir d’un ticket clarifié et du dépôt. Invocation explicite ; aucune implémentation."
argument-hint: "[ticket clarifié et contraintes]"
user-invocable: true
disable-model-invocation: true
---

# Planifier une modification

Agent recommandé : `ai-cadrage`. Lecture seule ; aucune commande, édition ou délégation.
Lire la [carte du dépôt](../../../.ai/project.md), les critères et les fichiers concernés.
Utiliser le [format de plan](../../../templates/plan.md) uniquement si un plan séparé est utile.

1. Vérifier les inconnues qui changent la solution. Si elles bloquent, poser la question précise.
   Un ticket clair suffit : ne pas imposer un document de cadrage supplémentaire.
2. Adapter la profondeur : correction locale évidente = checklist de trois à cinq lignes ;
   feature à plusieurs comportements = trois à sept étapes ; contrat, migration ou concurrence
   = expliciter d'abord les invariants, la compatibilité et l'ordre de livraison.
3. Inspecter un exemple existant avant de proposer une structure. Nommer les fichiers réellement
   observés ; étiqueter les nouveaux chemins comme propositions.
4. Pour chaque tranche, donner le comportement livré, les AC couverts, les fichiers,
   les dépendances entre étapes, le test qui la prouve et le profil de validation envisagé.
5. Fixer les contrats que l'implémenteur ne peut pas décider seul : entrées, sorties, erreurs,
   ordre des opérations, invariants. Garder le détail mécanique pour le développement.
6. Confronter les étapes aux critères et aux principaux risques ; corriger les oublis une fois.

Éviter le code complet dans le plan, les estimations de crédits inventées et le découpage par
micro-édition. Réutiliser les décisions déjà acceptées. Terminer par la première tranche
exécutable et les blocages éventuels. Fournir le résultat dans le chat ; ne pas prétendre
avoir créé un fichier. Transmettre avec le [contexte court](../../../templates/context.md).
