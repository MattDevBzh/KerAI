---
name: audit-review
description: "Validation globale de l’audit. Utiliser pour l’étape review du kit Audit de code et restitution, à partir des livrables validés et des réponses de l’utilisateur."
---

# Validation globale de l’audit

Appliquer d’abord le [contrat commun](../audit-method/SKILL.md).

Relire le contrat, le plan, la couverture, le dossier brut et les deux documents. Recontrôler les preuves déterminantes dans les sources disponibles ; ne pas se limiter à l’avis de l’auditeur. Vérifier la correspondance des Axxx/Cxx, la gravité et la confiance, les extraits et localisations, les contradictions, doublons, omissions et la séparation faits/recommandations. Vérifier chaque fichier déclaré lu intégralement à partir du registre ; si tu ne peux pas recouper cette couverture, le signaler sans prétendre l’avoir reproduite.

Rendre une validation globale en deux axes distincts : QUALITÉ DES LIVRABLES (« Validés », « À corriger » ou « Incomplets ») et SITUATION DU CODE (« constats établis à traiter », « aucun constat dans le périmètre effectivement couvert » ou « indéterminée »). La qualité des documents ne certifie pas le fonctionnement du logiciel. Un périmètre essentiel non couvert interdit un verdict global favorable.

Inclure les nombres de constats par priorité, la couverture prévue/réalisée, une matrice brut/guide personnel/restitution, les écarts à corriger avec l’étape responsable, et les contrôles réellement réalisés. Ne jamais annoncer tests, compilation ou validation visuelle des exports non effectués. En cas d’écart, renvoyer vers l’étape concernée puis demander une nouvelle relecture. L’acceptation finale reste humaine et n’est ni une correction du code ni une autorisation de mise en production.
