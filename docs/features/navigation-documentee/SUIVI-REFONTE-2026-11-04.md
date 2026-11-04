# Refonte de la navigation — suivi du 4 novembre 2026

Périmètre demandé : les dix améliorations A1–A10 et les évolutions E1, E2, E3,
E4, E5, E6, E8 et E10 de la proposition discutée avec Matt. E7 (export de tests)
et E9 (campagnes multi-contextes) restent hors de ce lot.

Les modifications locales v1.32.1 présentes au début du travail sont conservées et intégrées à la 1.37.0. La base a été réintégrée sur la 1.36.1 publiée, sans retirer Relecture ni les correctifs MCP.
La livraison comprend validation locale, push, CI GitHub, publication et contrôle
de l'archive publiée. Aucun succès distant n'est déduit d'un contrôle local.

## Critères de livraison

- [x] A1 Import Edge/Chrome : interactions usuelles, double-clic réel, diagnostic complet.
- [x] A2 Correction depuis un parcours et contexte réutilisé entre étapes.
- [x] A3 Applications : actions quotidiennes, récents/favoris, détails secondaires.
- [x] A4 Préparation : navigateur, application, connexion et droits effectifs.
- [x] A5 Paramètres lisibles, réutilisables dans cibles, URL et conditions.
- [x] A6 Attentes bornées, sans répéter les interactions produites.
- [x] A7 Diagnostic contextualisé et réparation depuis l'étape en échec.
- [x] A8 Publication disponible pendant la correction d'un brouillon.
- [x] A9 Finalisation guidée après import/démonstration.
- [x] A10 Comparaison de preuves rattachées au même cas.
- [x] E1 Résolution de données métier observables et conservation du cas choisi.
- [x] E2 Association au code travaillé et vérification de la version servie.
- [x] E3 Atteindre depuis l'état courant ; reproduction stricte séparée.
- [x] E4 Blocs réutilisables et dépendances versionnées.
- [x] E5 Relais Navigateur et reprise explicite de la correction.
- [x] E6 Correction depuis l'écran courant avec dossier de reproduction.
- [x] E8 Mémoire des liens écran-code, avec vérification de fraîcheur.
- [x] E10 Détection des parcours à revérifier après changements.

## Validation et livraison

Contrôles locaux au 4 novembre 2026 :

- Suite complète : 1 169 tests réussis, 11 tests optionnels désactivés (103 fichiers, dont 7 suites conditionnelles). Aucun appel fournisseur payant.
- Navigation et stockage : 197 contrôles ciblés réussis, incluant Chromium réel, double-clic, attente différée, résolution garage/voiture, blocs figés, publications conservées, relais/reprise, preuves et comparaison d’environnement.
- Interface : 347 scénarios couverts par la suite générale et les reprises ciblées ; les échecs initiaux de rangement du diagnostic, double panneau d’évaluation, ancien bundle et libellé de test ont été corrigés. Le scénario UI → service → navigateur → publication → rechargement est réussi. La capture de l’écran a été inspectée visuellement.
- TypeScript, format et construction réussis. VSIX 1.37.0 vérifié (manifestes, 319 fichiers construits, assets), extrait puis chargé dans un vrai hôte VS Code isolé : import, édition, rejeu, capture, publication et réouverture réussis.
- Le stockage v16 conserve les sessions migrées depuis les versions précédentes. L’ancienne version de l’extension ne doit pas réenregistrer le nouveau format.

La CI et la publication sont suivies séparément : la livraison se fait depuis `main` après réussite des jobs Linux et Windows, puis contrôle du VSIX publié et de son empreinte. Les notes de la [release 1.37.0](https://github.com/MattDevBzh/KerAI/releases/tag/v1.37.0) contiennent le commit et le lien de cette CI.

### Limites explicites

- Connexion manuelle ; pas d’accès automatique aux mots de passe ni au profil personnel du navigateur.
- Import d’un sous-ensemble documenté de Recorder. Les actions inconnues restent signalées ensemble ; aucun script arbitraire n’est exécuté.
- Sélection métier fondée sur des critères DOM explicites et des données existantes. Elle conserve les identifiants, ne crée pas de jeu de données et refuse un cas disparu.
- Vérification d’environnement limitée à la ressource comparée ; ni tout le serveur ni la base ne sont certifiés par son empreinte.
- Le relais automatique prépare la mission du Navigateur. Son lancement et la nouvelle tentative de correction restent visibles dans le cockpit.
- Les liens écran-code exigent une confirmation ; les dépendances sont signalées, jamais mises à jour silencieusement.
- Applications synthétiques pour les tests ; la connexion et les règles du poste de Matt restent à exercer sur son application. Aucun gain de temps ou de crédits réel n’est déduit des fixtures.
