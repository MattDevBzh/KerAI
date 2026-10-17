# Espaces Git et points de restauration — v0.3

Chaque feature possède un dossier d’exécution. Une nouvelle feature ou session libre propose un worktree isolé ; une relecture propose le dossier courant pour examiner les changements qui s’y trouvent déjà. Le choix reste explicite dans **Nouvelle session → L’espace de cette session**.

## Créer et ouvrir un espace

**Worktree isolé** crée une branche `codex/feature-studio-<titre>-<id>` et un dossier frère du projet, nommé `<projet>-feature-studio-<empreinte>`. Le host détermine ce chemin ; le webview ne peut pas lui fournir une destination arbitraire.

La création générale part du commit **HEAD** du dossier source. Depuis **Tickets → Préparer le développement**, tu peux choisir une autre branche locale ou référence distante déjà présente et le nom de la nouvelle branche. Le host résout puis vérifie son commit exact ; une référence déplacée depuis la préparation est refusée. Aucun fetch implicite n’est effectué. Les changements source non commités, stagés ou non suivis ne sont ni copiés, ni stashed, ni réinitialisés. L’index source n’est pas modifié. Feature Studio ne crée pas un commit pour faire entrer ces changements dans le worktree. Si tu veux y retrouver une modification locale, elle doit être intégrée au commit de départ ou reportée par toi ensuite.

L’isolation exige Git, un commit HEAD et l’ouverture de la racine du dépôt. Un sous-dossier ne suffit pas. Si ces conditions ne sont pas satisfaites, le choix est désactivé et la raison apparaît dans le formulaire. Les commandes Git neutralisent les hooks de checkout, `fsmonitor` et les filtres externes, y compris lors des contrôles de statut : un `git status` peut autrement lancer un filtre `clean`. La récursion des sous-modules est désactivée. Les objets LFS et transformations `smudge` ne sont donc pas matérialisés automatiquement : le worktree contient le contenu Git commité, qui peut être un pointeur LFS. Aucun installateur de dépendances ou outil de préparation n’est lancé. Un projet peut donc demander une préparation explicite avant ses tests. Les commandes et hooks applicatifs que tu autorises conservent leurs propres effets.

Les sessions historiques sans métadonnée de worktree restent dans le **Dossier courant**. Cette version ne déplace pas une session existante vers un nouvel espace. Tu peux aussi choisir le dossier courant pour une nouvelle session ; ses fichiers sont alors partagés avec les autres sessions qui utilisent cette racine.

Le bandeau **ESPACE GIT** affiche le chemin et la branche associés. **Ouvrir le dossier** ouvre une nouvelle fenêtre VS Code. Le cockpit d’origine conserve l’historique et les commandes de la feature ; ouvrir le dossier ne transfère pas sa session de cockpit. Le stockage étant lié à la racine, un cockpit ouvert séparément dans le worktree n’hérite pas automatiquement de l’historique du cockpit source. Il réserve cette racine pendant toute sa vie et empêche alors le cockpit d’origine d’agir sur cette feature jusqu’à sa fermeture/libération du verrou. Les vues de fichiers normales de la nouvelle fenêtre restent utilisables sans ouvrir ce deuxième cockpit.

## Exécuter au bon endroit

Le host résout la racine de la feature avant d’exécuter ses outils, tests et hooks ou d’ouvrir ses fichiers et diffs. Le contexte métier reçoit ce même dossier d’exécution. Les messages d’ouverture de fichier/diff portent l’identifiant de la feature pour éviter d’ouvrir un fichier homonyme du dossier source.

Un worktree doit conserver le chemin attendu, rester enregistré dans le dépôt source, partager son répertoire Git commun et être sur la branche liée à la feature. Une substitution de chemin, un lien symbolique, une disparition du dépôt ou un changement de branche bloque l’opération. Les sessions dans le dossier courant sont également liées à leur branche ; un changement de branche doit être résolu avant de les poursuivre.

Deux cockpits de projets sources distincts peuvent travailler en parallèle. Un seul run tourne à la fois par cockpit d’origine. Chaque cockpit détient le verrou de sa propre racine. Le worktree cible est verrouillé pendant une tentative ou une opération qui l’utilise. Le service réserve l’opération avant son premier `await`, refuse une deuxième tentative ou mutation concurrente et demande de mettre le pilote en pause avant une opération manuelle sur les points. Les mutations en cours sont affichées dans le cockpit. Ce verrou coordonne Feature Studio ; il n’interdit pas à un autre éditeur, terminal ou processus de modifier les fichiers.

