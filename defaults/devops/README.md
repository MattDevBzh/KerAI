# Kit DevOps

Six agents, huit skills et un parcours « DevOps — du besoin au test vérifié » sont fournis avec Feature Studio. Ils sont disponibles directement dans Agents, Skills et Parcours. Dans Kits, choisis DevOps puis Voir le kit pour les installer dans ton catalogue personnel. Les personnalisations différentes restent préservées et les conflits sont affichés avant installation.

Challenge → Plan technique → Modifications locales → Relecture → Guide de test → Validation du test.

Le plan prévoit les critères et l’isolation ; le guide les détaille après relecture du diff. La mise en place et l’exécution du test sont manuelles. Le pilote s’arrête avant la validation finale, même sans checkpoint configuré. Cette étape demande des références saisies par l’humain et une preuve collectée par le host.

La skill partagée `devops-azure-preflight` adapte `azure-validate` 1.2.3 de Microsoft (licence MIT) aux étapes de plan, relecture, guide et validation. Elle apporte les recettes Bicep/Terraform/azd, la correspondance opérations-identités-rôles-scopes et la distinction entre contrôle prévu et preuve réelle. Elle s’applique aux changements Azure concernés ; le test reste exécuté manuellement. Ses sources figées et sa licence sont dans son dossier, et ses instructions sont injectées directement dans le contexte des agents.

Les seuls accès Azure DevOps sont des GET sur le dépôt configuré : définitions, builds, timeline, noms d’artefacts, résumés de campagnes de tests. Aucun pipeline n’est créé, lancé, relancé ou modifié par ces outils. Les contrôles automatiques ne prouvent pas seuls l’absence d’impact sur la production.

Le script autonome est installé dans skills/devops-inspect/scripts/ado-readonly.cjs. Son source canonique est src/host/devopsCli.ts et le collecteur src/host/DevOpsInspector.ts dans le dépôt de l’extension ; le build produit la copie distribuée. Node 22 est requis, aucun package à installer pour le script généré.

La connexion de l’extension utilise SecretStorage. Le script utilise AZURE_DEVOPS_EXT_PAT dans l’environnement. Ne placer de PAT ni dans le dépôt ni dans un argument de commande ou une conversation.

Les consignes et limites complètes sont dans les skills de chaque étape et dans docs/DEVOPS-KIT.md du dépôt de Feature Studio.
