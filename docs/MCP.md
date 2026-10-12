# MCP, US et interaction humaine

## Premier lancement avec contexte manuel

Chaque action manuelle **Exécuter**, **Rejouer** ou **Reprendre** ouvre le même formulaire : contexte initial (par exemple une US copiée), retour humain, connexions MCP et mémoire facultative. **Préparer l’aperçu** compose les sources localement. Le prompt métier, sa taille et chaque source sont visibles ; aucun modèle n’est appelé pour cet aperçu.

Le bouton de lancement exige un aperçu récent. L’hôte recalcule l’empreinte avant de démarrer : si le contexte, l’agent, les permissions, les réglages ou la tentative ont changé, il faut actualiser l’aperçu. Les instructions système du SDK, les descriptions d’outils et l’historique natif d’une conversation reprise s’ajoutent au prompt métier ; le compteur de l’aperçu n’est donc pas une facture ni le total exact de tokens envoyés au modèle.

`studio_ask_human` suspend son appel d’outil jusqu’à une réponse réelle dans le cockpit. Un choix fermé est vérifié, et l’annulation interrompt aussi les questions. Le résultat et les réponses sont sauvegardés avec la tentative. Le bloc final `feature-studio-questions` reste disponible en repli si le modèle ne pose pas sa question pendant le travail ; il nécessite alors une reprise explicite.

## Azure DevOps

Le preset utilise le package Microsoft **`@azure-devops/mcp@2.10.0`**, version épinglée, avec :

```text
Exécutable : npx
Arguments (un par ligne) :
-y
@azure-devops/mcp@2.10.0
mon-organisation
-d
work-items
--authentication
interactive
```

La liste d’outils autorisés contient `wit_work_item`. Les outils de création, modification, commentaire et liaison sont distincts et ne sont pas ajoutés. Le nom d’organisation est celui de `https://dev.azure.com/mon-organisation`, sans l’URL complète. Node/npm sont nécessaires sur la machine qui exécutera ce serveur MCP, même si le VSIX lui-même n’en a pas besoin séparément.

Le serveur est initialement **désactivé**. Enregistre-le, découvre ses outils, active-le, puis confirme les capacités dans la fenêtre native VS Code. Enfin coche-le dans le dialogue du lancement concerné. Exemple de contexte :

> Consulte l’US 208 dans MonProjet. Utilise sa description et ses critères pour préparer les spécifications de cette feature. Pose-moi une question si une décision produit manque.

Le preset propose aussi `--authentication azcli` pour une connexion `az login` déjà disponible. L’authentification interactive Microsoft peut demander une connexion dans le navigateur ; ses erreurs sont affichées dans le diagnostic. La connexion est propre à l’organisation et aux droits du compte.

Pour une configuration manuelle, cette version du serveur accepte également `envvar` avec `ADO_MCP_AUTH_TOKEN` ou `pat` avec `PERSONAL_ACCESS_TOKEN`. Ce dernier attend **la valeur encodée Base64 de `email:pat`**, pas le PAT brut. Enregistre uniquement la valeur attendue dans le coffre VS Code et référence son nom dans les clés d’environnement. Le preset évite ce mode pour ne pas demander de token personnel par défaut.

Microsoft propose aussi un serveur distant Azure DevOps. Le dialogue générique HTTP permet de configurer un endpoint et des références d’en-têtes. Toutefois, la négociation OAuth MCP distante n’est pas implémentée par le cockpit et la RPC `oauth.prepareLogin` n’était pas disponible sur le CLI 1.0.63 testé. La configuration du preset local a été vérifiée contre le package Microsoft ; le transport et les permissions ont été éprouvés avec une fixture locale. **Aucune connexion ni lecture dans l’organisation réelle de Matt n’est revendiquée**.

