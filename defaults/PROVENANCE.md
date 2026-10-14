# Kit Copilot fourni par Matt

Le dossier `kit/` est une copie du kit utilisateur `/Users/matthieu/Downloads/kit-copilot`, version 2.0.0, reçue le 13 octobre 2026. Les fichiers `.DS_Store` sont exclus. Les 32 fichiers du manifeste ont été vérifiés contre leurs SHA-256. L'inventaire complet de la copie est `kit-sha256.json` ; les sources du kit sont conservées dans `kit/SOURCES.md`.

Le kit est une donnée livrée avec Feature Studio : ses instructions définissent les agents exécutés par l'application, pas les règles de développement de l'extension. L'original reste inchangé. L'installation suit son manifeste pour les destinations ; Feature Studio conserve tout fichier déjà présent et signale les différences, y compris pour les entrées marquées `managed` dans l'original.

`agents/fs-*.agent.md` fournit cinq profils dérivés : specs et plan divisent ai-cadrage ; dev, tests et review reprennent les limites de leurs homologues. Les procédures sont référencées par identifiant et restent dans `kit/.github/skills`, une seule source par procédure. Les workflows choisissent seulement les procédures nécessaires. Aucun identifiant de modèle n'est présupposé : les valeurs vides utilisent la découverte du CLI.

La seule extension du rôle tests est le droit `execute` associé à l'outil local `studio_run_test` du host : il doit recevoir une commande configurée et autorisée par l'utilisateur, dans le profil tests, sans shell générique. Ce droit explicite n'est jamais le défaut d'un agent importé. Le kit original est conservé sans modification. Ses exemples .NET restent des exemples optionnels et ne deviennent jamais la configuration de tests par défaut.

Les avatars sont des identifiants de présentation : detective (specs), wizard (plan), hacker (dev), scientist (tests), ninja (review). Un pseudo peut être ajouté dans le frontmatter sans changer l'identité stable de l'agent.

## Kit DevOps — v1.0.0

`devops/` contient les six profils, huit skills et le parcours adaptés à la méthode DevOps de Matt. Ces ressources sont distinctes du kit original `kit/`, dont les fichiers et empreintes sont conservés. Le script distribué `devops/skills/devops-inspect/scripts/ado-readonly.cjs` est généré par `scripts/build.mjs` depuis `src/host/devopsCli.ts` et partage le collecteur `src/host/DevOpsInspector.ts` avec les outils de l’extension. Il embarque les dépendances couvertes par `THIRD_PARTY_NOTICES.md`. La définition du parcours et les scripts sont installés avec les mêmes règles de conservation des personnalisations que les autres ressources.

Depuis la v0.5.1, `devops-azure-preflight` est une adaptation française ciblée de **azure-validate 1.2.3**, Microsoft, sous licence MIT, révision `5aa6e04819634ca4945ef57d6aa059eb4f5944e7` du dépôt [microsoft/azure-skills](https://github.com/microsoft/azure-skills/tree/5aa6e04819634ca4945ef57d6aa059eb4f5944e7/skills/azure-validate). Les sources consultées sont l’entrée de la skill, les recettes Bicep, Terraform et azd, et la vérification statique des rôles. `sources.json` conserve leurs empreintes ; `LICENSE` reproduit la licence amont. Les procédures sont synthétisées dans la skill pour être disponibles dans le contexte sans dépendance externe. Les runners et l’enchaînement prepare/validate/deploy amont ne sont pas repris : les commandes sont proposées pour le test manuel, les contrôles ne s’appliquent qu’au code Azure concerné et les statuts amont ne sont pas modifiés.


## Bibliothèque et avatars de v1

L’écran Kits expose séparément Atelier Copilot (quatre parcours, les neuf profils Feature Studio et les quatre agents originaux, sept skills) et DevOps. Le format portable inclut les ressources passives et les dépendances choisies, sans consignes utilisateur globales, connexion MCP ni automatisation active. Le kit original et son manifeste restent inchangés.

Les six avatars DevOps ont été générés individuellement avec imagegen, puis exportés mécaniquement par `scripts/pack-avatars.mjs --devops`. Les images source et directions artistiques sont dans `design/avatars`. Les identifiants sont `devops-scout`, `devops-architect`, `devops-builder`, `devops-sentinel`, `devops-lab` et `devops-controller`.