## Conserver des points

**Points de restauration** ouvre l’historique des captures de la feature. Chaque carte indique son nom, sa nature, sa date, la branche/HEAD observés, les fichiers inclus et les exclusions.

| Point                          | Création                                                                                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Avant la tentative**         | Automatiquement dans une session isolée, après l’enregistrement de la tentative et avant `beforeRun`, les hooks et l’appel Copilot                          |
| **Après la tentative**         | Dans la finalisation d’une tentative isolée ayant son point avant, après le résultat et les hooks `afterRun` éventuels, y compris après échec ou annulation |
| **Point manuel**               | **Nouveau point → Nom du point manuel → Créer le point**, également pour les sessions historiques dans le dossier courant                                   |
| **Sauvegarde de restauration** | Automatiquement avant la première écriture d’une restauration ciblée                                                                                        |

L’historique d’une tentative donne les raccourcis **Avant**, **Après** et **Comparer** vers les points qui lui sont réellement rattachés. Une capture avant indisponible empêche d’aller jusqu’aux hooks et à l’appel IA de cette tentative. Une capture après impossible produit un avertissement ; un point absent n’est pas présenté comme enregistré.

Les contenus sont stockés dans des objets privés immuables indexés par SHA-256, avec un manifeste propre au point. Le stockage est situé hors du checkout. La capture conserve les octets, les bits de mode des fichiers réguliers et les métadonnées de branche/HEAD ; ces métadonnées ne sont pas une copie de l’index ou de toute la base Git. Elle ne conserve pas les dates, ACL ou autres attributs étendus de fichiers.

## Comparer sans modifier

1. Sélectionne un point dans la liste.
2. Choisis **État actuel du dossier** ou un autre point dans **Cible de la comparaison**.
3. Clique **Comparer les fichiers** ; après une première lecture, **Actualiser la comparaison** refait l’observation.
4. Clique **Diff** pour ouvrir les deux versions dans VS Code. Les fichiers binaires ont un affichage descriptif avec taille et empreinte, sans prétendre à un diff textuel complet.

La comparaison distingue les fichiers ajoutés, modifiés et supprimés dans la cible par rapport au point source. Comparer deux points est consultatif : aucun bouton de restauration n’est disponible. Comparer un point à l’état actuel permet de préparer une restauration vers ce point source.

![Comparaison et sélection — données de démonstration](images/checkpoints.png)

## Restaurer une sélection

La sélection initiale est vide. Coche les fichiers voulus ou utilise explicitement **Sélectionner les fichiers restaurables**. Les chemins signalés non restaurables restent désactivés. Le host accepte au plus **200 fichiers distincts** par restauration.

| Diff point source → état actuel | Effet si tu coches ce fichier pour revenir au point        |
| ------------------------------- | ---------------------------------------------------------- |
| Modifié                         | Remplacer son contenu et ses permissions par ceux du point |
| Supprimé depuis le point        | Recréer le fichier conservé dans le point                  |
| Ajouté depuis le point          | Supprimer le fichier actuel absent du point                |

**Restaurer la sélection** ouvre la confirmation. **Conserver l’état actuel** l’abandonne ; **Confirmer la restauration** transmet les seuls chemins cochés et le fingerprint de la comparaison. Le host vérifie confiance, racine, branche, appartenance du point, état courant, chemins et disponibilité des fichiers. Une modification dans le périmètre comparé rend cette empreinte obsolète et impose une nouvelle comparaison.

Avant toute écriture ou suppression, le host crée une **Sauvegarde de restauration**, l’ajoute à l’historique et persiste cet état. Les étapes qui possèdent des tentatives deviennent **à actualiser**, leur révision est incrémentée, les critères d’acceptation reviennent **à vérifier** avec leur preuve humaine vidée, et le pilote passe en pause. Les anciens livrables, preuves et journaux restent dans l’historique ; ils ne constituent plus une validation actuelle des fichiers restaurés. Ces invalidations sont conservées même si la restauration échoue après la sauvegarde.

Les buffers VS Code non enregistrés des fichiers sélectionnés sont vérifiés avant l’opération puis avant l’écriture. Cette vérification voit uniquement les documents de la fenêtre VS Code courante. Elle ne voit pas les buffers non sauvegardés d’une autre fenêtre. Les fichiers sur disque sont recontrôlés après la sauvegarde et avant chaque écriture ; les processus externes restent hors sandbox.

