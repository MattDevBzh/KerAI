# Créer et partager des kits

Un kit rassemble des parcours, des agents, des skills et leurs ressources. L’écran **Kits** sert à installer une équipe fournie, importer un fichier local ou composer sa propre sélection. Ces opérations ne lancent ni agent ni script.

## Les deux kits fournis

| Kit | Parcours | Agents | Skills |
| --- | --- | --- | --- |
| Atelier Copilot | Feature complète, relecture, session libre, recette visuelle | Neuf profils Feature Studio et quatre profils du kit original | Sept méthodes du kit Copilot 2.0.0 |
| DevOps | Challenge → plan → modifications → relecture → guide → vérification | Six spécialistes avec avatars distincts | Huit méthodes, dont Azure DevOps et l’adaptation de Microsoft azure-validate |

Les profils embarqués sont disponibles dès l’installation de l’extension. **Voir le kit → Installer ce kit** les rend aussi accessibles dans le catalogue utilisateur Copilot. Les profils déjà personnalisés dans un projet ou dans le catalogue personnel gardent leur priorité. Une session existante conserve la définition de son parcours.

## Composer un kit

1. Clique **Créer un kit**. La recherche et les filtres Parcours / Agents / Skills explorent les profils actifs de ton projet.
2. Coche les éléments à emporter. Un parcours ajoute ses agents et ses skills ; un agent ajoute ses skills ; les liens Markdown locaux vers d’autres skills sont aussi suivis. Une dépendance partagée n’apparaît qu’une fois.
3. Les cases ajoutées automatiquement indiquent **Requis par…**. Retire le choix d’origine pour les libérer ; elles restent incluses si un autre élément en dépend. Le panier récapitule tes choix directs et les dépendances.
4. Donne au kit un nom, un identifiant, une version et une description. Clique **Préparer l’export**.
5. Consulte les instructions, les outils déclarés et **Voir tous les fichiers**. Le kit contient les dossiers complets des skills, avec scripts, références et licences. Les ressources partagées du kit Copilot sont emportées dans leur version disponible.
6. Clique **Exporter le fichier**, puis choisis la destination dans la boîte de dialogue VS Code. Une copie reste accessible dans **Mes kits enregistrés**. Des révisions différentes portant le même identifiant sont conservées séparément.

L’export ne modifie pas les profils source. Il retire les chemins d’origine des workflows et leurs associations à des serveurs MCP locaux. Les commandes de tests, hooks, secrets stockés dans VS Code et autres réglages de machine ne sont pas exportés. Un lien local vers un fichier absent bloque l’export avec son chemin : place la ressource dans le dossier de la skill ou ajoute le profil correspondant. Les références mentionnées seulement en prose ou dans du code ne constituent pas un format de dépendance automatique.

## Importer et installer

**Importer un fichier** ouvre un fichier `.fskit.json` local. L’aperçu indique les éléments sélectionnés, leurs dépendances, les fichiers et leur état à destination : **nouveau**, **identique** ou **conflit**.

L’installation cible `~/.copilot`, `%USERPROFILE%\.copilot` sous Windows, ou `COPILOT_HOME` si VS Code a été lancé avec cette variable :

| Contenu | Chemin relatif |
| --- | --- |
| Agents | `agents/<id>.agent.md` |
| Skills et ressources propres | `skills/<id>/…` |
| Parcours | `feature-studio/workflows/<id>.yaml` |
| Ressources communes du kit d’origine | `feature-studio/kit/…` |
| Copies des kits personnels | `feature-studio/kits/*.fskit.json` |

Un conflit bloque l’installation entière ; aucun fichier différent n’est écrasé. Les fichiers identiques sont conservés. Le host revérifie la destination à l’installation et les contenus après copie. En cas d’échec, il retire les nouveaux fichiers dont les octets correspondent encore à sa copie. Les fichiers édités entre-temps restent préservés. Les autres fenêtres doivent actualiser leur catalogue pour voir les nouveaux profils.

L’aperçu conserve le contenu exact de l’import ou de la composition ; l’installation ne relit pas silencieusement un autre fichier. Il garde jusqu’à huit aperçus par instance du service : si un aperçu a expiré, prépare-le à nouveau. Un fichier invalide dans les kits enregistrés est signalé **À réparer**, sans rendre les deux kits fournis indisponibles.

## Format et limites

Le document JSON contient `format: "feature-studio-kit"`, `schemaVersion: 1`, des métadonnées (`id`, `name`, `description`, `version`), les références choisies dans `roots` et un tableau `files` de chemins relatifs, contenus Base64 et empreintes SHA-256. Une référence est de la forme `workflow:devops`, `agent:fs-devops-plan` ou `skill:devops-inspect`.

Le host valide la structure, les profils, les dépendances, les liens locaux et les empreintes. Il refuse les chemins sortants, alias de chemins, destinations sensibles, collisions de fichiers/dossiers, liens symboliques et configurations MCP actives. Les limites sont de **512 fichiers**, **4 Mio par fichier**, **16 Mio décodés** et **24 Mio de JSON**. Le catalogue lit jusqu’à cent fichiers personnels.

Les empreintes vérifient l’intégrité du fichier, pas l’identité de son auteur. Quelques formats de secrets connus sont refusés ; ce contrôle n’est pas exhaustif. Relis les instructions et scripts d’un kit reçu avant d’autoriser leur utilisation. L’installation copie des ressources : elle ne les exécute pas et n’active aucune connexion.

Les avatars sont des identifiants intégrés à Feature Studio v1 ; le format ne transporte pas de nouveaux avatars arbitraires. Le format portable ne remplace pas le manifeste historique du kit Copilot. La commande historique d’installation reste disponible pour compatibilité ; l’écran Kits permet de choisir séparément les deux équipes.
