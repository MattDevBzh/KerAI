# Kit Copilot 2.0.0 — installation et démarrage

Quatre agents, sept skills courts, six templates et des scripts locaux sans appel IA.
Pour VS Code / Insiders avec GitHub Copilot. Installation par dépôt, sur ton poste.
Les méthodes sont générales ; le runner fourni conserve l'hypothèse C#/.NET avec VSTest.
Python 3.10+ requis pour l'installateur et le runner ; aucune bibliothèque à installer.

## 1. Installer sans écraser tes personnalisations

Extraire ce ZIP dans un dossier temporaire **hors du dépôt**, puis ouvrir un terminal
dans le dossier `kit-copilot` extrait. Le dossier du dépôt cible doit déjà exister.

Windows :

```powershell
py -3 install.py --repo "C:\chemin\mon-depot"
py -3 install.py --repo "C:\chemin\mon-depot" --apply
```

Linux / macOS :

```bash
python3 install.py --repo "/chemin/mon-depot"
python3 install.py --repo "/chemin/mon-depot" --apply
```

La première commande affiche seulement un aperçu. `--apply` applique le plan :
- Nouveau fichier : copie.
- Fichier identique : conservé.
- Version v1 inchangée et reconnue par son empreinte : sauvegarde puis mise à jour.
- `.ai/project.md` déjà présent : toujours conservé, car il contient ta configuration.
- Tout autre fichier personnalisé : conservé ; proposition v2 dans `.ai/kit-conflicts/ID/`.
  Comparer et fusionner les propositions indiquées, puis les valider avant utilisation.

Les sauvegardes et le journal se trouvent dans `.ai/kit-backups/ID/` et
`.ai/kit-install/ID.json`. Un conflit retourne le code 3 et n'est jamais écrasé de force.
L'installateur ne lance ni Git, ni dotnet, ni réseau ; il ne change pas les paramètres VS Code,
les MCP, les tâches existantes ou ton skill de relecture personnel.
Les documents du kit sont copiés dans `.ai/kit/`, pas sur le README du projet.

Installation manuelle possible : copier `.github/agents`, `.github/skills`, `scripts`,
`templates` et les exemples `.ai`, en comparant chaque conflit ; fusionner
`.github/copilot-instructions.md` et conserver la carte du dépôt déjà remplie.

## 2. Configurer une fois

1. Compléter `.ai/project.md` : stack, chemins, règles métier, tests voisins et runner réel.
   Renseigner les chemins de **ton skill Matt Pocock et ton template existants**.
2. Pour VSTest, copier `.ai/test-profiles.example.json` vers `.ai/test-profiles.json`, renseigner
   de vrais projets/filtrages et le minimum de tests attendu. Pour MTP ou un autre runner,
   conserver la commande de l'équipe ; le wrapper VSTest n'est pas compatible tel quel.
3. Ouvrir le dépôt dans VS Code/Insiders, puis Agent Customizations. Vérifier les quatre
   agents et les sept skills. Les agents sont dans `.github/agents` et les skills dans
   `.github/skills/<nom>/SKILL.md`. Ils fonctionnent sans MCP et sans fichier prompt.
4. Configurer les modèles depuis le sélecteur ou l'éditeur de chaque agent : Cadrage/Revue
   plutôt Sol, Dev/Tests plutôt Luna selon le risque. Aucun `model` n'est imposé, pour éviter
   un identifiant incompatible avec ton moteur. Vérifier le modèle effectif à chaque phase.
5. Vérifier les outils effectifs : Cadrage/Revue = lecture/recherche ; Dev/Tests = lecture,
   recherche/édition. Aucun terminal, MCP ou sous-agent. Un skill seul ne restreint pas les
   permissions : le lancer avec l'agent conseillé. Ne pas élargir Revue pour sauvegarder son rapport.
6. Optionnel : fusionner les exemples de `.ai/kit/options/` dans `.vscode/tasks.json` ou tes
   réglages. Ne pas copier un JSON par-dessus ta configuration. MCP ADO non activé par défaut.
7. Ajouter les lignes de `.ai/kit/options/gitignore.append.txt` à `.git/info/exclude` pour un
   usage personnel ou au `.gitignore` selon les conventions de l'équipe.

Les répertoires d'exécution, de snapshots, de sauvegardes et de conflits peuvent contenir du
code interne : les conserver localement et vérifier les fichiers avant de les joindre au chat.
Les règles du kit ne remplacent pas les politiques de ton organisation.

## 3. Utiliser

| Agent | Skill à invoquer | Résultat |
| --- | --- | --- |
| ai-cadrage | `/ai-ticket` | Ticket clarifié et critères |
| ai-cadrage | `/ai-plan` | Plan proportionné |
| ai-dev | `/ai-implement` | Tranche implémentée |
| ai-tests ou ai-dev | `/ai-tdd` | Tests de comportement |
| ai-cadrage ou ai-dev | `/ai-debug` | Diagnostic étayé |
| ai-tests | `/ai-verifier` | Verdict sur les preuves locales |
| ai-revue | `/ai-relecture` | Rapport statique avec ton format |

Sélectionner d'abord l'agent, puis envoyer la commande avec le ticket ou les fichiers utiles.
Les skills sont manuels (`disable-model-invocation: true`) ; sans slash, l'agent sait répondre
à son rôle mais ne lance pas automatiquement toutes les procédures. Les skills ne changent
pas le modèle et n'installent aucun outil. Procédures et exemples dans `GUIDE-QUOTIDIEN.md`.

Depuis la racine du dépôt configuré :

```powershell
py -3 scripts/ai_tools.py test --profile unit-cible --dry-run
py -3 scripts/ai_tools.py test --profile unit-cible
py -3 scripts/ai_tools.py snapshot --path src/MonModule --path tests/MonModule
```

Le runner lance un build et des TU uniquement sur ta commande explicite. Le relecteur n'exécute
rien. Joindre le `summary.md` imprimé par le run, pas un ancien fichier. Toute édition pertinente
après le run invalide la preuve pour l'état courant. Le même HEAD ne prouve pas le même worktree.

## Vérification et limites

Voir `VALIDATION.md` pour les contrôles réels, `CHANGELOG.md` pour la mise à jour et `SOURCES.md`
pour les méthodes consultées. Ni ton dépôt applicatif ni ton poste n'ont été testés ici.
L'installateur prépare les fichiers ; il n'installe pas Python, Git, le SDK ou Copilot.
