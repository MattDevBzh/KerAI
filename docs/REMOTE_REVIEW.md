# Relecture distante personnelle

Disponible à partir de Feature Studio 1.15.0 pour les agents exécutés dans une session. Le mode Discussion reste une conversation sans outils.

Dans le fichier personnel de l'agent, conserver `read`, `search`, `edit` et ajouter :

```yaml
tools:
  - read
  - search
  - edit
  - studio_read_personal_resource
  - studio_remote_review
  - studio_write_review_report
skills:
  - code-review-mattpocock
```

Conserver l'agent, la skill et le template dans le catalogue utilisateur. L'extension n'installe ni ne remplace ces personnalisations. Charger la méthode de relecture déjà fournie dans le contexte ; lire ses références avec `studio_read_personal_resource` si nécessaire. Les chemins sont relatifs au dossier personnel Copilot effectif (`AgentRegistry.userPath`), par exemple `agents/template/pre-commit-review-template.md`. Les chemins absolus contenus dans ce même dossier sont aussi acceptés.

## Accès Git

Utiliser `studio_remote_review` avec :

```json
{
  "operation": "prepare",
  "repo": "https://dev.azure.com/ORGANISATION/PROJET/_git/DEPOT",
  "source": "feature/ma-branche",
  "base": "develop"
}
```

Le dépôt et les deux branches doivent être explicites. Une URL de PR Azure DevOps peut remplacer l'URL Git si les branches sont connues. Les préfixes `origin/` sont acceptés. Les sources sont les commits poussés, jamais les modifications locales. L'authentification reste celle de Git, via son gestionnaire d'identifiants ou SSH ; aucun token dans le prompt ou l'URL.

Conserver `id`, `sourceSha`, `baseSha`, `mergeBaseSha` et `reportPath`. Utiliser ensuite `operation` parmi `files`, `list`, `diff`, `read`, `search`, `info` et `verify`, avec `session` égal à l'identifiant retourné. Les chemins utilisent `/`. Suivre `nextOffset` pour les inventaires et `nextStart` pour les lectures. `read` fournit les vraies lignes du fichier ; les numéros de sortie de `diff`/`search` ne sont pas des lignes source. La recherche littérale cible un seul fichier, découvert avec `list`.

Le cache est sous `<catalogue utilisateur>/remote-review/feature-studio/cache`. Les rapports sont dans `reports/<session>/RELECTURE_DISTANTE.md`. Git télécharge des objets sur le poste mais ne crée aucun arbre de travail. Le moteur est livré avec l'extension ; il n'exécute pas le helper d'une skill personnelle et ne nécessite pas de Node installé séparément.

## Rapport et limites

Réutiliser la skill et le template du relecteur local. Ajouter le périmètre Git, les SHA, la couverture et le résultat de `verify`. Enregistrer avec `studio_write_review_report` (`session`, `content`), puis utiliser son `reportUri` pour un lien ouvrable dans Feature Studio. Inclure aussi le rapport dans la réponse finale pour conserver le livrable de l'étape.

L'écriture est limitée au rapport créé dans la tentative courante. Une modification extérieure empêche son remplacement. Aucun accès aux secrets, lien symbolique, commande arbitraire, checkout, push, compilation ou test du projet. Les sorties sont paginées ; fichiers > 32 Mio, contenus binaires et encodages non pris en charge sont à signaler comme non couverts. Les branches avancées depuis la collecte ne modifient pas le snapshot relu. Les erreurs d'authentification et limites de couverture doivent rester visibles.
