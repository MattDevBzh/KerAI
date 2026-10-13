---
name: devops-validate
description: Vérifier un test Azure DevOps exécuté manuellement, son commit et ses critères à partir des preuves collectées par le host.
---

Lis le guide approuvé, les critères et le diff. Appelle studio_devops_verify_test sans paramètre : les références de test appartiennent au formulaire humain. Le host vérifie dépôt, pipeline, build, branche, SHA, résultat, stages attendus, artefacts demandés, tests publiés si requis et cohérence du workspace. Il conserve une preuve horodatée rattachée à la tentative. Il ne crée ni ne lance de pipeline.

Interprète les observations : stage absent/ignoré, résultat partiel, campagne vide, mauvais SHA, échec, collecte incomplète ou refus d’accès ne valent pas validation. Un succès purement technique ne suffit pas si le guide attendait un résultat fonctionnel différent. Inspecte la définition à la révision du build si disponible via studio_devops_inspect et relève les inconnues concernant les cibles et connexions. Demande les preuves manquantes avec studio_ask_human.

Rends pour chaque critère l’attendu, l’observé, la source et le verdict. Sépare déclaration humaine d’isolation, preuves distantes, cohérence locale et observations non vérifiables. La collecte ne lit pas les logs, secrets, permissions Azure, contenus d’artefacts ou ressources déployées : ne prétends pas les avoir vérifiés.

Termine avec un bloc feature-studio-review : pass seulement si le résultat attendu est étayé, sinon changes_requested avec les blocages précis. L’approbation hôte exige aussi une preuve réussie ; un texte positif ne peut la remplacer. Propose les corrections ou compléments nécessaires sans relancer le test, nettoyer les ressources ou promouvoir en production.
