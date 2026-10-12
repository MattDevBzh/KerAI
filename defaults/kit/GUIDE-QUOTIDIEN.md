# Utiliser le kit au quotidien

Choisir l'agent puis vérifier le modèle avant d'invoquer le skill dans le chat.
Les noms des skills sont des commandes slash, pas des noms de modèles. Changer d'agent ne
change pas automatiquement le modèle tant que son champ model n'a pas été configuré.

| Étape | Agent conseillé | Modèle conseillé | Exemple à envoyer |
| --- | --- | --- | --- |
| Clarifier | ai-cadrage | Sol | `/ai-ticket Voici l'US…` |
| Planifier | ai-cadrage | Sol | `/ai-plan Utilise le ticket clarifié. Plan court et tests attendus.` |
| Développer | ai-dev | Luna, Sol si nécessaire | `/ai-implement Réalise la tranche 1 du contexte joint.` |
| Écrire les TU | ai-tests | Luna | `/ai-tdd Couvre AC1 et AC2, selon les tests voisins.` |
| Lancer les TU | Tâche locale / terminal utilisateur | Aucune IA | Commandes ci-dessous. |
| Lire les résultats | ai-tests | Luna | `/ai-verifier Voici le summary.md du run qui vient de finir.` |
| Comprendre un échec | ai-cadrage ou ai-dev | Sol si difficile | `/ai-debug Voici le symptôme, le résumé du run et les essais déjà faits.` |
| Corriger | ai-dev | Luna ou Sol | `/ai-implement Corrige la cause établie ; conserve les assertions métier.` |
| Relire | ai-revue, nouvelle session | Sol | `/ai-relecture Voici le ticket, le snapshot et les preuves.` |

Une correction évidente peut commencer directement par Dev. Un ticket clarifié peut passer
directement au plan. Les noms de modèles restent à vérifier dans ton sélecteur : le kit
n'impose pas d'identifiant ni d'effort High.

## Lancer les commandes depuis la racine du dépôt

Windows (remplacer `py -3` par `python3` sur Linux/macOS) :

```powershell
py -3 scripts/ai_tools.py test --profile unit-cible --dry-run
py -3 scripts/ai_tools.py test --profile unit-cible
py -3 scripts/ai_tools.py test --profile unit-module
py -3 scripts/ai_tools.py snapshot --path src/MonModule --path tests/MonModule
```

Les deux profils sont des exemples à configurer. Lancer le profil module après les tests
ciblés si le risque le justifie. Le wrapper VSTest effectue un build sans restore implicite.
Le restore préalable suit la procédure habituelle de l'équipe. Un lancement de TU exécute
du code du dépôt ; le wrapper n'est pas un bac à sable.

Pour relire une branche avec une base locale à jour :

```powershell
py -3 scripts/ai_tools.py snapshot --base origin/main --merge-base --path src --path tests
```

Aucun fetch n'est exécuté. Le snapshot décrit l'état final sur disque, y compris les nouveaux
fichiers non ignorés, pas seulement le staging. Inclure aussi les chemins de configurations
ou migrations concernés. Lire exclusions et troncatures avant de le transmettre.
Le filtre de noms sensibles n'est pas un détecteur de secrets.

## Boucle TDD réelle

Demander le test → lancer le test ciblé → vérifier un échec lié au bug → demander le correctif
→ relancer le même test → élargir la validation si nécessaire. Sans run avant correctif,
parler de test de régression écrit, pas de cycle rouge/vert prouvé.
Les agents n'ont pas de terminal : les commandes sont exécutées par toi ou par les tâches
VS Code optionnelles. Ne pas ajouter le terminal à Revue pour rendre la boucle automatique.

## Économiser le contexte

- Conserver les décisions et le prochain travail dans templates/context.md, puis enregistrer
  le résultat dans .ai/work/ID/context.md. Les agents en lecture seule le rendent dans le chat.
- Transmettre critères, fichiers utiles et résumé du run ; ouvrir le log complet si nécessaire.
- Charger la procédure demandée, pas les sept skills. Ne pas refaire un plan après chaque TU rouge.
- Après deux corrections échouées, revenir au diagnostic avec les preuves et envisager Sol.
- Tenir compte du coût du ticket accepté et du temps de reprise ; aucun gain chiffré n'est garanti.

## Ta relecture actuelle

Renseigner les deux chemins dans .ai/project.md. Le rapport est rendu dans le chat au format
de ton template, prêt à enregistrer manuellement. Le kit n'a pas reçu le contenu de ton skill :
il ne le remplace pas et n'en certifie pas les consignes. La revue reste statique.
