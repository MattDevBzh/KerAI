# Copilot natif et permissions

Les nouvelles sessions de Feature Studio 1.23.0 utilisent les outils natifs Copilot : lecture, recherche locale, création et édition de fichiers, terminal et questions humaines. Le cockpit conserve les agents, les instructions sélectionnées, le parcours, le QG, les validations et les outils métier. Les discussions consultatives et l’Observateur restent sans outils de projet.

## Choisir les permissions

Le mode est visible à la création de la session, avant le lancement et dans le travail en cours. Un changement est appliqué par Copilot et confirmé avant d’être enregistré. Pendant une demande humaine, réponds d’abord à cette demande. Si un changement ne peut pas être confirmé sur une exécution active, celle-ci est interrompue.

| Mode | Comportement |
| --- | --- |
| Manuel, par défaut | Tu réponds aux demandes transmises par Copilot. Le runtime décide quelles actions nécessitent une demande ; ce mode ne promet pas une confirmation pour chaque édition. |
| Assisté | Les demandes avec une recommandation d’approbation valide du runtime peuvent être acceptées ; les autres restent humaines. Disponible uniquement si le diagnostic confirme ce mode. |
| Tout autoriser | Copilot autorise les actions natives selon son mode `allow-all`. Les règles imposées par l’organisation restent prioritaires ; une demande résiduelle est présentée à l’utilisateur. |

Chaque demande affiche les informations disponibles : dossier, commande, chemin, modification ou outil MCP. **Autoriser cette demande** répond à cette demande uniquement ; **Refuser** transmet un refus. Une demande trop volumineuse pour être présentée entièrement est refusée. Les questions `ask_user` attendent une réponse effective, libre ou choisie.

Quand le runtime le permet, **Autoriser ce type pour la session** couvre les prochaines demandes du même type (lecture, écriture, commande, adresse ou MCP), y compris celles déjà en attente. **Autoriser les lectures dans cette solution** limite cet accord aux chemins réellement situés dans le dossier de travail ; un lien qui sort du dossier reste soumis à une demande. L’accord est partagé avec les sous-équipes de cette session dans le même dossier, sans être partagé avec les autres sessions. Il reste en mémoire jusqu’à la fermeture du projet ou au choix d’un mode de permissions. Les demandes imposées par l’organisation ou demandant un contournement de l’isolation restent ponctuelles.

Les demandes apparaissent automatiquement dans une popin. **Réduire au chat** la ferme ; la demande et le brouillon restent disponibles dans le panneau de chat. **Mettre en avant le prompt** rouvre la même demande. Une réponse n’est transmise qu’après ton clic sur son bouton de validation.

Solo/pair, permissions et validation du résultat sont trois choix distincts. Les changements de mode ne reviennent pas sur les effets déjà produits. Avant chaque exécution ou reprise, les accords internes du runtime sont remis à zéro et le mode courant est réappliqué. Les accords de session explicitement choisis dans le cockpit restent contrôlés par le host pour chaque demande. La politique gérée par Copilot reste en vigueur.

## Voir les résultats

L’onglet **Conversation** partage ces événements avec les échanges de l’agent. En cadrage et pendant les explications, seuls la lecture du code et les questions humaines sont disponibles. Le catalogue complet revient pour le travail autorisé. La même session native est réutilisée entre ces tours, avec des permissions vérifiées à chaque reprise. [Fonctionnement solo/pair](MODE-PAIR.md).

La section **Preuves** présente l’activité native : outil, état, dossier, arguments, commande et résultat. Un code de retour n’apparaît que si Copilot fournit une valeur structurée ; une phrase telle que « les tests passent » ne constitue pas une preuve. Les sorties longues sont signalées comme tronquées. Les événements détaillés rejoignent aussi les archives de la session.

Les changements Git observés avant/après sont attachés à la tentative. Ils peuvent inclure des éditions humaines simultanées : ils ne confèrent pas de propriété sur les fichiers. L’observation est bornée à 2 000 fichiers par projet et 64 Mo de contenu ; les gros fichiers utilisent leurs métadonnées. Une impossibilité d’observation est signalée sans interdire le travail natif. Les tests structurés et contrôles métier Studio conservent leurs preuves propres.

**Arrêter** interrompt le runtime et attend sa fermeture. Les modifications déjà réalisées restent sur disque. Les opérations dont la fin n’a pas été reçue restent marquées interrompues. Le contrôle local a vérifié l’arrêt d’un processus Node enfant lancé en arrière-plan ; il ne garantit pas l’arrêt universel d’un service qui se serait détaché du processus.

## Runtime vérifié

| Couple / capacité | Résultat observé le 21 octobre 2026 |
| --- | --- |
| SDK 1.0.20 + CLI 1.0.63 | APIs de permissions requises indisponibles ; lancement natif refusé avec diagnostic. |
| SDK 1.0.20 + CLI 1.0.102 sur macOS | Catalogue natif, lecture, édition, shell, question humaine, refus, changement de permissions, reprise et annulation vérifiés. |
| Manuel et tout autoriser | Confirmés par le runtime 1.0.102. |
| Assisté | Refusé par ce runtime ; option désactivée, sans remplacement silencieux. |
| Règle gérée de refus | Refus de commande respecté même en mode tout autoriser dans le test de runtime. |
| Appel modèle réel | Une correction de fichier et une commande avec code de retour structuré 0 ; modèle gpt-6-luna, usage mesuré consigné dans la preuve. |
| Linux / Windows | Tests de catalogue, outils natifs et permissions intégrés à la CI avec CLI 1.0.102 ; vérifier le résultat du commit livré. |

Le diagnostic crée puis supprime une session jetable, sans prompt ni outil de projet. Il confirme les capacités effectives du runtime au lieu de déduire la compatibilité du seul numéro de version. Mets le CLI à jour selon son canal d’installation puis relance **Vérifier la connexion** si nécessaire ; l’extension ne modifie pas ton installation globale.

La configuration personnelle Copilot, les plugins, hooks, skills natifs, outils web et sous-agents ne sont pas ouverts dans ce lot. Les instructions et skills Studio sélectionnés et les MCP explicitement configurés restent gérés par l’application. Les capacités complémentaires relèvent du lot 1b.

Un terminal exécute avec les droits du processus : le dossier du projet ou un worktree ne constitue pas un bac à sable. Les anciennes limitations génériques Studio ne s’appliquent pas aux outils natifs. Le stockage version 9 protège les nouveaux champs contre un réenregistrement par un ancien client. Les anciennes sessions ne changent pas de régime automatiquement et peuvent être archivées si leur reprise est incompatible.

## Reproduire la recette

- `npm test` vérifie les règles, l’état, la persistance et l’orchestration sans appel modèle.
- `FEATURE_STUDIO_CATALOG_CLI=<chemin du CLI 1.0.102> npx vitest run tests/native-runtime.test.ts` exécute les vrais outils sur une fixture temporaire, sans authentification ni inférence.
- `npm run smoke:native` vérifie l’adaptateur réel, le changement de mode, la reprise et l’annulation. `FEATURE_STUDIO_NATIVE_CLI` permet de choisir le CLI ; le script utilise sinon l’installation de test locale.
- `FEATURE_STUDIO_LIVE_TEST=1 npm run smoke:native` ajoute un appel modèle payant borné sur une fixture temporaire. Ce scénario reste séparé de la suite automatique.
- `npm run test:ui` couvre le choix des permissions, les demandes et les résultats dans le cockpit.

La preuve locale synthétique est conservée dans [native-runtime-proof.json](native-runtime-proof.json). La validation du VSIX et de son téléchargement reste distincte de cette recette de runtime.
