# Présenter un document et auditer du code

Deux kits sont disponibles dans **Atelier → Kits** : **Présentation et préparation** et **Audit de code et restitution**. Tu peux consulter leurs agents et leurs compétences, les installer ou exporter le kit. L’installation écrit dans tes fichiers utilisateur, pas dans le dépôt ; un fichier personnel différent provoque un conflit à résoudre, sans écrasement automatique.

Dans **Nouvelle session**, choisis **Préparer une présentation** ou **Auditer un projet**. Sélectionner un parcours ne lance aucun agent. Les agents reprennent leurs paramètres de base ; l’équipe peut surcharger le modèle et le niveau de réflexion. Les profils livrés travaillent en lecture seule, sans terminal, modification de code, compilation ni tests. Le lancement et la validation des étapes restent humains, y compris en autopilot.

## Présentation et préparation

Le niveau du présentateur et celui de son public sont deux informations distinctes. Le présentateur peut avoir besoin d’un cours détaillé même si son auditoire attend une synthèse très courte.

| Étape | Résultat |
| --- | --- |
| Cadrage | Questions sur l’objectif, le public, ton propre niveau, la durée, les sources, les formats et les contraintes. |
| Analyse et trame sourcée | Registre de faits, limites des sources, déroulé des diapositives, références et répartition du temps. |
| Support pour l’auditoire | Diapositives concises adaptées au public ; livrable exportable en PowerPoint. |
| Guide personnel du présentateur | Explication du document initial, notions à comprendre, préparation de chaque diapositive, transitions, questions probables et répétition. |
| Validation globale | Contrôle de fidélité aux sources, cohérence entre support et guide, adéquation aux deux profils et écarts restant à traiter. |

Exemple de départ : « Je dois expliquer ce contrat d’API à des chefs de projet pendant 20 minutes. Je découvre le sujet. Je veux un PowerPoint et un guide Word. » Les agents demandent les précisions manquantes par petits lots et réutilisent tes réponses.

Le support et le guide restent deux livrables séparés. Exporte le résultat de l’étape **Support** en PowerPoint, puis celui de **Guide personnel** en Word, PDF ou dans un autre format. Le rapport final de validation ne remplace aucun des deux.

## Importer le document source

Dans la création de session ou dans la fenêtre de contexte d’un lancement, clique sur **Importer un document**. Choisis un fichier, ouvre **Vérifier le texte extrait**, puis clique sur **Ajouter le texte au contexte**. L’ajout conserve le contexte déjà saisi ; annuler l’import le laisse intact. L’extraction se fait localement, sans appel IA. Le texte ajouté est enregistré avec le contexte et transmis quand tu lances l’agent.

| Format | Contenu extrait et limites |
| --- | --- |
| TXT, Markdown | Texte UTF-8. |
| PDF | Texte avec repères de pages. Les images, graphiques et la disposition des colonnes ne sont pas interprétés. Un scan sans texte nécessite une version OCR ou une transcription. |
| Word DOCX | Paragraphes du corps et notes. Images, commentaires, en-têtes, pieds de page et mise en forme ne sont pas analysés ; vérifier les tableaux et révisions. Convertir les anciens `.doc` en `.docx`. |
| HTML | Texte du fichier, sans exécution des scripts ni chargement de ressources distantes. Le contenu chargé dynamiquement n’est pas acquis. |

L’aperçu affiche les limites connues. Le contexte conserve le nom du fichier, son empreinte SHA-256 et ces réserves. Un besoin reposant sur un schéma doit être complété par une transcription ou une capture via **Joindre une image**, avec un modèle visuel compatible.

Limites : 20 Mio par fichier, 480 000 caractères extraits, 500 pages PDF et 8 Mio de XML Word décompressé. Le contexte de création accepte 500 000 caractères, celui du lancement 60 000 (30 000 pour la création issue d’une discussion). Dépasser une limite refuse l’ajout ; aucun passage n’est tronqué silencieusement. Le budget de contexte du lancement continue de s’appliquer : préfère un extrait pertinent ou répartis un très gros document en plusieurs sessions.

## Audit de code et restitution

| Étape | Résultat |
| --- | --- |
| Cadrage | Directives reformulées, critères vérifiables, projets et révisions, exclusions, profils du demandeur et de l’auditoire, formats attendus. |
| Plan | Ordre des lectures et matrice reliant critères, fichiers, preuves et livrables. |
| Audit et dossier brut | Couverture réelle, constats sourcés, priorité, confiance, impact, pistes de correction et hypothèses encore ouvertes. |
| Explications pour le demandeur | Document pédagogique adapté à ton niveau, qui conserve les identifiants et les conclusions du dossier brut. |
| Restitution pour l’auditoire | Version adaptée à son niveau et à ses décisions ; toute sélection renvoie à la liste complète des constats. |
| Validation globale | Vérification croisée des documents et verdict séparé sur la qualité de la restitution et la situation du code. |

Exemple : « Audite la synchronisation ciblée dans ce projet : préservation des données des utilisateurs non concernés, traitement des erreurs et cohérence de la documentation. Je connais C# mais pas ce module. Mon public est composé de responsables produit. Je veux mon guide en Markdown et une synthèse PDF pour eux. »

Le dossier brut est la référence commune. Les adaptations changent les explications, pas les preuves, priorités ou réserves. Les constats portent des identifiants stables `A001…` et les critères `C01…`. Les fichiers sont marqués comme lus intégralement, partiellement lus, non lus ou hors périmètre justifié. Un audit partiel est annoncé comme tel ; zéro constat sans couverture ne vaut pas validation du code.

Pour une comparaison Git, indique la base exacte ou réponds à la question de l’agent. Aucun choix de branche n’est supposé. Les tests existants peuvent être lus ; le parcours ne les exécute pas. La dernière étape peut conclure que les documents sont fidèles tout en signalant des corrections nécessaires dans le code. Elle ne remplace ni ton acceptation finale ni une validation d’exécution.

## Télécharger les livrables

Chaque résultat d’étape propose **Markdown, Word, PowerPoint, HTML, PDF et Texte**. Tu peux télécharger un même résultat dans plusieurs formats, sans relancer le modèle. Les deux documents adaptés sont disponibles dans leurs étapes respectives.

Les exports conservent le texte et les références. PDF produit des pages A4 numérotées avec polices embarquées ; les symboles absents de la police sont représentés par leur code Unicode, avec une note. Texte enlève la syntaxe Markdown. HTML est autonome et sans script. Les images et diagrammes restent des références textuelles ou du code ; ces exports ne dessinent pas de nouveaux visuels.

Limites d’export : 2 Mo de texte, 200 diapositives ou 500 pages PDF. Le contrôle éditorial des agents ne constitue pas une inspection visuelle du fichier final : ouvre le document exporté avant diffusion.
