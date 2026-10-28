# Quatre lots : vitesse, ergonomie et livraison — 1.32.0

Ces changements prolongent la consolidation locale et conservent les correctifs publiés jusqu’à 1.31.1. Ils couvrent les quatre lots décidés après l’audit du 28 octobre 2026.

## 1. Démarrer sans friction

La création mémorise le dernier parcours choisi. Sans préférence valable, elle propose l’évolution lorsqu’elle existe, sinon la composition libre. Le guide de première session et le retour d’erreur conservent les informations saisies.

Le lancement expose les capacités effectives du profil et du contexte : lectures, édition, terminal, navigation et sélection des outils externes. Les restrictions d’un échange de cadrage restent visibles. Le diagnostic Applications vérifie le projet, l’adresse et la compatibilité du propriétaire, et distingue ces vérifications de configuration des contrôles réseau/navigateur encore nécessaires. La confirmation des interactions décrit son périmètre réel. Les URL HTTP/HTTPS complètes et les origines autorisées de 1.31.1 restent prises en charge.

L’aperçu du contexte se met à jour après 450 ms sans nouvelle saisie. Une réponse ou une erreur correspondant à une ancienne demande est ignorée. Le lancement reste conditionné à un aperçu courant et au contrôle de fraîcheur du host ; aucune permission n’est ajoutée implicitement.

## 2. Travailler sans chercher

L’étape sélectionnée et son action précèdent Git, budget, pilote et équipe, regroupés dans des panneaux repliables. Les décisions obligatoires et les liens ticket/PR restent accessibles. Les titres ouvrent directement les sessions ; les cases servent à la sélection multiple, conservée entre les pages.

Le rendu est limité à 50 sessions ou discussions par page, 40 messages de discussion et 100 événements de conversation de session. Les filtres continuent de porter sur l’ensemble des données. La pagination ne supprime aucun historique.

Discussion rappelle son absence d’accès aux fichiers et outils. Les images actives sont sélectionnables, avec quatre images au maximum par requête et conservation des originaux dans l’archive. Les grandes conversations utilisent une fenêtre récente déterministe ; les exclusions, la troncature et la taille envoyée sont indiquées. Il ne s’agit pas d’un résumé IA et la fenêtre ne garantit pas le rappel de toutes les décisions anciennes. La préparation d’une session reste disponible pour passer au travail sur le projet.

## 3. Rester rapide avec l’historique

Les écrans secondaires sont importés lors de leur première ouverture. Discussion reste ensuite montée pour préserver la saisie lors d’un changement de page. Un état de chargement et une erreur récupérable remplacent un écran vide. Le runtime Zod du webview désactive la compilation dynamique pour respecter la politique qui interdit `eval`.

Le host envoie d’abord un état complet, puis seulement les champs et sessions modifiés, suppressions et changements d’ordre. Chaque surface a une référence indépendante avec identifiant de flux et révision. Une interruption, un message rejoué ou une rupture de séquence déclenche une resynchronisation ; les abonnés continuent de recevoir un état cohérent. Les références des sessions inchangées sont conservées côté React.

Mesure locale synthétique, Node 24.1.0, 30 mises à jour mesurées après échauffement. Chaque reconstruction est comparée à l’état complet :

| Sessions | État complet | Mise à jour d’une session | Réduction des octets | Encodage médian | Décodage médian |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 269 868 octets | 4 651 octets | 98,28 % | 0,51 ms | 0,02 ms |
| 1 000 | 2 631 468 octets | 4 651 octets | 99,82 % | 5,06 ms | 0,21 ms |

L’entrée JavaScript passe d’environ 1,15 Mo avant ce lot à 366 ko ; la feuille initiale passe d’environ 295 ko à 143 ko. Les autres morceaux sont chargés selon les écrans ouverts. Ce sont des tailles minifiées non compressées, pas une mesure de latence utilisateur.

Reproduction : `npm run build`, puis `npm run benchmark:transfer`. `npm run benchmark:state` conserve la mesure distincte d’assemblage multi-projets de la consolidation. Les temps varient selon le poste et ne constituent pas un seuil CI.

Limites : l’état initial et les archives restent complets en mémoire ; le chargement disque des projets n’est pas devenu paresseux. Une session modifiée est transmise entière, y compris son historique. Les gains annoncés portent sur les octets et le rendu borné, sans promettre une accélération du modèle ni une latence identique sous Windows.

## 4. Finir sans ressaisir

Le centre de validation réunit résultat, critères déclarés, blocages du moteur, tests attestés et accès aux changements. Les déclarations d’un agent ne sont pas présentées comme une preuve de test. La décision reste liée à la bonne étape et aux contrôles de révision du host.

Livraison prépare localement un brouillon de PR depuis la session, ses critères et ses preuves. Le titre de commit et le titre de PR sont distincts. Les brouillons sont isolés par projet et dépôt, conservés après erreur et rechargement. Un changement de session actualise un brouillon généré intact ; les retouches humaines sont conservées. Un avertissement apparaît si le texte référence encore une autre session connue.

Le diff de PR compare les commits avec la cible et exclut les changements non commités. Si l’historique cible manque localement, cette limite est affichée. Après la confirmation, les SHA de source et de cible sont revérifiés avant publication. Une cible qui avance impose un nouvel aperçu. Les tickets déjà liés peuvent être retrouvés après réouverture sans accepter une association forgée.

## Qualification

Les tests couvrent notamment les réponses d’aperçu périmées, les pages de 1 000 sessions/messages, les images reçues pendant un changement d’écran, la conservation des archives, la reconstruction des différences, la relecture de la cible de PR et la reprise après erreur. Le test `ui-built-performance.spec.ts` sert le vrai bundle avec une politique de contenu restrictive et contrôle les imports différés, les mises à jour et les écrans en 720 px et 390 px.

Les résultats finaux et les limites de plateforme sont consignés dans [VALIDATION.md](VALIDATION.md). Les tests de compte Azure DevOps et de modèle utilisent des simulations ; une recette réelle sur le compte et la qualité des réponses restent distinctes.
