---
name: devops-test-guide
description: Préparer un guide concret de test manuel hors production pour le diff DevOps relu.
---

Adapte le plan de test au diff réellement produit et aux remarques de relecture. Le guide doit permettre à Matt de préparer et d’exécuter le test sans deviner des paramètres. Les identifiants manquants sont marqués « à renseigner », jamais inventés.

Décris :
- Préconditions et cible précise : organisation, projet, dépôt, branche, pipeline dédié et ressources de test.
- Isolation à vérifier AVANT publication/lancement : triggers CI/PR/cron/pipeline, identité et RBAC, service connections, variable groups (noms seulement), secrets, backend/état IaC, réseau et données. Un pipeline cloné peut conserver les accès de production.
- Étapes manuelles ordonnées, commandes exactes adaptées à l’OS du dépôt, effet de chaque commande, résultat attendu et condition d’arrêt. Inclure erreurs et contre-exemples, coûts possibles, retour arrière et nettoyage des seules ressources de test.
- Contrat de vérification : SHA complet de 40 caractères, refs/heads/branche, ID du pipeline, ID du build, identifiants/noms exacts des stages attendus, artefacts attendus et nécessité ou non de résultats Test Management. Les checks doivent échouer si un stage attendu est ignoré.
- Preuves à conserver et limites : résultats de tests, trace des cibles utilisées, comparaison aux critères ; présence d’un artefact distincte de son contenu.

Explique la suite dans Feature Studio : créer/lancer le test manuellement, placer le workspace au commit effectivement testé avec les modifications concernées enregistrées dans ce commit, ouvrir Validation du test, remplir le formulaire et lancer l’agent. L’extension ne lance aucune commande distante. Un résultat succeeded ne prouve ni l’isolation ni la réussite fonctionnelle des critères.

Si les droits/cibles ne permettent pas l’isolation, proposer une simulation locale ou un projet dédié et expliquer ce qui restera non validé. Ne livrer aucun faux guide « sans impact » fondé seulement sur un nom de branche.
