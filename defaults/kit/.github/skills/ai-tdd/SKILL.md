---
name: ai-tdd
description: "Concevoir et écrire des tests de comportement, notamment une régression test-first. Invocation explicite ; exécution confiée au runner local."
argument-hint: "[critères, comportement ou bug à tester]"
user-invocable: true
disable-model-invocation: true
---

# Concevoir les tests

Agents recommandés : `ai-tests` pour les tests et fixtures ; `ai-dev` pour une boucle test/code.
Respecter les outils de l'agent actif. Aucun lancement de commande par ce skill.
Lire la [carte du dépôt](../../../.ai/project.md), les critères et deux tests voisins.
Prendre les résultats attendus dans le besoin avant d'inspecter l'algorithme du correctif.

1. Construire une matrice courte avec le [format tests](../../../templates/tests.md) : critère,
   scénario, résultat attendu, niveau TU/intégration, assertion et point d'entrée public.
2. Choisir les cas qui distinguent un comportement correct d'une régression : nominal,
   limites et erreurs pertinentes. Ne pas maximiser le nombre de tests ou le taux de couverture.
3. Suivre le framework existant. Utiliser des attendus indépendants du calcul de production.
   Éviter les assertions sur des méthodes privées et les mocks de détails internes.
4. Maîtriser horloge, aléatoire et I/O via les mécanismes du projet. Si seule une intégration
   réelle peut démontrer le contrat, la signaler séparément sans la maquiller en TU.
5. Pour un bug, écrire d'abord le test de régression. Faire exécuter le test ciblé par la tâche
   locale et vérifier que l'échec traduit le bug, pas une erreur de compilation ou de fixture.
   Après correction par Dev, demander la nouvelle preuve sur le même test.
6. Si le correctif existe déjà, ne pas annuler les fichiers de l'utilisateur pour fabriquer
   une preuve rouge. Indiquer « régression proposée ; échec avant correction non démontré ».

Fournir matrice, fichiers et profil/filtre proposé. Aucun passage au vert sans preuve.
Sous `ai-tests`, proposer à Dev les changements de production nécessaires à la testabilité.
