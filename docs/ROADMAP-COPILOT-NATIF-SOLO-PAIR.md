# Roadmap Copilot natif et collaboration solo pair

Date : 21 octobre 2026.

Feature Studio doit permettre de confier une tâche à son agent, de travailler avec lui dans VS Code, puis de lui rendre la suite dans la même conversation. La première priorité est de retrouver les outils natifs de Copilot et de rendre ces passages de relais fluides. Les agents, le QG et les réactions visuelles accompagnent le travail dès ces premiers lots.

Cette roadmap définit les travaux à réaliser et leurs critères de réussite. La priorité Copilot natif puis solo et pair vient de Matt ; les extensions à plusieurs moteurs et à une application autonome sont proposées pour la suite. Les numéros de version et le calendrier seront fixés après la validation du premier lot technique.

## Point de départ

Le produit possède déjà les parcours, la session libre, les outils Studio, les MCP sélectionnés, les checkpoints, les preuves de tests, les discussions et le QG. Le mode pair apporte une organisation validée, des blocs, des messages, des interruptions et le passage solo ou pair au sein d’une étape. Il faut prolonger ce travail, notamment pour démarrer directement en solo et rejoindre le pair sans recréer une tentative.

La v1.21.0 est publiée, comme confirmé par Matt. Le dépôt est maintenant sur le commit d’intégration `844d608`. Le lot 0 est acquis ; le mode pair complet constitue la base de cette roadmap. Le passage pair → solo → pair, les messages en attente, la pause, les brouillons et la conservation des échanges existent déjà.

L’adaptateur actuel remplace les principaux outils natifs par les outils `studio_*`. Ses contrôles de fichiers, sa collecte de preuves et ses permissions reposent sur ce fonctionnement. L’ouverture des outils natifs demande donc un contrat d’exécution distinct. Le contexte et les sorties des échanges pair sont aujourd’hui reconstruits pour les appels successifs ; la continuité d’une conversation native devient un chantier explicite.

Références du dépôt : [transport Copilot](COPILOT.md), [mode pair](MODE-PAIR.md), [adaptateur](../src/host/CopilotCliAdapter.ts), [orchestration](../src/host/StudioService.ts), [état pair](../src/shared/pair.ts).

## Décisions communes aux premiers lots

Trois choix restent indépendants :

| Choix | Ce qu’il détermine | Ce qu’il conserve |
| --- | --- | --- |
| Outils Studio ou outils natifs Copilot | Les capacités proposées et leur mode de contrôle | L’identité de la session et la traçabilité du travail |
| Solo ou pair | Le rythme, les explications et les points où Matt reprend la main | Les permissions et l’objectif déjà convenus |
| Permissions | Les actions autorisées et la durée des accords | Les validations humaines du résultat et du parcours |

Décision de Matt : les nouvelles sessions utilisent Copilot natif par défaut, avec choix explicite des permissions. Les anciennes sessions ne nécessitent pas de chantier de migration ou de reprise ; une session incompatible pourra être archivée. Aucun changement de régime ne découle du bouton solo ou pair.

Le shell natif peut exécuter du code avec les droits du processus. Un worktree, un répertoire de travail ou un filtre de noms de commandes ne constituent pas une isolation du système. Le profil natif doit exposer ses permissions réelles ; les garanties strictes des outils Studio restent attachées à leur régime. Si une restriction indispensable ne peut pas être appliquée avec le runtime testé, la capacité concernée reste indisponible dans ce profil. [Permissions Copilot](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/allowing-tools).

Le pilote Feature Studio conserve la responsabilité du parcours. Le mode solo signifie « poursuivre la mission convenue » ; il n’active pas un deuxième pilote indépendant dans le CLI.

## Ordre des livraisons

