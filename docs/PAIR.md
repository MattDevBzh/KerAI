# Travailler avec un agent en mode pair

Dans une étape de session, clique sur **Démarrer en mode pair**. Prépare le contexte comme pour un lancement habituel : sélection des blocs, modifications et aperçu confirmé. Le rythme proposé est **Par lots**.

L’écran de travail réunit la conversation, le contexte confirmé, les fichiers modifiés et les crédits observés. L’agent commence par expliquer sa compréhension et proposer une organisation courte. Ce cadrage et les échanges d’ajustement n’ont aucun outil de projet ni MCP ; aucun hook de travail n’est exécuté.

## Choisir le rythme

- **Guidé** : une petite action convenue, puis un arrêt.
- **Par lots** : un lot convenu, puis un arrêt pour décider de la suite.
- **Autonome après cadrage** : réalisation jusqu’au livrable après validation de l’organisation.

**Envoyer et ajuster** échange sur le plan, les préférences ou les résultats. **Valider l’organisation et démarrer**, puis **Lancer la suite convenue**, autorisent le travail. Le contenu du message accompagne aussi ces boutons. Les compétences et les permissions de l’agent restent applicables.

Chaque réponse d’un tour guidé ou par lots revient à un point d’arrêt. L’agent reçoit l’instruction de limiter ce tour à l’action ou au lot convenu ; formule des lots précis, car leur périmètre reste interprété par le modèle. Aucun tour supplémentaire n’est lancé sans action humaine. Les pauses libèrent le projet pour les autres sessions.

## Repartir ou laisser l’agent poursuivre

**Revenir à la session** ou changer de page conserve le rythme choisi. **Ouvrir le mode pair** retrouve la conversation. Un brouillon de message est conservé pour la dernière conversation ouverte.

**Continuer en solo** demande explicitement de terminer avec les décisions déjà prises. Si un tour travaille déjà, le relais intervient à sa fin. Les questions bloquantes, permissions MCP et validations finales restent humaines. Une erreur ou une annulation interrompt le relais ; la reprise est explicite.

L’historique et le contexte sont conservés dans le stockage privé de la session, sans fichier ajouté au dépôt. Après redémarrage de VS Code, une exécution interrompue ne repart pas seule. Une modification de la mission, des sources validées ou des connexions exige un nouveau contexte. Le profil retenu au lancement reste figé pendant la conversation.

## Terminer et valider

L’agent peut signaler que la mission est terminée. Tu peux aussi demander **Préparer le livrable actuel** : il synthétise le travail déjà réalisé, en indiquant les tâches restantes. Cette synthèse n’exécute pas de nouveau travail.

**Valider l’étape** applique les mêmes contrôles que la session habituelle : livrable, questions ouvertes, dépendances, preuves et remarques bloquantes. Après validation, tu reviens à la session. Pour modifier le rapport ou demander une correction, utilise **Relire ou corriger dans la session**.

## Crédits et limites

Chaque tour appelle Copilot et peut consommer des crédits. Le total observé reste rattaché à une seule tentative, y compris les tours échoués. Chaque tour compte néanmoins dans le budget de runs ; les plafonds de crédits, tokens et contexte sont contrôlés avant de lancer le suivant. L’historique complet est réinjecté avec le contexte confirmé, sans résumé silencieux : une conversation longue peut atteindre la limite de contexte.

Cette première version concerne un agent et une étape à la fois. Les discussions générales restent disponibles séparément.
