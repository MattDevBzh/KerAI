/** Stable quest IDs and rewards are part of the local progression contract. */
export type QuestCategory =
  | 'Premiers pas'
  | 'Composition'
  | 'Collaboration'
  | 'Maîtrise'
  | 'Exploration';
export type QuestDestination =
  | 'dashboard'
  | 'agents'
  | 'skills'
  | 'workflows'
  | 'memory'
  | 'discussion'
  | 'settings'
  | 'kits';
export const QUEST_METRICS = [
  'featuresCreated',
  'featuresLaunched',
  'featuresCompleted',
  'stepsRun',
  'humanApprovals',
  'questionsAnswered',
  'reportsEdited',
  'reviewComments',
  'checkpoints',
  'agentsCreated',
  'teamsCreated',
  'skillsCreated',
  'workflowsCreated',
  'memoryEntries',
  'discussions',
  'observations',
  'relay',
  'isolated',
  'multiProject',
  'budget',
  'criteria',
  'context',
  'skillUse',
  'memoryUse',
  'readOnly',
  'testEvidence',
  'review',
  'correction',
  'export',
  'archive',
  'theme',
  'favorite',
  'kitExport',
  'kitImport',
  'modelOverride',
] as const;
export type QuestMetric = (typeof QUEST_METRICS)[number];
export interface QuestDefinition {
  id: string;
  title: string;
  description: string;
  help: string;
  category: QuestCategory;
  metric: QuestMetric;
  target: number;
  reward: number;
  destination: QuestDestination;
  previousId?: string;
  series?: string;
  tier?: number;
}
export interface QuestAward {
  at: string;
  reward: number;
}
export interface QuestState {
  counts: Partial<Record<QuestMetric, number>>;
  completed: Record<string, QuestAward>;
  trophies: number;
  error?: string;
}
export const emptyQuestState = (): QuestState => ({ counts: {}, completed: {}, trophies: 0 });
function series(
  metric: QuestMetric,
  category: QuestCategory,
  label: string,
  targets: number[],
  rewards: number[],
  titles: string[],
  action: (n: number) => string,
  help: string,
  destination: QuestDestination,
): QuestDefinition[] {
  return targets.map((target, index) => ({
    id: `${metric}-${target}`,
    metric,
    target,
    reward: rewards[index],
    title: titles[index],
    description: action(target),
    help,
    category,
    destination,
    series: label,
    tier: index + 1,
    ...(index ? { previousId: `${metric}-${targets[index - 1]}` } : {}),
  }));
}
function unique(
  metric: QuestMetric,
  title: string,
  description: string,
  help: string,
  reward: number,
  category: QuestCategory,
  destination: QuestDestination,
  target = 1,
): QuestDefinition {
  return {
    id: `${metric}-${target}`,
    metric,
    title,
    description,
    help,
    reward,
    category,
    destination,
    target,
  };
}
export const quests: readonly QuestDefinition[] = [
  ...series(
    'featuresCreated',
    'Premiers pas',
    'Semer des idées',
    [1, 3, 5, 10, 25],
    [1, 2, 3, 5, 8],
    [
      'La première graine',
      'Trois pistes',
      'Le carnet se remplit',
      'Dix idées au départ',
      'Un jardin de projets',
    ],
    (n) => `Créer ${n} session${n > 1 ? 's' : ''} de feature.`,
    'Dashboard → Nouvelle session. Donnez un besoin concret à votre équipe.',
    'dashboard',
  ),
  ...series(
    'featuresLaunched',
    'Premiers pas',
    'Passer à l’action',
    [1, 3, 5, 10, 25],
    [1, 2, 3, 5, 8],
    [
      'Moteur !',
      'Le trio de départ',
      'Cinq mises en route',
      'L’atelier tourne',
      'Capitaine au long cours',
    ],
    (n) => `Lancer un agent dans ${n} feature${n > 1 ? 's différentes' : ''}.`,
    'Dans une session, préparez le contexte puis lancez une intervention. Un simple aperçu ne compte pas.',
    'dashboard',
  ),
  ...series(
    'featuresCompleted',
    'Maîtrise',
    'Aller au bout',
    [1, 3, 5, 10, 20],
    [3, 4, 5, 7, 10],
    [
      'Premier ouvrage',
      'Trois livraisons',
      'Du début à la fin',
      'Dix boucles bouclées',
      'Maître de l’atelier',
    ],
    (n) => `Terminer ${n} feature${n > 1 ? 's' : ''} avec la validation finale.`,
    'Relisez les livrables, levez les blocages, puis confirmez la fin de la feature.',
    'dashboard',
  ),
  ...series(
    'stepsRun',
    'Premiers pas',
    'Faire travailler les agents',
    [1, 6, 15, 30, 60],
    [1, 2, 4, 6, 10],
    [
      'Un premier relais',
      'Six interventions',
      'Le rythme est trouvé',
      'Trente coups de main',
      'Une vraie troupe',
    ],
    (n) => `Obtenir ${n} intervention${n > 1 ? 's' : ''} terminée${n > 1 ? 's' : ''} avec succès.`,
    'Les interventions terminées à relire ou validées comptent. Les échecs et annulations ne comptent pas.',
    'dashboard',
  ),
  ...series(
    'humanApprovals',
    'Collaboration',
    'Garder la main',
    [1, 5, 10, 25, 50],
    [1, 2, 4, 6, 9],
    [
      'C’est validé',
      'Un œil attentif',
      'Dix décisions',
      'Le comité, c’est vous',
      'Cinquante feux verts',
    ],
    (n) => `Valider vous-même ${n} livrable${n > 1 ? 's' : ''}.`,
    'Ouvrez le rapport d’une intervention et validez-le après lecture. Les validations automatiques ne comptent pas.',
    'dashboard',
  ),
  ...series(
    'questionsAnswered',
    'Collaboration',
    'Éclairer les agents',
    [1, 3, 6, 12, 25],
    [1, 2, 3, 5, 8],
    [
      'Un peu de contexte',
      'Dialogue ouvert',
      'Six éclaircissements',
      'Le sens du détail',
      'Rien dans le flou',
    ],
    (n) => `Répondre à ${n} question${n > 1 ? 's' : ''} d’agent.`,
    'Répondez aux questions de cadrage dans une session : chaque question distincte compte une fois.',
    'dashboard',
  ),
  ...series(
    'reportsEdited',
    'Collaboration',
    'Mettre sa patte',
    [1, 3, 5, 10, 20],
    [2, 3, 4, 6, 8],
    [
      'Votre patte',
      'À quatre mains',
      'Cinq retouches utiles',
      'Éditeur en chef',
      'La plume du studio',
    ],
    (n) => `Modifier le contenu de ${n} rapport${n > 1 ? 's distincts' : ''}.`,
    'Utilisez Modifier sur un livrable, puis enregistrez votre version. Plusieurs éditions du même rapport comptent une fois.',
    'dashboard',
  ),
  ...series(
    'reviewComments',
    'Collaboration',
    'Faire des retours',
    [1, 3, 5, 10, 20],
    [1, 2, 3, 5, 7],
    [
      'Un retour précis',
      'Trois regards',
      'La revue avance',
      'Dix remarques utiles',
      'Le sens de la revue',
    ],
    (n) => `Ajouter ${n} commentaire${n > 1 ? 's' : ''} de revue.`,
    'Ajoutez un commentaire sur un rapport ou un fichier pour rendre votre retour exploitable.',
    'dashboard',
  ),
  ...series(
    'checkpoints',
    'Maîtrise',
    'Poser des repères',
    [1, 3, 5, 10, 20],
    [1, 2, 3, 5, 7],
    [
      'Un point de repère',
      'Trois balises',
      'Le filet de sécurité',
      'Dix étapes gardées',
      'Mémoire du chemin',
    ],
    (n) => `Créer ${n} checkpoint${n > 1 ? 's' : ''} manuel${n > 1 ? 's' : ''}.`,
    'Dans l’espace de travail de la session, créez un checkpoint nommé. Les checkpoints automatiques ne comptent pas.',
    'dashboard',
  ),
  ...series(
    'agentsCreated',
    'Composition',
    'Recruter ses agents',
    [1, 2, 5, 10, 20],
    [2, 3, 5, 7, 10],
    [
      'Une nouvelle recrue',
      'Un duo maison',
      'Cinq personnalités',
      'Une équipe sur mesure',
      'La grande compagnie',
    ],
    (n) =>
      `Créer ou importer ${n} profil${n > 1 ? 's' : ''} d’agent${n > 1 ? 's' : ''} distinct${n > 1 ? 's' : ''}.`,
    'Agents → Nouvel agent. Donnez un nouvel identifiant, des instructions et un rôle au profil ; réenregistrer le même identifiant ne le recompte pas.',
    'agents',
  ),
  ...series(
    'teamsCreated',
    'Composition',
    'Composer ses équipes',
    [1, 3, 5, 10, 20],
    [2, 3, 5, 7, 10],
    ['Le bon casting', 'Trois équipes', 'Le carnet de casting', 'Dix formations', 'Chef de troupe'],
    (n) => `Enregistrer ${n} composition${n > 1 ? 's' : ''} d’équipe distincte${n > 1 ? 's' : ''}.`,
    'Avant le premier lancement d’une session, composez puis enregistrez l’équipe. La suite ordonnée des agents définit une composition.',
    'dashboard',
  ),
  ...series(
    'skillsCreated',
    'Composition',
    'Transmettre un savoir',
    [1, 2, 3, 5, 10],
    [2, 3, 4, 6, 9],
    [
      'Un savoir en poche',
      'Deux spécialités',
      'La boîte à savoirs',
      'Cinq méthodes maison',
      'La bibliothèque des experts',
    ],
    (n) => `Créer ou importer ${n} skill${n > 1 ? 's' : ''} distincte${n > 1 ? 's' : ''}.`,
    'Skills → Nouvelle skill. Enregistrez une méthode réutilisable sous un nouvel identifiant.',
    'skills',
  ),
  ...series(
    'workflowsCreated',
    'Composition',
    'Dessiner des parcours',
    [1, 2, 3, 5, 10],
    [3, 4, 5, 7, 10],
    [
      'Votre premier parcours',
      'Deux chemins',
      'Trois itinéraires',
      'L’architecte des relais',
      'Dix parcours maison',
    ],
    (n) => `Enregistrer ${n} nouveau${n > 1 ? 'x' : ''} parcours.`,
    'Parcours → Nouveau parcours, ou dupliquez un parcours avec un nouvel identifiant. Un même identifiant compte une fois.',
    'workflows',
  ),
  ...series(
    'memoryEntries',
    'Maîtrise',
    'Cultiver la mémoire',
    [1, 3, 5, 10, 20],
    [1, 2, 3, 5, 7],
    [
      'Ne pas oublier',
      'Trois repères partagés',
      'Le carnet du projet',
      'Dix notes pour demain',
      'La mémoire de l’atelier',
    ],
    (n) => `Enregistrer ${n} note${n > 1 ? 's' : ''} de mémoire distincte${n > 1 ? 's' : ''}.`,
    'Mémoire → Nouvelle entrée. Conservez une convention, une décision ou du contexte utile.',
    'memory',
  ),
  ...series(
    'discussions',
    'Exploration',
    'Échanger librement',
    [1, 3, 5, 10, 20],
    [1, 2, 3, 5, 7],
    [
      'On en parle ?',
      'Trois conversations',
      'Le salon est ouvert',
      'Dix sujets explorés',
      'Habitué du salon',
    ],
    (n) => `Recevoir une réponse complète dans ${n} discussion${n > 1 ? 's distinctes' : ''}.`,
    'Discussion → Nouvelle discussion. Choisissez un agent et échangez ; une réponse interrompue ou en erreur ne suffit pas.',
    'discussion',
  ),
  ...series(
    'observations',
    'Maîtrise',
    'Prendre du recul',
    [1, 2, 3, 5, 10],
    [2, 3, 5, 7, 10],
    [
      'Dans le rétroviseur',
      'Deux prises de recul',
      'Le regard extérieur',
      'Cinq séances débriefées',
      'L’atelier qui apprend',
    ],
    (n) => `Terminer une analyse de ${n} session${n > 1 ? 's distinctes' : ''} avec l’Observateur.`,
    'Dans une session, ouvrez Analyser cette session, vérifiez le budget puis lancez l’Observateur. Seules les analyses terminées comptent.',
    'dashboard',
  ),
  unique(
    'relay',
    'Le relais à trois',
    'Faire réussir trois agents différents de suite dans une feature.',
    'Enchaînez trois interventions réussies avec trois agents différents. Un échec ou une annulation interrompt la série.',
    4,
    'Composition',
    'dashboard',
    3,
  ),
  unique(
    'relay',
    'Les six fantastiques',
    'Faire réussir six agents différents de suite dans une feature.',
    'Composez une équipe de six agents et faites-les intervenir successivement. Les reprises du même agent ne doublent pas sa place.',
    10,
    'Composition',
    'dashboard',
    6,
  ),
  unique(
    'isolated',
    'Un atelier à part',
    'Créer une session dans un worktree isolé.',
    'Lors de la création, choisissez un espace Git isolé pour séparer le travail de cette feature.',
    3,
    'Maîtrise',
    'dashboard',
  ),
  unique(
    'multiProject',
    'Le pont entre projets',
    'Créer une feature qui réunit au moins deux projets.',
    'En créant la session, sélectionnez plusieurs dépôts distincts dans le sélecteur de projets.',
    5,
    'Maîtrise',
    'dashboard',
  ),
  unique(
    'budget',
    'La boussole du budget',
    'Enregistrer un budget pour une feature.',
    'Dans la session, réglez les limites de lancement, de contexte ou de consommation et enregistrez.',
    2,
    'Maîtrise',
    'dashboard',
  ),
  unique(
    'criteria',
    'Définir la ligne d’arrivée',
    'Enregistrer au moins un critère d’acceptation.',
    'Ajoutez un critère concret à la feature pour savoir ce qui permettra de la valider.',
    2,
    'Collaboration',
    'dashboard',
  ),
  unique(
    'context',
    'Juste le contexte utile',
    'Terminer une intervention avec un contexte choisi.',
    'Avant le lancement, sélectionnez les blocs utiles ou écrivez un contexte initial.',
    3,
    'Maîtrise',
    'dashboard',
  ),
  unique(
    'skillUse',
    'Savoir appliqué',
    'Terminer une intervention qui utilise une skill.',
    'Ajoutez une skill à l’intervention, puis lancez l’agent avec cette méthode.',
    3,
    'Composition',
    'dashboard',
  ),
  unique(
    'memoryUse',
    'La mémoire en action',
    'Terminer une intervention avec de la mémoire projet.',
    'Dans le contexte de lancement, sélectionnez une note de mémoire existante.',
    3,
    'Maîtrise',
    'dashboard',
  ),
  unique(
    'readOnly',
    'Observer avant d’agir',
    'Terminer une intervention en lecture seule.',
    'Choisissez la politique Lecture seule pour une intervention de découverte ou de revue.',
    2,
    'Premiers pas',
    'dashboard',
  ),
  unique(
    'testEvidence',
    'Des preuves, pas des promesses',
    'Obtenir un résultat de test réussi enregistré par l’hôte.',
    'Configurez une commande de test et utilisez une intervention autorisée à la lancer.',
    5,
    'Maîtrise',
    'dashboard',
  ),
  unique(
    'review',
    'Un second regard',
    'Obtenir une revue structurée d’un agent.',
    'Utilisez une intervention de revue et consultez son verdict et ses remarques.',
    3,
    'Collaboration',
    'dashboard',
  ),
  unique(
    'correction',
    'Retour, correction, validation',
    'Terminer un cycle de correction ciblée.',
    'Sélectionnez les remarques à traiter, lancez la correction puis validez ses résultats.',
    6,
    'Collaboration',
    'dashboard',
  ),
  unique(
    'export',
    'Une trace à partager',
    'Exporter le compte rendu d’une session.',
    'Utilisez Exporter dans une session et choisissez un fichier Markdown.',
    2,
    'Exploration',
    'dashboard',
  ),
  unique(
    'archive',
    'Faire de la place',
    'Archiver une session.',
    'Dans le Dashboard, archivez une session à conserver sans l’afficher dans l’atelier actif.',
    1,
    'Premiers pas',
    'dashboard',
  ),
  unique(
    'theme',
    'L’atelier vous ressemble',
    'Choisir une ambiance personnelle.',
    'Réglages → L’ambiance du cockpit. Choisissez un des sept thèmes.',
    1,
    'Exploration',
    'settings',
  ),
  unique(
    'favorite',
    'Votre agent de confiance',
    'Mettre un agent en favori.',
    'Dans la liste des agents, utilisez l’étoile pour retrouver ce profil en priorité.',
    1,
    'Exploration',
    'agents',
  ),
  unique(
    'kitExport',
    'La boîte à transmettre',
    'Exporter un kit composé dans le cockpit.',
    'Dans Kits, composez une sélection puis exportez son fichier .fskit.json.',
    4,
    'Composition',
    'kits',
  ),
  unique(
    'kitImport',
    'Ouvrir une nouvelle boîte',
    'Installer un kit depuis son aperçu.',
    'Dans Kits, inspectez le contenu et les conflits, puis confirmez l’installation.',
    4,
    'Exploration',
    'kits',
  ),
  unique(
    'modelOverride',
    'Choisir son équipier technique',
    'Terminer une intervention avec un modèle choisi pour cette étape.',
    'Dans les réglages de l’intervention, choisissez explicitement un modèle disponible.',
    3,
    'Exploration',
    'dashboard',
  ),
];
export const questById = new Map(quests.map((quest) => [quest.id, quest]));
export const questCaps = Object.fromEntries(
  QUEST_METRICS.map((metric) => [
    metric,
    Math.max(...quests.filter((q) => q.metric === metric).map((q) => q.target)),
  ]),
) as Record<QuestMetric, number>;
export function questStatus(
  quest: QuestDefinition,
  state: QuestState,
): 'completed' | 'active' | 'locked' {
  return state.completed[quest.id]
    ? 'completed'
    : quest.previousId && !state.completed[quest.previousId]
      ? 'locked'
      : 'active';
}
