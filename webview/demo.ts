import type { Feature, StudioState, Workflow } from '../src/shared/types';
const steps = [
  {
    id: 'discover',
    name: 'Cadrage',
    description: 'Comprendre le besoin et définir les critères de réussite.',
    agentId: 'analyst',
    policy: 'read-only' as const,
    skills: ['product'],
    maxAttempts: 0,
    artifact: '01-cadrage.md',
    dependsOn: [],
  },
  {
    id: 'design',
    name: 'Conception',
    description: 'Choisir une architecture simple et préciser les contrats.',
    agentId: 'architect',
    policy: 'read-only' as const,
    skills: [],
    maxAttempts: 0,
    artifact: '02-conception.md',
    dependsOn: ['discover'],
  },
  {
    id: 'build',
    name: 'Développement',
    description: 'Implémenter le comportement et les tests associés.',
    agentId: 'builder',
    policy: 'workspace-write' as const,
    skills: [],
    maxAttempts: 0,
    artifact: '03-implementation.md',
    dependsOn: ['design'],
  },
  {
    id: 'test',
    name: 'Tests',
    description: 'Exécuter les commandes de test autorisées.',
    agentId: 'tester',
    policy: 'tests' as const,
    skills: [],
    maxAttempts: 0,
    artifact: '04-tests.md',
    dependsOn: ['build'],
  },
  {
    id: 'review',
    name: 'Relecture',
    description: 'Vérifier les changements et les limites de la solution.',
    agentId: 'reviewer',
    policy: 'read-only' as const,
    skills: [],
    maxAttempts: 0,
    artifact: '05-relecture.md',
    dependsOn: ['test'],
  },
];
const workflows: Workflow[] = [
  {
    id: 'feature',
    name: 'Feature complète',
    description: 'Du besoin à une implémentation vérifiée, avec votre validation à chaque étape.',
    icon: 'sparkles',
    steps,
  },
  {
    id: 'code-review',
    name: 'Relecture de code',
    description: 'Un regard frais sur les changements, les risques et les tests.',
    icon: 'scan',
    steps: [{ ...steps[4], dependsOn: [] }],
  },
  {
    id: 'single',
    name: 'Session libre',
    description: 'Une conversation avec un agent, pour explorer et avancer à votre rythme.',
    icon: 'message',
    steps: [
      {
        ...steps[0],
        id: 'session',
        name: 'Session',
        description: 'Travaillez avec votre agent sur une demande libre.',
        policy: 'workspace-write',
        dependsOn: [],
      },
    ],
  },
];
const at = '2026-10-13T09:42:00.000Z';
function feature(
  id: string,
  title: string,
  description: string,
  active: number,
  status: Feature['status'],
): Feature {
  return {
    id,
    title,
    description,
    workflowId: 'feature',
    workflowName: 'Feature complète',
    branch: `feature/${id}`,
    createdAt: at,
    updatedAt: at,
    status,
    activeStepId: steps[active].id,
    steps: steps.map((s, i) => ({
      ...s,
      status:
        status === 'draft'
          ? 'pending'
          : i < active
            ? 'approved'
            : i === active
              ? 'awaiting_review'
              : 'pending',
      attempts:
        status !== 'draft' && i <= active
          ? [
              {
                id: `${id}-${i}`,
                startedAt: at,
                finishedAt: at,
                status: i < active ? 'approved' : 'awaiting_review',
                feedback: '',
                questions: [],
                answers: {},
                changedFiles: [],
                logs: [
                  { id: 'l1', at, kind: 'info', message: 'Contexte du projet chargé.' },
                  {
                    id: 'l2',
                    at,
                    kind: 'tool',
                    message: 'Lecture des composants et des conventions du dépôt.',
                  },
                  {
                    id: 'l3',
                    at,
                    kind: 'message',
                    message: 'Le livrable est prêt pour votre relecture.',
                  },
                ],
                artifact: {
                  name: s.artifact,
                  updatedAt: at,
                  content:
                    '# Une recherche qui suit votre rythme\n\n## Intention\nPermettre de retrouver une commande en quelques secondes, sans quitter le contexte de travail.\n\n## Approche proposée\n\nUne palette accessible au clavier, ouverte avec **⌘ K**, qui recherche dans les actions et les pages du projet.\n\n- [x] État vide utile et raccourcis visibles\n- [x] Navigation avec les flèches et validation par Entrée\n- [ ] Relecture des critères avant implémentation\n\n### Critères de réussite\n\n| Situation | Comportement attendu |\n| --- | --- |\n| Aucun résultat | Suggérer de modifier la recherche |\n| Une action sélectionnée | Fermer la palette et ouvrir la destination |\n| Touche Échap | Revenir au contexte précédent |\n\n> La recherche reste locale. Aucune requête distante n’est nécessaire.',
                },
              },
            ]
          : [],
    })),
  };
}
export const demoState: StudioState = {
  schemaVersion: 1,
  workspace: {
    name: 'atelier-product',
    path: '/demo/atelier-product',
    trusted: true,
    branch: 'main',
  },
  features: [
    feature(
      'command-palette',
      'Une palette de commandes, enfin fluide',
      'Retrouver une action sans interrompre le fil de sa pensée.',
      1,
      'attention',
    ),
    feature(
      'onboarding',
      'Un premier pas plus accueillant',
      'Transformer un écran vide en point de départ utile.',
      0,
      'draft',
    ),
    {
      ...feature(
        'accessible-navigation',
        'Navigation accessible au clavier',
        'Les détails qui rendent l’interface agréable pour tout le monde.',
        4,
        'completed',
      ),
      steps: steps.map((s) => ({ ...s, status: 'approved', attempts: [] })),
    },
  ],
  workflows,
  agents: [
    {
      id: 'analyst',
      nickname: 'Sherlock',
      avatar: 'detective',
      name: 'Product Analyst',
      description: 'Clarifie le besoin, le périmètre et les critères d’acceptation.',
      instructions:
        'Pose des questions précises. Privilégie les comportements observables et les critères vérifiables.',
      tools: ['read', 'search'],
      skills: ['product'],
      source: 'bundled',
      path: '.github/agents/analyst.agent.md',
    },
    {
      id: 'architect',
      nickname: 'Merlin',
      avatar: 'wizard',
      name: 'Software Architect',
      description: 'Dessine des solutions sobres, alignées sur le projet.',
      instructions: 'Étudie les conventions du projet avant de proposer une architecture.',
      tools: ['read', 'search'],
      skills: [],
      source: 'bundled',
      path: '.github/agents/architect.agent.md',
    },
    {
      id: 'builder',
      nickname: 'Pixel',
      avatar: 'hacker',
      name: 'Developer',
      description: 'Implémente, teste et explique les changements.',
      instructions:
        'Écris une solution complète et des tests utiles. Préserve les changements existants.',
      tools: ['read', 'search', 'edit'],
      skills: [],
      source: 'bundled',
      path: '.github/agents/developer.agent.md',
    },
    {
      id: 'tester',
      nickname: 'Ada',
      avatar: 'scientist',
      name: 'Test Engineer',
      description: 'Transforme les critères en preuves et explique les limites.',
      instructions: 'Écris les tests utiles et exécute uniquement les commandes préautorisées.',
      tools: ['read', 'search', 'edit', 'execute'],
      skills: [],
      source: 'bundled',
      path: '.github/agents/tester.agent.md',
    },
    {
      id: 'reviewer',
      nickname: 'Shinobi',
      avatar: 'ninja',
      name: 'Code Reviewer',
      description: 'Examine les risques avec un regard indépendant.',
      instructions: 'Privilégie les défauts démontrables. Donne une localisation précise.',
      tools: ['read', 'search'],
      skills: [],
      source: 'bundled',
      path: '.github/agents/reviewer.agent.md',
    },
  ],
  skills: [
    {
      id: 'product',
      name: 'Cadrage produit',
      description: 'Du besoin aux critères d’acceptation, sans perdre le fil.',
      content:
        '---\nname: Cadrage produit\ndescription: Clarifier les critères d’acceptation.\n---\n\n# Cadrage produit\n\nDécrire le besoin, le comportement attendu et les critères de réussite.',
      source: 'bundled',
      path: '.github/skills/product/SKILL.md',
    },
  ],
  runtime: { state: 'unchecked', models: [] },
  settings: { defaultModel: '', timeoutMinutes: 20, testCommands: [], testPaths: [], hooks: [] },
  notices: [],
};
