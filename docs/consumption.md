# Consommation et validations

Le menu **Consommation** regroupe les tentatives de plusieurs sessions par modèle effectif, parcours et session. Les liens de session ouvrent son historique. Ce tableau utilise les mesures locales déjà reçues du SDK ; il ne déclenche aucun appel Copilot ou réseau et ne modifie aucun réglage.

Les filtres **Du / Au** portent sur `attempt.startedAt`, en jours UTC inclusifs. Sans filtre de date, toutes les tentatives admissibles sont incluses, même si leur date n’est pas exploitable. Une date inexploitable est signalée et exclue lorsqu’un filtre de date est actif. Les sessions archivées sont exclues par défaut, avec une case pour les inclure. Les filtres de parcours et de modèle s’appliquent à chaque tentative ; une sélection vide affiche « Aucune donnée ».

Le modèle effectif est `usage.model`, sinon le modèle enregistré dans `attempt.model`, sinon **Non communiqué**. Le modèle configuré dans l’étape, l’agent ou les réglages ne prouve pas quel modèle a été utilisé et n’alimente pas ces groupes.

Les tokens d’entrée et de sortie sont additionnés séparément. Le coût est additionné uniquement si son unité est exactement `nano-AIU`. Les autres unités sont signalées et exclues, sans conversion. Les données de source différente de `measured`, négatives ou non finies sont inconnues. Il n’y a ni prix supposé, ni conversion monétaire.

Une tentative stocke un instantané cumulatif d’usage : cet instantané est additionné **une seule fois**. Les événements de journal, les révisions du même livrable et les rafraîchissements du tableau ne créent pas une nouvelle consommation. Les règles d’agrégation sont celles de `usageTotals`, également utilisé par les budgets.

Pour chaque métrique, le tableau distingue les mesures complètes, partielles, inconnues et les zéros réellement mesurés. **Inconnu** apparaît lorsqu’aucune valeur n’a été reçue ; un zéro reçu reste **0**. Les valeurs disponibles d’une tentative marquée `incompleteTokens` ou `incompleteCost` sont incluses dans la somme observée, qui est explicitement partielle. Une valeur d’entrée connue n’implique pas que la sortie soit connue. La couverture des tokens complets exige les deux valeurs et l’absence de marqueur d’incomplétude.

Les validations sont actuelles : l’étape et sa dernière tentative doivent être `approved`. Leur auteur est distingué entre humain, pilote automatique et non communiqué pour les anciennes données. Une validation invalidée, par exemple après restauration ou nouvelle tentative, est comptée à part. Les tentatives échouées, annulées, interrompues et en cours sont affichées séparément ; les tentatives en attente de relecture restent dans le total.

La moyenne **tentatives jusqu’à validation** a pour dénominateur les étapes dont la dernière tentative actuellement validée appartient à la sélection. Son numérateur comprend toutes les tentatives de ces étapes jusqu’à cette validation, y compris les tentatives antérieures hors filtres ; ce nombre hors sélection est affiché. Une étape sans validation n’entre pas dans ce dénominateur. Cette mesure décrit l’historique observé ; elle ne classe pas les modèles et ne mesure pas leur qualité.


Les appels de l’Observateur possèdent un budget indépendant et ne sont pas des tentatives du parcours. Leur coût est présenté dans les rapports de la session : cette revue, toutes les revues et le total travail + revues. Les compteurs de validations et de tentatives de ce tableau restent ceux des étapes. [Observateur](OBSERVATEUR.md).
