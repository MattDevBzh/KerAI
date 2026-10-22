# Compétences natives et instructions du projet

Depuis la version 1.27.0, les étapes Copilot natives utilisent le catalogue de compétences de KerAI comme fournisseur de skills du runtime. Les profils et fichiers personnels ne sont pas modifiés.

## Choisir ce qui est disponible

Les compétences choisies dans l’agent ou dans l’étape restent visibles dans l’aperçu du contexte. Leur texte complet reste consultable et modifiable dans cet aperçu. Une compétence décochée, ou exclue par le contexte vide, n’est pas proposée au runtime. Le contrôle de fraîcheur du contexte inclut les sources du catalogue.

Pour une compétence ordinaire, seul son nom et sa description sont proposés initialement. Copilot charge le contenu approuvé à travers son outil natif `skill` lorsqu’il en a besoin. Les références aux ressources du dossier d’origine restent accessibles à travers les outils de fichiers autorisés, avec les permissions habituelles ; ces ressources ne sont pas automatiquement chargées par le fournisseur de skills.

Les compétences portant `disable-model-invocation: true`, notamment celles du kit personnel, conservent cette politique. Lorsqu’elles sont explicitement sélectionnées dans le contexte KerAI, elles sont préchargées nativement pour l’agent. Elles ne deviennent pas librement invocables par le modèle. Leurs fichiers d’origine sont inchangés.

Les anciennes sessions utilisant les outils hôtes conservent leur transmission de compétences dans le texte du contexte. Les discussions libres et l’observateur ne gagnent aucun accès au projet.

## Instructions ciblées

Copilot découvre les instructions du projet, notamment `.github/instructions/*.instructions.md` et les fichiers `AGENTS.md`. Exemple :

```markdown
---
applyTo: "src/host/**/*.ts"
---
Conserver les décisions de permission côté hôte.
Ne jamais journaliser de secrets.
```

La résolution des chemins et des motifs reste celle du runtime Copilot. Selon le type de fichier et la version du runtime, les instructions sont proposées dans le contexte puis consultées avec `view`, ou découvertes et injectées lors de l’accès à un fichier. KerAI distingue ces mécanismes et ne présente pas une instruction simplement détectée comme déjà chargée.

Les instructions découvertes sont des consignes de travail, pas une validation humaine ni une autorisation de lancer des commandes. La découverte des plugins, les hooks de fichiers et la délégation native restent désactivés.

## Voir ce qui a réellement été chargé

Dans la conversation et les preuves de la tentative, ouvre **Compétences et instructions chargées**. Le panneau affiche le nom, la provenance, le chemin, l’heure et le contenu transmis. Une notification de découverte peut aussi fournir le fichier qui l’a déclenchée.

- **Compétence chargée** : événement natif `skill.invoked`, y compris les préchargements explicites.
- **Instruction chargée** : notification native `instruction_discovered` avec son contenu.
- **Instruction consultée** : lecture réussie d’une source d’instructions connue, avec l’extrait effectivement retourné au modèle. Un extrait n’est pas présenté comme la lecture complète du fichier.

Le catalogue, les déclarations de l’assistant et les lectures refusées ne constituent pas une preuve de chargement. Les chargements sont conservés dans la tentative, après réouverture, avec les anciens contenus même si le catalogue change. Les doublons d’événements sont ignorés. Le contenu affiché est masqué pour les secrets connus, limité à 64 000 caractères par événement et accompagné d’une empreinte ; les événements complets expurgés restent dans l’archive. Une tentative conserve au maximum 1 000 chargements, puis demande une nouvelle tentative sans supprimer son historique.

Les anciens historiques n’ont pas de preuves rétroactives. L’absence d’un événement signifie « aucun chargement confirmé », pas « aucune consigne dans le contexte système ».

## Permissions et vérification

Les métadonnées de skills qui accorderaient des outils ou des hooks ne sont pas transmises au runtime. Charger une compétence ne donne aucun accord d’exécution. Les modes de permission, les outils de lecture seule, le cadrage, la validation du code avant les étapes de tests et la validation finale restent pilotés par KerAI et l’utilisateur.

La recette automatisée utilise un vrai CLI et un fournisseur de réponses local déterministe : aucun appel modèle payant. Elle contrôle les contenus réellement transmis, le préchargement explicite, les compétences à la demande, les instructions ciblées, le refus d’une commande et la persistance. Le smoke d’inférence réel est séparé : `FEATURE_STUDIO_LIVE_TEST=1 npm run smoke:context`.

La version 1.27.0 retire aussi l’ancienne option de lancement `--no-remote`, supprimée par le CLI 1.0.103. Les options SDK `enableRemoteSessions: false` et `remoteSession: 'off'` conservent les sessions locales.
