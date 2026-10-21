# Travail en pair

Le mode pair est un mode d’exécution d’une étape de feature. La tentative conserve son identité, son contexte, ses permissions, ses preuves et son livrable au fil des échanges. Une discussion consultative reste une discussion sans accès aux outils du projet.

## Permissions des nouvelles sessions

Depuis la v1.22.0, les blocs de travail des nouvelles sessions utilisent les outils natifs Copilot et le mode de permission choisi pour la session. Le sélecteur reste indépendant du rythme solo/pair. Les outils métier conservent leurs contrôles. Le cadrage demeure consultatif dans ce lot ; son exploration native et la conversation native continue relèvent du lot 2. [Guide Copilot natif](COPILOT-NATIF.md).

## Parcours utilisateur

1. Choisir **Démarrer en mode pair** dans l’étape, préparer le contexte et vérifier son aperçu.
2. Définir le rythme et le niveau d’explication, puis ouvrir le travail en pair.
3. Lire l’organisation de l’agent, préciser ses préférences dans la conversation et valider explicitement l’organisation retenue.
4. Travailler bloc par bloc. Un bloc terminé rend la main à l’utilisateur ; l’agent ne peut pas s’accorder seul le bloc suivant.
5. Envoyer des questions ou proposer un changement de direction. Pendant une exécution, le message est conservé puis traité au terme du bloc. La pause permet d’interrompre plus tôt, en conservant le travail partiel.
6. Confier les blocs restants à l’agent avec **Continuer cette étape en solo**, ou reprendre les points de contrôle avec **Reprendre en pair**. Les demandes d’information et de permission restent humaines en solo.
7. Relire le résultat et demander des corrections si nécessaire. Une correction fait l’objet d’une nouvelle organisation à valider ; les travaux et décisions antérieurs restent conservés.
8. Valider l’étape pour revenir à la session d’origine. Les étapes suivantes sont débloquées selon leurs dépendances ; elles ne démarrent pas implicitement.

## Attentes et interruptions

- Revenir à la session ou changer d’écran ne modifie pas l’organisation, ne donne pas d’autorisation et n’annule pas le bloc en cours.
- La phase de cadrage n’a accès à aucun outil du dépôt ou MCP. Les hooks de travail ne s’exécutent qu’après accord, pendant les blocs autorisés.
- Un bloc correspond à un appel d’exécution ; le contrôle revient à l’application à la fin de cet appel. Les demandes humaines pendant l’appel suspendent le décompte du délai, sans inventer de réponse.
- Une pause conserve les fichiers déjà modifiés, les messages partiels et les preuves déjà recueillies. Elle n’annonce pas le bloc comme terminé.
- Une fermeture durant un appel devient une interruption durable. Aucune exécution ne reprend au démarrage sans action humaine. Les questions restées ouvertes sont présentées avant reprise.
- Le passage en solo concerne exclusivement les blocs de l’organisation acceptée dans cette étape. Il ne valide ni le résultat de l’étape ni le bilan de la feature.
- Le pilote automatique du parcours s’arrête devant une étape pair non validée. Le bouton de passage en solo reste la commande explicite pour lui confier le travail restant.
- L’agent peut proposer une autre organisation, mais seule une commande humaine liée à sa version peut l’accepter.

## Contexte et conservation

Le contexte choisi au lancement et la configuration d’exécution sont conservés. Les appels suivants reçoivent ce contexte avec les échanges, l’organisation en cours, les décisions et les sorties déjà produites. Aucun historique n’est supprimé ou résumé silencieusement pour respecter une limite. Si la limite de contexte est atteinte, l’exécution s’arrête avec une explication et le budget peut être ajusté explicitement.

La reprise vérifie l’identité de la tentative, la version du besoin, l’état des dépendances, la branche et les réglages d’autorisation. Une modification du périmètre ou des réglages exige une nouvelle préparation. Dans le régime Studio historique, les droits sur les fichiers modifiés avant le lancement restent liés aux contenus explicitement autorisés ; une édition externe ultérieure ne crée pas une autorisation nouvelle.

Les conversations et les organisations successives sont incluses dans l’export de session. Le livrable final rassemble les organisations acceptées, les décisions retenues et les résultats des blocs. Les blocs et corrections s’ajoutent à la même tentative ; les versions du compte rendu restent consultables dans l’historique habituel.

Les anciens échanges restent consultables sans modification après une nouvelle tentative, y compris si celle-ci utilise le mode classique.

La suppression définitive de la session nettoie aussi toutes les sessions natives créées pour ses échanges pair, sans supprimer les fichiers du projet.

La v1.21.0 a introduit le stockage version 7 afin que les anciens clients ne puissent pas réenregistrer une session en supprimant son état pair. Les versions antérieures sont migrées sans démarrer de travail. Les conversations de la v1.19 et de la v1.20 conservent leurs messages, contexte figé, consommation, fichiers et sessions natives. Les travaux en cours demandent une reprise explicite du cadrage pour convenir des blocs restants ; les livrables déjà prêts restent disponibles pour validation.

La v1.22.0 utilise la version 8 pour conserver également le régime natif, les permissions et les événements d’outils. Une activité native en cours lors de la fermeture est marquée interrompue à la réouverture ; aucun appel n’est relancé.

## Consommation et validation

Chaque appel de cadrage, de conversation ou de travail compte dans le plafond d’exécutions de la feature. Les mesures sont cumulées par tentative sans compter deux fois les événements intermédiaires. Une mesure manquante reste inconnue et ne devient pas une consommation nulle. Le nombre d’appels est affiché dans l’espace pair et le compteur de budget.

Le délai d’exécution s’applique au temps du runtime ; le temps où une réponse humaine ou une permission est attendue est exclu. Les critères, remarques bloquantes, preuves hôtes et contrôles de fichiers sont ceux du parcours habituel. Un résultat rédigé par l’agent ne remplace pas une preuve hôte, et l’autopilot ne peut pas valider une étape issue du mode pair.

## Vérifications

- `tests/pair.test.ts` : lancement avec empreinte du contexte, absence d’outils avant accord, arrêts entre blocs, passage solo/pair, messages pendant le travail, pause, correction, budget, permissions, identité de tentative et récupération après fermeture. Les outils fichiers et le stockage sont réels ; les réponses du modèle sont simulées.
- `tests/adapter.test.ts` : transport SDK, catalogue autorisé et exclusion des attentes humaines du délai.
- `tests/ui-pair.spec.ts` : préparation du contexte, préférences, organisations versionnées, conservation des brouillons, erreurs, commandes pendant le travail, validation finale et affichage compact.
- Les tests existants de workflow, migration, contexte, discussions, qualité, fichiers et autorisations vérifient la conservation des contrats du cockpit.

Les captures de l’interface sont produites dans `design/proposals/2026-10-20-mode-pair/` par les essais visuels. Elles illustrent des états de démonstration explicitement construits pour vérifier le rendu, pas une exécution réelle du fournisseur de modèle.