| Lot | Résultat utilisable | Dépendance | Critère de passage au lot suivant |
| --- | --- | --- | --- |
| 0 | Acquis avec la v1.21.0 publiée | Aucune action restante dans ce lot | Base conservée pour les prochaines évolutions |
| 1 | Copilot réalise une petite tâche avec ses outils natifs | Base v1.21.0 | Lecture, édition, commande, autorisation, arrêt et reprise attestés sur un vrai runtime |
| 2 | Une exécution classique rejoint le pair et reçoit des précisions plus directement | Lot 1 pour la continuité native | Comportements existants conservés, transitions et messages supplémentaires vérifiés |
| 3 | Matt et l’agent alternent directement dans VS Code | Lot 2 | Les modifications humaines sont prises en compte après un passage de relais confirmé |
| 4 | Réparti entre les prolongements 1b et 2b | Aucun chantier indépendant | Capacités complémentaires et démarrage simplifié ont chacun leur périmètre |
| 5 | Les partenaires et le QG rendent la collaboration plus vivante | États d’activité des lots 1 à 3 | Une semaine d’usage montre une aide compréhensible et un agrément validé par Matt |
| 6 | La même expérience fonctionne avec un deuxième moteur | Lots 1 à 3 et capacités nécessaires de 1b validés | Scénarios communs réussis avec Copilot et Codex |
| 7 | Une application autonome partage les sessions avec VS Code | Lot 6 et décision produit | Passage entre les deux interfaces sans double exécution ni perte |

Les lots 1 à 3 forment la première livraison cible. Les lots suivants ne bloquent pas sa mise à l’essai.

## Lot 0 Publié avec la version 1.21.0

Le mode pair complet est le socle livré. Les prochaines évolutions conservent ses migrations, organisations, brouillons, budgets et reprises. Il ne reste pas de chantier d’intégration à réaliser au titre de ce lot.

## Lot 1 Utiliser les outils natifs Copilot

Implémentation v1.22.0 : [guide et matrice vérifiée](COPILOT-NATIF.md). La publication reste attestée séparément par la release GitHub et sa CI.

**Expérience attendue :** créer une session Copilot native, choisir ses permissions, demander une petite correction, voir les fichiers et commandes concernés, répondre aux demandes nécessaires puis consulter le résultat.

Aujourd’hui, `ToolHost` fournit les opérations de fichiers et une commande de test choisie dans une liste configurée, disponible dans le profil de tests. Le terminal général et les principaux outils natifs sont exclus dans l’adaptateur. La cible permet à Copilot de choisir ses outils de lecture, recherche et édition, puis une commande adaptée au diagnostic, dans le périmètre autorisé. Par exemple, le même agent peut examiner un échec, corriger le code et lancer le test ciblé nécessaire sans devoir créer un nouvel outil Studio pour cette commande.

Le bénéfice attendu est une capacité d’action plus proche du CLI et moins d’outils génériques à entretenir dans Feature Studio. Ce changement ne promet ni une meilleure réponse du modèle ni un gain automatique de vitesse. Feature Studio garde la présentation, les rôles, le contexte choisi, les validations et les outils métier spécifiques.

| Travail | Livrable concret |
| --- | --- |
| NAT 01 Vérifier le runtime | Matrice des versions SDK et CLI testées et des capacités observées : catalogue, permissions, outils, questions, flux, interruption, historique et reprise |
| NAT 02 Ajouter le régime natif | Exécution native par défaut pour les nouvelles sessions ; permissions choisies à la création, au lancement et pendant le travail |
| NAT 03 Relier les autorisations | Demandes de lecture, écriture, commande, accès externe et questions natives rendues dans le cockpit ; accords limités à la portée réellement prise en charge |
| NAT 04 Montrer le travail | Journal avec commande, dossier, état, résultat et fichiers observés ; avatar et QG reliés à cette activité |
| NAT 05 Conserver les preuves | Résultats des commandes et changements attachés à la bonne exécution, avec origine native ou hôte identifiable |

Le premier périmètre comprend lecture, recherche locale, création et édition, terminal et questions humaines. Les outils web, les sous-agents et les personnalisations natives constituent le prolongement 1b, après vérification de leurs événements et permissions.

