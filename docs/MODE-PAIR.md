# Conversation de l’étape et travail en pair

Depuis la v1.23.0, chaque nouvelle tentative native possède un onglet **Conversation**, à côté du livrable, des fichiers, des preuves et de la relecture. Il montre les messages de l’agent, ses réflexions lorsqu’elles sont transmises par Copilot et ses outils réels. Les sorties longues sont signalées comme tronquées ; les événements détaillés restent dans l’archive.

Les outils, réflexions et messages de suivi occupent des lignes compactes. Dès qu’un message destiné à l’utilisateur arrive, le groupe technique précédent se replie sous **Afficher les messages intermédiaires**. **Masquer les messages intermédiaires** le replie après consultation. Les demandes de réponse restent affichées dans le chat et s’ouvrent aussi dans une popin réductible ; le brouillon est commun aux deux vues.

## Solo, pair et passage de relais

En **solo**, tu suis la conversation en lecture seule. **Passer en pair** ouvre la saisie dans la même tentative et demande un arrêt au prochain point de contrôle. Le travail déjà en cours continue ; l’indicateur distingue le mode demandé du mode effectif.

En **pair**, tu échanges avec l’agent. **Confier la suite** lui laisse enchaîner les blocs restants de l’organisation acceptée. Ce bouton ne valide ni une organisation proposée ni le résultat final. **Reprendre la main** demande l’arrêt : attends le message **À toi · exécution arrêtée** avant d’éditer les mêmes fichiers dans VS Code. Les modifications déjà réalisées sont conservées.

Les demandes de permission et les questions natives restent visibles dans les deux modes. Le choix **Manuel / Assisté si disponible / Tout autoriser** reste indépendant du mode de collaboration et du rythme. [Permissions et limites du runtime](COPILOT-NATIF.md).

## Convenir du travail

Un lancement en pair commence par un cadrage. L’agent peut lire le code avec `view`, `glob` et `grep`, et poser une question avec `ask_user`. Le terminal, l’édition, les hooks de travail et les MCP sont indisponibles pendant le cadrage et les explications.

Tu choisis **Pas à pas**, **Par blocs** ou **En une fois après cadrage**, ainsi que des explications concises ou détaillées et tes préférences. Tu peux ajuster ces choix dans le chat. Un changement de rythme demande une nouvelle organisation du travail restant lorsqu’il y a des blocs à revoir ; les blocs terminés sont conservés. Modifier le niveau d’explication seul ne déclenche aucun appel.

Seul **Valider l’organisation et démarrer** autorise les blocs proposés. Chaque bloc en pair rend la main avant le suivant. Le solo peut enchaîner une organisation déjà acceptée. Un lancement initial en solo exécute directement la mission choisie, comme auparavant.

## Expliquer et corriger le livrable

Le chat reste utilisable lorsque le livrable est prêt, jusqu’à la validation de l’étape. **Revenir à la conversation** depuis le livrable ouvre ce même chat. Une demande d’explication conserve le livrable. Une correction passe par une proposition de travail restant, ton accord puis une nouvelle version à relire.

**Valider cette étape** approuve le résultat et débloque la suite du parcours. La conversation devient consultable en lecture seule. Pour corriger une étape déjà validée, utilise le parcours explicite de correction ou une nouvelle tentative. La **Discussion libre** du menu reste disponible pour les consultations sans lien avec une étape ; elle n’a pas d’outils de projet.

## Messages et reprises

Chaque message est enregistré avant transmission. Pendant le travail, il est envoyé à la conversation native si le runtime l’accepte ; sinon il attend le point de contrôle. Son état apparaît dans le chat : en attente, transmission en cours ou reçu. Un message dont l’envoi est incertain ne repart jamais automatiquement : relis la réponse, puis choisis **Renvoyer explicitement** ou **Garder sans renvoyer**. Un échec d’enregistrement conserve le brouillon.

La même session Copilot est reprise tant que la mission et la configuration restent compatibles. Les nouveaux tours apportent les nouvelles interventions et l’organisation actuelle ; ils ne réinjectent pas tout l’historique Studio. Les permissions et le catalogue d’outils sont réappliqués et vérifiés à chaque reprise. Les événements déjà reçus ne sont pas comptés une seconde fois.

Après fermeture, le travail actif est marqué interrompu. La reprise est explicite ; messages, questions, décisions, fichiers et consommation restent conservés. Le stockage version 9 protège ces champs contre un ancien client. Les sessions anciennes conservent leur parcours d’origine ; elles peuvent être archivées si leur reprise est incompatible.

## Vérifications

- `tests/conversation.test.ts` : explications et corrections, reprise native, préférences, messages en cours, pause confirmée, envois incertains, persistance et validation humaine.
- `tests/adapter.test.ts` et `tests/native-runtime.test.ts` : catalogue de lecture appliqué au vrai CLI lors des reprises, exclusion des écritures, événements et réception des interventions.
- `tests/ui-conversation.spec.ts` : onglets, passage solo/pair, brouillons, liens vers le chat, commandes distinctes et fenêtre étroite.
- Les tests historiques du mode pair, du workflow, du stockage et des outils métier continuent de couvrir leurs contrats.

Les captures `docs/screenshots/conversation-*.png` montrent des états de démonstration pour vérifier le rendu. La recette réelle est consignée séparément dans [VALIDATION.md](VALIDATION.md).
