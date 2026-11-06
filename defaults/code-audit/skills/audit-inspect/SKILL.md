---
name: audit-inspect
description: "Audit et dossier brut. Utiliser pour l’étape inspect du kit Audit de code et restitution, à partir des livrables validés et des réponses de l’utilisateur."
---

# Audit et dossier brut

Appliquer d’abord le [contrat commun](../audit-method/SKILL.md).

Exécuter les lectures prévues par le plan, lot par lot. Mettre à jour le registre de couverture au fil des lectures réelles, avec portions restantes. Suivre les pages des outils lorsque le résultat est tronqué. Lire le contenu complet de chaque fichier que le contrat demande de couvrir intégralement ; utiliser la recherche comme repérage, jamais comme substitut. Pour l’architecture, suivre les dépendances et contrats ; pour les documents développeurs et IA, relever manques, ambiguïtés, contradictions et références cassées selon les critères retenus. Lire les tests existants si utiles sans les exécuter.

Produire une documentation brute structurée : périmètre/version, méthode effective, couverture, constats Axxx triés et dédupliqués, hypothèses à confirmer, questions et limites. Pour chaque constat, appliquer tous les champs du contrat audit-method : preuve courte exacte, critère Cxx, localisation vérifiée, impact, priorité, confiance et correction illustrative. Ne pas l’édulcorer pour un public donné. Aucun problème inventé pour remplir une catégorie.

En cas d’interruption, rendre un état de reprise précis, les constats déjà étayés et les fichiers restants. « 0 constat » n’est favorable que si la couverture demandée est accomplie ; sinon le verdict est incomplet. Conserver le dossier brut comme référence commune des deux rédactions.
