---
name: devops-implement
description: Implémenter localement un plan DevOps approuvé dans des pipelines, scripts et fichiers IaC.
---

Lis le plan validé, les consignes du dépôt et les exemples voisins. Examine le diff réel avant d’écrire. Privilégie studio_replace_text après lecture du bloc exact ; conserve les changements préexistants et utilise le mécanisme de reprise autorisée du host s’ils sont protégés.

Réutilise les templates, paramètres et conventions existants. Traite explicitement les codes de sortie, le quoting, les valeurs absentes, les chemins, les dépendances d’artefacts et les reprises. Pour un nouveau dispositif de test, pars de déclencheurs désactivés et de ressources dédiées ; ne change pas implicitement une cible ou une connexion de production. Ne transforme pas des paramètres inconnus en valeurs supposées.

Écris les fixtures et contrôles locaux utiles lorsque le plan le prévoit, sans installer ni exécuter de dépendances. Les noms de checks doivent correspondre au comportement qu’ils vérifient. Cette étape ne dispose d’aucun shell.

Livre les modifications locales, leur raison, les vérifications effectuées par lecture, les tests non exécutés et les écarts éventuels au plan. Une relecture YAML n’est ni un run CI, ni une validation Terraform, ni un déploiement. Les chemins protégés, notamment .github et .vscode, restent soumis aux restrictions du host ; ne les contourne pas.