Sources vérifiées pour cette intégration : [serveur Microsoft](https://github.com/microsoft/azure-devops-mcp), [guide et authentification](https://github.com/microsoft/azure-devops-mcp/blob/main/docs/GETTINGSTARTED.md), [version publiée](https://www.npmjs.com/package/@azure-devops/mcp/v/2.10.0).

## Autres serveurs et secrets

- **stdio** : commande locale, arguments séparés, noms de variables d’environnement. Le serveur tourne sous ton compte.
- **HTTP / SSE** : URL HTTP(S) et en-têtes au format `Authorization=MCP_AUTH_TOKEN`. À droite se trouve le nom du secret, jamais sa valeur. Si le service attend `Bearer …`, le secret contient la valeur complète de cet en-tête.
- **Clés** : les secrets sont recherchés dans `ExtensionContext.secrets` pour ce workspace/serveur, puis dans l’environnement du processus VS Code. L’UI ne relit pas leurs valeurs et ne les inclut pas dans l’état, les prompts ou l’export. Les valeurs connues sont masquées dans les retours runtime.
- **Découverte** : démarre explicitement le serveur et liste ses outils, sans lancer une session de travail ni envoyer de prompt. Un serveur stdio peut devoir installer son package ou effectuer sa propre connexion. Les changements de configuration doivent être enregistrés avant ce test.
- **Sélection** : seuls les noms bruts cochés dans la liste sont utilisables, et seuls les serveurs sélectionnés pour la tentative sont démarrés. Le joker `*` sert uniquement à la découverte sans prompt et est refusé dans les exécutions.

## Permissions effectives

Avant l’envoi du prompt, le runtime doit exposer exactement les outils hôtes autorisés et les outils MCP sélectionnés, avec leur provenance serveur/outil. Un catalogue absent, incomplet ou contenant un outil inattendu bloque le lancement.

L’option **lectures automatiques** ne vaut que pour un outil sélectionné dont le runtime atteste la lecture seule, sans approbation gérée obligatoire. Sinon, une demande **Autoriser cette demande / Refuser** s’affiche. La décision s’applique à un seul appel. Un profil d’étape **lecture seule** refuse toute opération d’écriture ou dont la lecture seule n’est pas attestée ; un clic humain n’étend pas ce profil. Les annotations proviennent du serveur/runtime : n’ajoute que des serveurs auxquels tu fais confiance.

Le runtime peut autoriser une lecture annotée sans appeler le callback de permissions. Pour respecter une option **lectures automatiques désactivée**, l’adaptateur impose donc une règle native exacte `Mcp(serveur/outil)` demandant une décision humaine. Avant le prompt, il vérifie que la politique gérée a été retenue, que les modes de contournement et d’approbation assistée sont désactivés, puis désactive les permissions générales automatiques. Le hook reste un filtre de noms ; il ne remplace pas la demande native MCP, qui porte l’information de lecture seule.

Les configurations MCP et hooks personnels du CLI ne sont pas importés automatiquement. L’exécution conserve le répertoire Copilot isolé et le catalogue vérifié. Une permission MCP ou une question met également le pilote en pause pour la suite du parcours ; l’appel courant peut continuer après ta réponse.

## Preuve de compatibilité locale

Le 13 octobre 2026, le SDK **1.0.20** et le CLI **1.0.63** ont découvert un serveur MCP de fixture exposant `read_story` et `write_story`. Une session restreinte à `read_story` a ensuite exposé les quatre outils hôtes attendus et `fixture-read_story`, avec provenance `fixture/read_story`. Cette première preuve est conservée dans [mcp-smoke.json](mcp-smoke.json).

Le contrôle de permissions final exige aussi `session.managedSettings.get`, absent de **1.0.63**. L’adaptateur actuel refuse donc une exécution MCP sur ce CLI **avant tout prompt**, comme le montre `latestAdapterPreflight`. La découverte et les sessions utilisant seulement les outils hôtes restent disponibles. Mets Copilot CLI à jour manuellement vers une version compatible avec le SDK 1.0.20 ; le diagnostic du catalogue et de la politique demeure obligatoire, quelle que soit sa version.

Le **runtime 1.0.96 embarqué dans le package SDK**, testé séparément via son wrapper de développement, accepte cette politique. [mcp-smoke-bundled.json](mcp-smoke-bundled.json) conserve sept invocations réelles du pipeline natif : lecture automatique ; lecture soumise à un refus puis à une approbation humaine ; écriture refusée en lecture seule ; écriture refusée puis approuvée en profil écriture ; outil sans annotation de lecture refusé en lecture seule. Chaque demande humaine apparaît une fois, avec un résultat natif conforme. L’outil d’écriture est une fixture et ne modifie aucun fichier.

Ces contrôles interceptent `send` et emploient la RPC d’invocation d’outil : **zéro prompt et zéro événement d’usage modèle**. Ils ne prouvent pas une réponse modèle exploitant Azure DevOps ni le comportement d’une distribution CLI classique 1.0.96. Le wrapper SDK n’est pas inclus dans le VSIX et aucun CLI utilisateur n’a été mis à jour pendant la recette.

Le CLI 1.0.63 exige une initialisation des outils avant les RPC MCP, la configuration explicite dans `startServer`, et l’alias `serveur/outil` dans `customAgents.tools` alors que le catalogue global utilise `serveur-outil`. L’adaptateur gère ces noms exacts et vérifie la provenance réelle, sans autoriser de famille d’outils par joker.

Pour reproduire le diagnostic sur le CLI configuré : `npm run smoke:mcp`. Sur macOS arm64, le runtime de développement peut être vérifié séparément avec :

```bash
FEATURE_STUDIO_MCP_CLI_PATH="$PWD/node_modules/@github/copilot-sdk-darwin-arm64/prebuilds/darwin-arm64/copilot-runtime" npm run smoke:mcp
```

Le script met à jour le fichier de preuve correspondant. Sur un ancien CLI incompatible, il échoue avant d’appeler un modèle ; conserve cette distinction dans un rapport de validation.
