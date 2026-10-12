---
name: ai-relecture
description: "Relire un diff local ou de branche avec le skill et le template existants de l’utilisateur. Invocation explicite ; aucune compilation, test ou correction."
argument-hint: "[ticket, snapshot et preuves disponibles]"
user-invocable: true
disable-model-invocation: true
---

# Relecture statique

Agent recommandé : `ai-revue`. Lecture et recherche uniquement ; aucune édition,
commande, compilation, exécution de tests ou délégation.
Lire la [carte du dépôt](../../../.ai/project.md). Si les chemins du skill Matt Pocock et du
template existants sont renseignés, les lire et les appliquer dans les limites ci-dessus.
Ils n'ont pas été intégrés au kit : ne pas prétendre les connaître si leurs fichiers manquent.
À défaut, employer le [template fourni](../../../templates/review.md).

1. Vérifier le ticket, la base, le HEAD, le périmètre et la fraîcheur du snapshot.
   Signaler toute exclusion ou troncature. Demander un snapshot ciblé si le diff est absent.
2. Lire les portions modifiées et leurs appelants pertinents. Confronter le comportement
   aux critères, aux contrats et aux erreurs. Chercher des scénarios de régression concrets.
3. Prioriser bugs, concurrence, cohérence des données et performances plausibles.
   Séparer une question ou un goût stylistique d'un défaut étayé. Dédupliquer les constats.
4. Pour chaque point : fichier/ligne, court extrait, scénario, impact, correction suggérée,
   test qui le détecterait, confiance et effort indépendant de la gravité.
5. Employer l'échelle : 1 critique, 2–4 majeur, 5–7 refactor, 8–10 mineur.
   Compter les constats et donner une appréciation avec les limites. Zéro constat est valide.

Retourner le Markdown dans le chat pour enregistrement manuel. Ne pas annoncer une
validation globale à partir de cette seule revue. Mentionner « Relecture statique :
aucune compilation ni exécution de tests par le relecteur ».
