---
name: devops-azure-preflight
description: Préparer et relire les contrôles Bicep, Terraform, azd et RBAC d’un test Azure manuel, puis confronter les preuves aux critères du plan DevOps.
license: MIT
metadata:
  upstream-skill: azure-validate
  upstream-author: Microsoft
  upstream-version: "1.2.3"
  upstream-commit: 5aa6e04819634ca4945ef57d6aa059eb4f5944e7
  adaptation: Feature Studio
---

Adaptation ciblée de [azure-validate de Microsoft](https://github.com/microsoft/azure-skills/blob/5aa6e04819634ca4945ef57d6aa059eb4f5944e7/skills/azure-validate/SKILL.md), avec ses recettes Bicep/Terraform/azd et sa vérification statique des rôles. La licence MIT et le manifeste des sources accompagnent cette skill. Les procédures utiles sont incluses ci-dessous : aucun plugin Azure, script amont ou accès à un dossier personnel n’est requis.

## Périmètre

Applique ces contrôles lorsque les fichiers concernés définissent une infrastructure Azure, des rôles ou une préparation de déploiement. Azure DevOps seul n’implique pas une infrastructure Azure : pour un pipeline de compilation sans IaC, note « non applicable » et garde les critères du pipeline. Inspecte les fichiers et scripts réellement appelés avant de choisir une recette.

Cette adaptation prépare des commandes pour le test manuel et analyse des preuves. Elle ne lance aucune commande, n’installe aucun outil et n’invoque ni azure-prepare ni azure-deploy. Le plan approuvé du parcours est l’entrée ; ne crée pas artificiellement `.azure/deployment-plan.md` et ne marque pas un plan amont `Validated`. Les profils gardent leurs outils autorisés.

## Choisir les contrôles

Pour chaque contrôle retenu, précise le fichier, les versions d’outils, la commande adaptée au dépôt et à l’OS, la cible, les effets possibles, le résultat attendu et la preuve à conserver. Les chemins et identifiants ci-dessous sont des paramètres à résoudre, jamais des valeurs déjà confirmées.

| Code rencontré | Contrôles à préparer | Interprétation |
| --- | --- | --- |
| Bicep / ARM | Compilation `az bicep build --file <fichier>`, puis `az deployment <scope> validate` et `what-if` avec les paramètres exacts. Déduire le scope du template ; préciser l’abonnement, le groupe ou la localisation selon ce scope. | Compilation locale distincte de validation distante. Relire les créations, modifications, suppressions et valeurs inconnues du what-if. Le code de sortie seul ne couvre pas les effets attendus. |
| Terraform | `terraform fmt -check -recursive`, initialisation adaptée, `terraform validate`, puis `terraform plan -detailed-exitcode` sur la cible de test. Une initialisation `-backend=false` peut préparer la validation syntaxique ; elle ne valide pas le backend réel. | Le plan renvoie 0 sans changement, 2 avec changements et 1 en erreur. Inspecter remplacements, suppressions, valeurs inconnues et dérive. Un plan qui échoue ne prouve rien sur le résultat attendu. |
| `azure.yaml` / azd | Lire le fournisseur IaC, les services, hooks et paramètres ; contrôler l’environnement choisi, le build et le contexte Docker. Préparer `azd provision --preview` et, si pertinent, `azd package` selon la version installée. | Un aperçu ou un packaging peut exécuter des hooks ou scripts. Lire ces appelants avant de proposer la commande ; une option preview ne garantit pas l’absence d’effets. |

Pour Terraform, distinguer le backend, la clé d’état et le workspace de test de ceux de production ; vérifier identités, providers, modules et sources de données exécutables. L’initialisation peut télécharger du code ; un plan peut contacter Azure et verrouiller l’état. Ne proposer ni migration d’état ni désactivation du verrou pour contourner un problème. Pour azd + Terraform, vérifier la résolution des variables dans les fichiers réellement utilisés, notamment les expressions `{{ .Env.* }}` non substituées dans les tfvars JSON.

Avant toute commande distante du guide, expliciter l’identité, le tenant, l’abonnement et les ressources de test. Éviter la dépendance à un abonnement CLI implicite. Si une cible ou un paramètre nécessaire manque, le contrôle reste « à préparer ». Les règles Azure Policy et la disponibilité régionale pertinentes sont des critères à vérifier sur la cible, pas des faits déduits d’une compilation.

## Vérifier les droits depuis le code

Construis la correspondance **opération de l’application → identité → rôle → scope** pour les accès concernés. Lis les déclarations `Microsoft.Authorization/roleAssignments` ou `azurerm_role_assignment` et leurs usages. Distingue gestion des ressources et accès aux données : un rôle de gestion ne suffit pas à établir un accès Blob, Key Vault ou Service Bus. Choisis le scope minimal compatible avec l’opération ; ne réclame pas un rôle à une identité qui n’en a pas besoin.

Sépare les rôles de l’identité de déploiement, ceux de l’application et ceux de la personne qui teste. La relecture statique vérifie les déclarations ; l’attribution effective et sa propagation exigent une preuve du test. N’invente aucun rôle, identifiant de rôle ou droit effectif. Une définition absente reste à vérifier.

## Rendre le résultat utile à chaque étape

- **Plan** : choisir les contrôles applicables et les résultats attendus avant les modifications ; relever les inconnues qui empêchent un test isolé.
- **Relecture** : vérifier que le diff et ses appelants respectent ces critères, particulièrement les suppressions/remplacements, identités, états partagés et hooks.
- **Guide** : produire le tableau **contrôle | commande | cible/effets | attendu | preuve à conserver**, avec conditions d’arrêt et nettoyage du test. Ne pas recopier un runner amont sans examiner toutes ses commandes.
- **Validation** : comparer chaque contrôle à une preuve datée du commit testé. Distinguer réussi, échoué, non exécuté et non applicable. Un contrôle applicable non exécuté reste une limite bloquante pour ce critère ; une commande simplement proposée n’est pas une preuve.

La preuve hôte Azure DevOps confirme uniquement ce que son collecteur expose. Il ne lit ni les logs ni le contenu des artefacts : un stage vert ne prouve pas le contenu d’un what-if ou les droits réels. Demander les éléments complémentaires expurgés via le contexte humain si nécessaires ; identifier leur origine et ne pas les présenter comme des observations du host. Conserver les secrets, sorties complètes d’environnement et plans Terraform binaires hors des prompts et livrables.
