import { z } from 'zod';
import type { TaskBoard, TaskBoardUpdate } from '../shared/taskBoard';

const id = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/)
  .refine((value) => !['constructor', 'prototype', '__proto__'].includes(value));
const text = z.string().trim().min(1).max(180);
const item = z
  .object({
    id,
    text,
    status: z.enum(['pending', 'in_progress', 'done', 'blocked']),
    note: z.string().trim().max(300).optional(),
  })
  .strict();
const fields = {
  mode: z.enum(['plan', 'task']),
  title: z.string().trim().min(1).max(100),
  items: z.array(item).min(1).max(48),
};
const validItems = (value: TaskBoardUpdate) =>
  new Set(value.items.map((i) => i.id)).size === value.items.length &&
  (value.mode !== 'task' || value.items.length === 1) &&
  value.items.filter((i) => i.status === 'in_progress').length <= 1;
export const taskBoardUpdateSchema = z.object(fields).strict().refine(validItems, {
  message: 'Identifiants uniques, une seule tâche courante et une seule ligne sans plan requis.',
});
export const taskBoardSchema = z
  .object({
    ...fields,
    version: z.literal(1),
    revision: z.number().int().positive(),
    initialPlan: z.array(z.object({ id, text }).strict()).max(48),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .refine(validItems)
  .refine(
    (board) =>
      new Set(board.initialPlan.map((i) => i.id)).size === board.initialPlan.length &&
      board.initialPlan.every((i) => board.items.some((current) => current.id === i.id)) &&
      (board.mode !== 'task' || board.initialPlan.length === 0),
  );

export function updateTaskBoard(
  previous: TaskBoard | undefined,
  raw: unknown,
  at = new Date().toISOString(),
): TaskBoard {
  const update = taskBoardUpdateSchema.parse(raw);
  if (previous?.mode === 'plan' && update.mode === 'task')
    throw new Error(
      'Un plan est déjà affiché. Mets à jour ses lignes sans effacer le plan initial.',
    );
  const initialPlan =
    previous?.mode === 'plan'
      ? previous.initialPlan
      : update.mode === 'plan'
        ? update.items.map(({ id, text }) => ({ id, text }))
        : [];
  const incoming = new Map(update.items.map((i) => [i.id, i]));
  const items =
    previous?.mode === 'plan'
      ? [
          ...previous.items.map((i) => incoming.get(i.id) ?? i),
          ...update.items.filter((i) => !previous.items.some((p) => p.id === i.id)),
        ]
      : update.items;
  return taskBoardSchema.parse({
    ...update,
    items,
    initialPlan,
    version: 1,
    revision: (previous?.revision ?? 0) + 1,
    updatedAt: at,
  });
}
