# Origine des méthodes et compatibilité

Vérification documentaire : 12 octobre 2026. Version du kit : 2.0.0.
Les sept skills sont des procédures originales rédigées pour ce kit, inspirées des
méthodes ci-dessous. Ce ne sont pas les packs officiels installés tels quels.
Aucun téléchargement de skill, exécution distante ou mise à jour automatique à l'installation.

| Procédure du kit | Référence consultée | Adaptation principale |
| --- | --- | --- |
| ai-ticket | [Matt Pocock / grilling](https://github.com/mattpocock/skills/tree/main/skills/productivity/grilling) | Questions bloquantes limitées ; aucune exploration déléguée. |
| ai-plan | [Superpowers / writing-plans](https://github.com/obra/superpowers/tree/main/skills/writing-plans) | Plan proportionné ; aucune orchestration ou création de worktree. |
| ai-implement | [Matt Pocock / implement](https://github.com/mattpocock/skills/tree/main/skills/engineering/implement) | Pas de commit, exécution locale séparée, boucle bornée. |
| ai-tdd | [Matt Pocock / tdd](https://github.com/mattpocock/skills/tree/main/skills/engineering/tdd) | Tests de comportement ; pas de rouge/vert annoncé sans preuve ; framework existant. |
| ai-debug | [Superpowers / systematic-debugging](https://github.com/obra/superpowers/tree/main/skills/systematic-debugging) | Diagnostic ciblé à partir de fichiers/logs ; pas de commande automatique. |
| ai-verifier | [Superpowers / verification-before-completion](https://github.com/obra/superpowers/tree/main/skills/verification-before-completion) | Lecture de preuves récentes ; aucune relance implicite, revue séparée. |
| ai-relecture | Ton skill et ton template existants | Passerelle de configuration, sans présumer leur contenu. |

Documentation officielle de la structure utilisée :
- [Skills VS Code](https://code.visualstudio.com/docs/agent-customization/agent-skills)
- [Agents VS Code](https://code.visualstudio.com/docs/agent-customization/custom-agents)

Les skills utilisent name/description, argument-hint, user-invocable et
disable-model-invocation. Les dossiers portent leur nom exact. Les agents limitent leurs
outils ; leurs identifiants et leur disponibilité doivent être vérifiés dans ton moteur de
session. Une restriction textuelle n'est pas une permission système.
La disponibilité d'un skill ne garantit pas son activation ; utiliser les commandes slash.
Les recommandations de modèles sont des choix de travail à mesurer sur tes tickets,
pas une comparaison de performances démontrée par ce kit.
