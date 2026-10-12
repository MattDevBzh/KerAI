---
name: ai-verifier
description: "Lire les preuves de validation d’une tranche et rendre un verdict limité à leur périmètre. Invocation explicite ; aucune nouvelle exécution."
argument-hint: "[chemin du summary.md récent et critères]"
user-invocable: true
disable-model-invocation: true
---

# Vérifier les preuves

Agent recommandé : `ai-tests`. Lecture seule pour cette procédure ; ne pas lancer ou relancer
une commande, ni demander plus de permissions. Le runner local produit les preuves.

1. Lire le résumé explicitement fourni, puis `result.json` ou l'extrait de log utile si nécessaire.
   Vérifier commande, profil, date, HEAD, code retour, nombre de tests exécutés et échecs.
2. Vérifier que le projet, le filtre et les tests couvrent la tranche. Un code retour nul
   sans test exécuté, avec TRX manquant ou résultat incomplet n'établit pas une réussite.
3. Comparer la preuve à l'état courant quand les outils de lecture le permettent. Le même
   HEAD ne prouve pas le même worktree. Toute édition pertinente après le run exige une
   nouvelle preuve ; si la fraîcheur est inconnue, l'indiquer sans certifier l'état courant.
4. Mettre en regard critères, scénarios couverts et validations manquantes. Des TU verts
   ne prouvent ni tous les critères métier ni une intégration externe.
5. En cas d'échec, transmettre à Dev le test, l'erreur et le chemin du résultat complet.
   En cas d'information insuffisante, demander seulement la preuve manquante.

Rendre : « validé sur ce périmètre », « échec » ou « non établi », avec preuve, limites et
prochaine action. Maximum une dizaine de lignes hors matrice de critères.
Ce skill est distinct de la relecture statique et ne déclenche aucun build pendant une revue.
