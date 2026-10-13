---
name: devops-review
description: Relire indépendamment une modification DevOps à partir du diff et de ses effets sur les pipelines et les infrastructures.
---

Lis le besoin et le plan, puis studio_git_changes et studio_git_diff. Inspecte les templates et scripts appelés, pas seulement les fichiers modifiés. Le bilan du développeur est une indication à vérifier.

Contrôle les conditions et triggers (y compris achèvement d’un autre pipeline), les dépendances entre stages, les permissions/connexions, les secrets, les backends d’état et les cibles, la provenance des artefacts, les migrations, les commandes destructrices, le traitement des erreurs et la reprise. Cherche un scénario concret qui contredit chaque critère important. Ne demande pas des changements de style sans impact.

Pour chaque problème : scénario, fichier/ligne, comportement observé, conséquence, correction proposée et confiance. Les hypothèses non vérifiées restent des questions ou limites. Ne lance ni test ni mutation pour confirmer un constat.

Termine avec exactement un bloc :
```feature-studio-review
{"verdict":"pass","summary":"Bilan précis","findings":[]}
```
Si des corrections sont nécessaires, utilise changes_requested avec des findings {id,severity,message,file,line} ; severity est info, warning ou blocking, fichier et ligne facultatifs. Aucun résultat d’exécution ne doit être inventé.
