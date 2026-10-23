/** Agent-authored progress. Completion here never approves work or proves a test. */
export type TaskBoardStatus = 'pending' | 'in_progress' | 'done' | 'blocked';
export interface TaskBoardItem {
  id: string;
  text: string;
  status: TaskBoardStatus;
  note?: string;
}
export interface TaskBoardUpdate {
  mode: 'plan' | 'task';
  title: string;
  items: TaskBoardItem[];
}
export interface TaskBoard extends TaskBoardUpdate {
  version: 1;
  revision: number;
  initialPlan: { id: string; text: string }[];
  updatedAt: string;
}

export const taskBoardInstructions = `Tableau de suivi du QG : utilise studio_update_task_board au début de ton intervention puis lorsqu’une tâche commence, se termine ou se bloque. Ce tableau est visible par l’humain en direct. Si tu as un plan à suivre, publie une ligne par étape de CE plan (mode plan) avec des identifiants stables ; pour des tests, une ligne par fonctionnalité ou scénario à vérifier. Reprends le plan humain approuvé lorsqu’il existe. Sinon publie uniquement ta tâche courante (mode task, une seule ligne), sans inventer un plan. Écris les titres, lignes et notes brièvement en français. Statuts : pending, in_progress, done, blocked. Ne coche done qu’après avoir réalisé la tâche ; une ligne done n’est ni une preuve de test ni une validation humaine. Garde les lignes du plan initial, même terminées ; ajoute une ligne si la mission évolue. Ne mets aucun secret ni raisonnement interne dans les notes. Le tableau ne donne aucune autorisation d’exécution et ne remplace ni la conversation, ni les rapports, ni les validations. Un changement de vue ne change pas ton travail.`;
