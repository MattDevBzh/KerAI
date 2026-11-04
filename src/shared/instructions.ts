export interface PinnedInstruction {
  id: string;
  revision: number;
  text: string;
  active: boolean;
  updatedAt: string;
  history: { revision: number; text: string; active: boolean; at: string }[];
}