L’opération entière n’est pas une transaction atomique de tous les fichiers. Un échec tardif peut laisser certains fichiers restaurés et d’autres inchangés. Le point de récupération persiste et l’erreur indique ce qui a déjà été restauré. Inspecte alors le résultat et compare ce point de récupération au dossier courant avant de choisir les fichiers à reprendre. Il n’y a ni reprise payante ni restauration inverse implicite.

La restauration agit sur les fichiers inclus et sélectionnés. Elle ne fait pas de `git reset`, ne restaure pas le staging/index, ne change pas de branche et ne recrée pas un commit. Un fichier recréé ou supprimé peut donc apparaître comme un changement Git à traiter manuellement.

## Périmètre et exclusions

Les points ne sont **pas une sauvegarde exhaustive**. Les limites portent sur le périmètre observé et sont appliquées avant la sauvegarde :

| Limite                               | Comportement                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| **4 MiB par fichier**                | Un fichier plus gros est exclu et signalé                                            |
| **64 MiB de contenus par point**     | Dépasser le total refuse la capture                                                  |
| **10 000 fichiers candidats**        | Dépasser ce nombre refuse la capture                                                 |
| **200 chemins d’exclusion affichés** | Le compteur peut être plus grand ; le manifeste conserve l’inventaire des exclusions |
| **8 MiB de manifeste / sortie Git**  | Une donnée trop volumineuse refuse l’opération                                       |

Dans un dépôt Git, les candidats sont les fichiers suivis et les fichiers non suivis non ignorés. Les fichiers non suivis exclus par les règles Git ne sont pas capturés : un inventaire compact de leurs chemins ou dossiers permet aussi de les protéger si les règles changent entre deux points. Les candidats et entrées ignorées sont limités ensemble à 10 000. Un fichier déjà suivi demeure candidat même s’il correspond ensuite à un motif de `.gitignore` ; les autres exclusions ci-dessous continuent de s’appliquer.

Sont exclus :

- Les secrets usuels reconnus par leur nom : `.env` et ses variantes, `.npmrc`, `.pypirc`, `credentials` et variantes, `id_rsa`, `id_ed25519`, ainsi que les extensions `.pem`, `.key`, `.p12`, `.pfx`.
- Les dossiers `.git`, `.feature-studio`, `.github`, `.vscode`, `.ssh`, `.aws`, `.azure`, `.codex`, `.copilot` et les entrées `.DS_Store`.
- Les dépendances et sorties usuelles : `node_modules`, `.venv`, `bin`, `obj`, `dist`, `build`, `coverage`, `.next`, `.vscode-test`.
- Les liens symboliques, fichiers à liens physiques multiples, fichiers non réguliers et fichiers hors racine.

Le filtrage reconnaît des chemins et noms usuels ; il ne détecte pas universellement un secret placé dans un fichier ordinaire. Les fichiers ignorés/exclus ne deviennent pas restaurables parce qu’ils ont été ajoutés à une sélection. Une modification concurrente observée pendant la lecture refuse la capture au lieu d’enregistrer une lecture incohérente.

## Historique, stockage et coût

Le `state.json` est en schéma **3**. Il conserve la liaison de worktree, les métadonnées des points, les références avant/après des tentatives et les données précédentes. Les formats v0, v1 et v2 migrent vers v3 en conservant les données connues ; les anciennes sessions ne reçoivent pas de worktree implicite. Un état invalide ou de version inconnue est rejeté en conservant son original.

**Ne reviens pas à la v0.2 sur ces données.** Elle refuse le schéma v3 et ne sait pas préserver les liens de worktree et de points. Aucune migration inverse n’est fournie. L’export Markdown documente le parcours mais ne remplace pas la conservation du stockage privé et des dossiers Git.

**Archiver la session** conserve son dossier, sa branche, ses objets et ses points sur disque. Cette version ne supprime pas automatiquement un worktree ou ses captures pour libérer de l’espace.

La création, capture, comparaison et restauration sont du code local : **aucune requête IA supplémentaire**, aucun commit de publication, push, PR ou déploiement automatique. Un nouveau run ou replay demandé ensuite continue d’utiliser le quota Copilot habituel. Les serveurs MCP restent des connexions explicitement configurées avec leurs effets propres ; les limites de compatibilité de la v0.2 sont décrites dans [MCP.md](MCP.md) et ne sont pas modifiées par l’isolation Git.
