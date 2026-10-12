# Kit Copilot fourni par Matt

Le dossier `kit/` est une copie du kit utilisateur `/Users/matthieu/Downloads/kit-copilot`, version 2.0.0, reçue le 13 octobre 2026. Les fichiers `.DS_Store` sont exclus. Les 32 fichiers du manifeste ont été vérifiés contre leurs SHA-256. L'inventaire complet de la copie est `kit-sha256.json` ; les sources du kit sont conservées dans `kit/SOURCES.md`.

Le kit est une donnée livrée avec Feature Studio : ses instructions définissent les agents exécutés par l'application, pas les règles de développement de l'extension. L'original reste inchangé. L'installation suit son manifeste pour les destinations ; Feature Studio conserve tout fichier déjà présent et signale les différences, y compris pour les entrées marquées `managed` dans l'original.

`agents/fs-*.agent.md` fournit cinq profils dérivés : specs et plan divisent ai-cadrage ; dev, tests et review reprennent les limites de leurs homologues. Les procédures sont référencées par identifiant et restent dans `kit/.github/skills`, une seule source par procédure. Les workflows choisissent seulement les procédures nécessaires. Aucun identifiant de modèle n'est présupposé : les valeurs vides utilisent la découverte du CLI.

La seule extension du rôle tests est le droit `execute` associé à l'outil local `studio_run_test` du host : il doit recevoir une commande configurée et autorisée par l'utilisateur, dans le profil tests, sans shell générique. Ce droit explicite n'est jamais le défaut d'un agent importé. Le kit original est conservé sans modification. Ses exemples .NET restent des exemples optionnels et ne deviennent jamais la configuration de tests par défaut.

Les avatars sont des identifiants de présentation : detective (specs), wizard (plan), hacker (dev), scientist (tests), ninja (review). Un pseudo peut être ajouté dans le frontmatter sans changer l'identité stable de l'agent.
