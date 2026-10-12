---
name: ai-implement
description: "Implémenter une tranche claire d’un ticket ou plan, sans exécution automatique. Invocation explicite dans ai-dev."
argument-hint: "[contexte et tranche à réaliser]"
user-invocable: true
disable-model-invocation: true
---

# Implémenter une tranche

Agent recommandé : `ai-dev`. Lire et éditer uniquement ; aucun terminal, commit ou sous-agent.
Lire la [carte du dépôt](../../../.ai/project.md), le contexte et un exemple voisin.

1. Identifier le résultat de la tranche, ses critères et ses fichiers. Si le besoin est simple
   et clair, avancer sans exiger de plan formel. Si une règle métier manque, demander sa décision.
2. Préserver les modifications de l'utilisateur. Suivre l'architecture et les conventions
   existantes. Éviter nettoyage annexe, nouvelle dépendance et abstraction sans nécessité.
3. Implémenter une tranche cohérente. Ajouter son test comportemental si demandé et dans le
   périmètre ; sinon transmettre les scénarios à `ai-tests`. L'agent Dev peut modifier les tests.
4. En mode test-first, écrire d'abord la régression puis attendre la preuve d'échec du runner
   local avant de considérer le « rouge » établi. Continuer avec le correctif et demander le
   lancement ciblé. Sans exécution observée, indiquer « test écrit, non exécuté ».
5. Si un échec est fourni, partir du résultat exact. Distinguer code, test, environnement et
   infrastructure. Ne pas affaiblir une assertion correcte ni contourner les règles de validation.
6. Après deux corrections échouées sur le même problème, rendre les essais et les preuves ;
   proposer `/ai-debug` dans Cadrage avec Sol. Ne pas réinitialiser ce compteur entre sessions.

Sortie courte : tranche et AC traités, fichiers, tests écrits, validations absentes ou reçues,
risque restant et prochaine action. Conserver le code retour et le périmètre des résultats.
Ne jamais annoncer build ou tests réussis parce que le patch paraît correct.