La documentation SDK expose sessions, événements, filtres d’outils et demandes humaines ; elle distingue aussi les fonctions réservées à l’interface du terminal. La matrice NAT 01 doit confirmer ce que le couple installé permet réellement. [Compatibilité SDK et CLI](https://docs.github.com/en/copilot/how-tos/copilot-sdk/troubleshooting/compatibility).

Un texte de l’agent affirmant que les tests passent ne devient pas une preuve. Une commande native doit fournir les éléments requis pour attester son exécution ; les tests structurés existants restent disponibles via le collecteur hôte lorsque ces éléments manquent. Les changements observés dans Git ne suffisent pas, à eux seuls, à attribuer chaque édition à l’agent.

**Terminé quand :** sur un dépôt de recette, Copilot effectue une lecture, une modification et un test avec les outils attendus ; un refus est respecté ; l’arrêt ne laisse pas de travail actif non signalé ; la reprise restaure les restrictions ; les sessions Studio continuent de fonctionner. Les accords restent limités à la portée affichée. Les essais payants nécessaires sont bornés et consignés.

## Lot 2 Garder une conversation entre solo et pair

**Expérience attendue :** démarrer en solo, revenir travailler avec l’agent, puis lui confier la suite sans répéter le besoin ni recréer la tentative.

La nouveauté porte sur les limites ci-dessous ; le passage solo et pair existant reste acquis.

| Comportement | Version 1.21.0 | Évolution proposée |
| --- | --- | --- |
| Pair → solo → pair | Disponible dans une tentative démarrée en pair | Conservé |
| Exécution classique → pair | L’état pair doit exister pour recevoir ces commandes | Rejoindre le pair dans la tentative active |
| Message pendant un bloc | Conservé puis traité après le bloc ; l’envoi remet le mode en pair | Prise en compte pendant le travail lorsque le runtime le permet ; changement de mode explicite |
| Cadrage | Aucun accès au dépôt ou MCP pendant la conversation de cadrage | Lecture autorisée du code en cadrage natif, avant de convenir du travail |
| Continuité interne | Historique Studio conservé, nouvelle session native pour chaque tour pair avec contexte reconstruit | Réutilisation de la conversation native lorsque le périmètre reste compatible |
| Pause et reprise | Déjà disponibles avec conservation du travail | Adapter la confirmation d’arrêt aux outils et processus natifs |

La conservation du transcript natif est une évolution interne. L’interface actuelle conserve déjà les échanges ; il ne faut pas présenter ce chantier comme la réparation d’une perte systématique de contexte. Son effet sur le coût et la qualité sera mesuré. Le changement du comportement d’un message vers un mode explicite est une proposition produit à valider dans la recette.

| Travail | Livrable concret |
| --- | --- |
| REL 01 Conserver la conversation | Identité durable de session et lien vers le transcript natif ; événements et consommation dédupliqués ; reprise explicite après fermeture |
| REL 02 Séparer les états | Mode demandé, mode effectif, exécution active et attente humaine distincts ; transitions persistées et commandes répétées sans effet supplémentaire |
| REL 03 Généraliser les passages | Démarrage solo ou pair depuis la même session ; retour en pair disponible même si la tentative a commencé en solo |
| REL 04 Traiter les messages | Messages conservés, état envoyé ou en attente visible, interruption et réorientation reliées aux possibilités vérifiées du runtime |
| REL 05 Préserver la continuité | Objectif, décisions, fichiers, résultats et budget conservés ; archive possible des anciennes conversations incompatibles, sans chantier de migration |
| REL 06 Adapter le cadrage | Exploration en lecture selon les permissions du profil natif, organisation courte pour une tâche simple et points de contrôle choisis ; une question ou un changement de rythme ne redemande pas tout le plan |

Le contrat de l’adaptateur évolue pour conserver une session et recevoir de nouveaux messages pendant sa durée de vie. La persistance du transcript et la durée de vie du processus sont traitées séparément : une conversation peut survivre à la fermeture du processus, avec reprise contrôlée. Le mode pair natif permet de consulter le code autorisé pendant le cadrage ; le contrat historique du cadrage Studio reste préservé.

La session native est réutilisée lorsque son contexte et son périmètre restent compatibles. Les nouveaux échanges sont ajoutés sans recopier tout l’historique à chaque appel. Une réduction de contexte ou une reconstruction nécessaire est visible ; les archives complètes restent consultables. Les handlers et restrictions sont réinstallés lors de chaque reprise. [Persistance Copilot](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/session-persistence).

Les commandes proposées ont des effets distincts :

| Action de Matt | Comportement attendu |
| --- | --- |
| Confier la suite | Poursuivre l’objectif déjà convenu en solo, avec les mêmes permissions |
| Revenir en pair | Demander le retour au prochain point de contrôle ; montrer la transition en attente jusqu’à son application |
| Reprendre la main maintenant | Interrompre l’exécution et attendre la confirmation d’arrêt des outils avant d’annoncer que Matt peut modifier les fichiers |
| Envoyer une précision | Conserver le mode courant ; annoncer si le message est pris en compte maintenant ou après le travail actif |
| Modifier l’objectif | Faire apparaître le nouveau périmètre et son éventuel accord nécessaire avant la suite |
| Répondre à une permission | Traiter cette demande sans valider un plan ou un résultat |

Un message immédiat permet de réorienter le modèle ; il ne constitue pas une garantie d’arrêt. Si le runtime ne permet pas un passage au point de contrôle suffisamment fiable, le premier fonctionnement utilise l’interruption confirmée puis la reprise. Un processus encore actif reste annoncé comme tel. Le passage en pair ne vaut pas, à lui seul, autorisation d’éditer simultanément les fichiers avec l’agent.

**Terminé quand :** la séquence solo → pair → solo fonctionne dans la même session, y compris pendant une question, une permission ou une commande longue. Aucun clic répété ne double un appel ; aucun message ne disparaît ; le redémarrage retrouve le mode et l’attente sans exécution spontanée. Un résultat reste soumis à la validation prévue par le parcours.

## Lot 3 Travailler ensemble dans VS Code

**Expérience attendue :** garder le code au centre, sélectionner un passage, en discuter, le modifier soi-même puis rendre la main à l’agent.

Le cockpit complet reste un onglet pour composer une équipe, suivre le QG et lire les bilans. Une vue Compagnon compacte affiche la même session pendant le travail dans l’éditeur : partenaire, projet et branche, conversation, mode courant et commande de relais. Elle peut être déplacée dans la barre latérale secondaire par l’utilisateur ; la disposition choisie reste respectée. [Vues latérales VS Code](https://code.visualstudio.com/api/ux-guidelines/sidebars).

Le parcours prévu est : ouvrir le code depuis une étape, sélectionner une fonction, utiliser « Discuter avec mon agent », vérifier la sélection jointe, puis échanger dans le compagnon. Après une reprise de main confirmée, Matt édite normalement dans VS Code ; « Confier la suite » fait relire les modifications à l’agent. Les fichiers et diffs utilisent les éditeurs natifs. Si la session travaille dans un worktree, les liens pointent vers ce worktree et son identité reste visible.

| Travail | Livrable concret |
| --- | --- |
| IDE 01 Créer la vue compacte | Conversation, partenaire, mode courant et demandes dans un panneau latéral relié au cockpit existant |
| IDE 02 Envoyer le contexte utile | Actions sur une sélection, un fichier ou une modification ; aperçu du contenu transmis et lien de retour à ses lignes |
| IDE 03 Organiser le relais | État « À toi » après arrêt confirmé, puis action pour rendre la main ; lecture des changements réalisés entre les deux |
| IDE 04 Relire précisément | Liens vers les diffs, remarques sur une zone et demandes de correction associées à la bonne révision |

Les deux vues doivent partager le même service d’exécution. Masquer le compagnon ou ouvrir le cockpit ne crée pas une seconde session. L’état du travail appartient à l’hôte et au stockage, indépendamment du cycle de vie de la vue. Les avatars restent dans les espaces de l’extension ; le document, les sélections et les actions de VS Code passent par ses API et les messages de la webview. [Webviews VS Code](https://code.visualstudio.com/api/extension-guides/webview).

En SSH, WSL ou conteneur, le CLI doit être accessible dans l’environnement où s’exécute l’extension de workspace et où se trouvent les fichiers. Cette compatibilité demande sa propre recette. La fermeture complète de VS Code reste une interruption récupérable ; la poursuite indépendante de l’application nécessite le service prévu au lot 7. [Développement distant VS Code](https://code.visualstudio.com/api/advanced-topics/remote-extensions).

Les fichiers non enregistrés de la fenêtre sont signalés ; leur enregistrement n’est pas imposé silencieusement. Une modification externe détectée exige une nouvelle lecture avant reprise et invalide les preuves devenues périmées. La garantie vérifiée porte sur le passage de relais confirmé ; l’interface ne promet pas d’exclure toutes les écritures concurrentes d’autres processus.

**Terminé quand :** après arrêt confirmé, Matt modifie et enregistre une fonction ; l’agent reprend sur cette version, conserve cette modification et réalise la suite. Une remarque ouvre la bonne ligne, une correction vise la bonne révision et les captures du panneau sont validées par Matt.

## Première livraison cible

La recette produit associe les lots 1 à 3 sur une vraie petite feature :

1. Ouvrir le projet et démarrer une session Copilot native en solo avec un besoin.
2. Voir une exploration, une édition et une commande réelles ; refuser une action pour vérifier la réponse du système.
3. Envoyer une précision pendant le travail et constater quand elle est traitée.
4. Revenir en pair, puis reprendre la main avec confirmation d’arrêt.
5. Sélectionner une fonction dans VS Code, discuter d’un choix et modifier soi-même le code.
6. Confier la suite ; vérifier que l’agent tient compte de cette modification et exécute les tests utiles.
7. Interrompre, fermer puis rouvrir ; retrouver les échanges, les permissions encore applicables et les résultats sans relance automatique.
8. Reprendre explicitement, relire le diff et valider le résultat.

**Réussite :** le besoin n’a pas été ressaisi, les modifications humaines sont présentes, les effets et refus sont traçables, les tests annoncés ont une preuve et la validation reste une décision humaine. Cette recette décide de l’ouverture des prolongements 1b et 2b.

## Ancien lot 4 Répartition entre les prolongements 1b et 2b

L’ancien lot 4 réunissait l’accès aux capacités complémentaires du CLI et la simplification de l’entrée dans le travail. Il est réparti entre les lots concernés pour éviter un chantier redondant. Les skills, MCP et profils Studio existent déjà : le travail sur les personnalisations concerne leur articulation avec la configuration native du CLI.

**Prolongement 1b : les capacités et la configuration Copilot.**

Ajouter les instructions et skills natives, puis les outils web, hooks, plugins et sous-agents compatibles ; étendre la connexion MCP existante à cette configuration native. Présenter les sources effectivement chargées, leur portée et les conflits éventuels avec les profils Studio. Éviter d’injecter deux fois les mêmes instructions ; un changement de configuration doit être pris en compte selon les règles du runtime et être visible dans l’historique.

Les permissions d’un sous-agent et ses effets font partie de la recette avant activation de la délégation. Les capacités indisponibles restent signalées. Un accès au terminal du CLI peut compléter l’interface pour ses fonctions propres, avec un passage de relais explicite si la même session est concernée.

**Terminé quand :** une instruction du projet et une skill sélectionnée sont effectivement utilisées, un MCP et un sous-agent sont identifiables, et les configurations personnelles existantes sont conservées.

**Prolongement 2b : l’entrée rapide en session libre.** Faire de « projet, partenaire, demande » le chemin court vers une session, avec le mode et les permissions visibles et mémorisés selon leur portée. Une tâche simple n’exige pas la composition préalable d’un parcours. Une conversation consultative garde son historique ; son passage au travail outillé utilise le service d’exécution avec un accord explicite et ne donne pas d’outils à la discussion consultative elle-même.

**Terminé quand :** une tâche courte commence depuis la demande initiale, sans préparation répétitive ni abandon du contrôle sur le contexte et les permissions.

## Lot 5 Renforcer le plaisir de travailler avec son équipe

Dès les premiers lots, le partenaire et le QG montrent les états réels de lecture, édition, test, attente et réussite. Ce lot enrichit ces interactions : préférences de collaboration persistantes, reprise courte des décisions du projet, réactions aux étapes importantes et intensité des animations ou de l’humour réglable.

Les progrès célébrés correspondent à du travail vérifié ou validé. Le mode concentration conserve le compagnon avec une présence discrète. Les états visuels ne créent pas de faux sous-agents et n’entraînent pas d’appels modèle supplémentaires pour animer le décor.

**Terminé quand :** Matt utilise la version pendant une semaine et valide les réactions, les moments d’interruption et le confort en relecture. Les observations servent à corriger les irritants avant d’ajouter d’autres récompenses.

## Lot 6 Ajouter Codex puis Claude

Extraire les opérations déjà éprouvées avec Copilot : ouvrir, envoyer, réorienter, interrompre, reprendre, demander un accord et publier les événements. Afficher les capacités propres au moteur. Les noms des outils, les unités de consommation et les possibilités de reprise restent attribués au fournisseur.

Ajouter Codex en premier : son [App Server](https://learn.chatgpt.com/docs/app-server) expose une intégration destinée aux interfaces riches. Rejouer la recette de la première livraison avec le même cockpit. Les historiques Studio sont communs ; le transfert du transcript interne entre fournisseurs n’est pas présumé possible. Un passage à un autre moteur transmet un contexte explicite dans une nouvelle conversation native.

Ajouter ensuite Claude, avec une recette équivalente et une décision d’authentification fondée sur les possibilités de son [Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview). L’accès via une application tierce doit être vérifié indépendamment de l’abonnement utilisé dans le CLI.

**Terminé quand :** Copilot et Codex passent la recette commune, puis Claude la passe à son tour ; les différences de capacités restent compréhensibles dans l’interface.

## Lot 7 Proposer une application autonome

Après validation de l’usage quotidien, réutiliser le cœur de session dans une application autonome et l’intégration VS Code. Prévoir un propriétaire unique de l’exécution locale, deux interfaces synchronisées et des préférences partagées. La fermeture d’une vue ne doit ni dupliquer ni abandonner silencieusement une exécution.

**Terminé quand :** Matt commence une tâche dans l’application, ouvre son code dans VS Code et reprend la même session avec son partenaire, ses messages et ses résultats. Le choix de l’enveloppe technique vient après cette décision produit.

## Validation et responsabilités

| Responsable | Travail |
| --- | --- |
| Développement assisté | Implémentation des lots, migrations, tests, diagnostic, documentation et préparation du paquet local |
| Matt | Validation des captures, essai de la première recette et choix du niveau de présence du compagnon |
| Ensemble | Recette sur un vrai projet, traitement des irritants et choix du prochain lot |

Chaque lot distingue les tests du moteur avec transport simulé, les essais avec le vrai CLI, le fonctionnement dans une extension VS Code réelle et l’état du paquet. Les changements d’exécution sont vérifiés sur macOS et Windows avant leur disponibilité sur ces plateformes ; les contrôles Linux restent dans la CI. Les cas d’interruption, permissions, migration et conservation des modifications ont priorité sur les tests qui reproduisent simplement le code.

Le paquet vérifié doit correspondre au commit testé. Une publication, son téléchargement et sa vérification constituent une étape de livraison distincte, déclenchée sur demande de Matt. La rédaction de cette roadmap ne lance ni implémentation, ni appel modèle payant, ni publication.
