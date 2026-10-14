import { test, expect, type Page } from '@playwright/test';
import { demoState } from '../webview/demo';
import type { ClientMessage, StudioState } from '../src/shared/types';

function state(): StudioState {
  const data = structuredClone(demoState);
  data.profileDirectories = { user: '/personal/.copilot', workspace: '/project' };
  const initial = data.agents[0];
  const bundled = {
    ...initial,
    source: 'bundled' as const,
    path: '/defaults/profile.agent.md',
    revision: 'a'.repeat(64),
    instructions: 'Bundled body',
  };
  const personal = {
    ...initial,
    source: 'user' as const,
    path: `/personal/.copilot/agents/${initial.id}.agent.md`,
    revision: 'b'.repeat(64),
    name: 'Personal agent',
    nickname: 'Personal friend',
    instructions: 'PERSONAL_BODY',
    description: 'Personal metadata',
    roastLevel: 'light' as const,
  };
  const project = {
    ...initial,
    source: 'workspace' as const,
    path: `/project/.github/agents/${initial.id}.agent.md`,
    revision: 'c'.repeat(64),
    nickname: 'Project friend',
    instructions: 'PROJECT_BODY\n\n```delivery-rules\ntypes: [fix]\n```',
    description: 'Project metadata',
    roastLevel: 'ruthless' as const,
  };
  data.agents[0] = {
    ...project,
    versions: [bundled, personal, project],
    targets: {
      user: { path: personal.path, revision: personal.revision },
      workspace: { path: project.path, revision: project.revision },
    },
  };
  const skill = data.skills[0];
  const userSkill = {
    ...skill,
    source: 'user' as const,
    path: `/personal/.copilot/skills/${skill.id}/SKILL.md`,
    revision: 'd'.repeat(64),
    content: '---\nname: Personal method\ndescription: Method\nunknown: keep\n---\nPERSONAL_SKILL',
  };
  const projectSkill = {
    ...skill,
    source: 'workspace' as const,
    path: `/project/.github/skills/${skill.id}/SKILL.md`,
    revision: 'e'.repeat(64),
    content: '---\nname: Project method\ndescription: Method\nunknown: keep\n---\nPROJECT_SKILL',
  };
  data.skills[0] = {
    ...projectSkill,
    versions: [userSkill, projectSkill],
    targets: {
      user: { path: userSkill.path, revision: userSkill.revision },
      workspace: { path: projectSkill.path, revision: projectSkill.revision },
    },
  };
  return data;
}
async function hosted(page: Page, data = state()) {
  await page.addInitScript((data) => {
    const sent: ClientMessage[] = [];
    Object.assign(window, {
      profileMessages: sent,
      acquireVsCodeApi: () => ({
        getState: () => ({}),
        setState: () => {},
        postMessage: (message: ClientMessage) => {
          sent.push(message);
          if (message.type === 'ready')
            setTimeout(() => window.postMessage({ type: 'state', state: data }, '*'), 0);
        },
      }),
    });
  }, data);
  await page.goto('/');
}
async function request(page: Page) {
  return page.evaluate(() =>
    (Reflect.get(window, 'profileMessages') as ClientMessage[]).at(-1),
  ) as Promise<Extract<ClientMessage, { type: 'saveAgent' | 'saveSkill' }>>;
}
test('agent : versions réelles, brouillons par portée, erreur corrélée et fermeture après succès', async ({
  page,
}) => {
  await hosted(page);
  await page.getByRole('button', { name: 'Agents', exact: true }).click();
  await page.getByRole('button').filter({ hasText: 'Project friend' }).click();
  await expect(page.getByLabel('Portée du profil')).toHaveValue('workspace');
  const body = page.getByLabel('Instructions', { exact: false });
  await expect(body).toHaveValue(/PROJECT_BODY/);
  await body.fill('PROJECT_DRAFT\n\n```delivery-rules\ntypes: [docs]\n```');
  await page.getByLabel('Portée du profil').selectOption('user');
  await expect(body).toHaveValue('PERSONAL_BODY');
  await expect(page.getByLabel('Rôle et description')).toHaveValue('Personal metadata');
  await expect(
    page.getByText('La version projet restera active ici', { exact: false }),
  ).toBeVisible();
  await body.fill('PERSONAL_DRAFT');
  await page.getByLabel('Portée du profil').selectOption('workspace');
  await expect(body).toHaveValue(/PROJECT_DRAFT/);
  await page.getByLabel('Portée du profil').selectOption('user');
  await expect(body).toHaveValue('PERSONAL_DRAFT');
  await page.getByRole('button', { name: 'Enregistrer le profil' }).click();
  const save = await request(page);
  expect(save).toMatchObject({
    type: 'saveAgent',
    options: {
      scope: 'user',
      expectedRevision: 'b'.repeat(64),
      sourceScope: 'user',
      sourceRevision: 'b'.repeat(64),
    },
    agent: { instructions: 'PERSONAL_DRAFT', description: 'Personal metadata' },
  });
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enregistrer le profil' })).toBeDisabled();
  await page.evaluate(() =>
    window.postMessage(
      { type: 'profileSaveResult', requestId: 'unrelated', error: 'Unrelated error' },
      '*',
    ),
  );
  await expect(page.getByText('Unrelated error')).toHaveCount(0);
  await page.evaluate(
    (requestId) =>
      window.postMessage(
        {
          type: 'profileSaveResult',
          requestId,
          error: 'Profil modifié dans une autre fenêtre. Brouillon conservé.',
        },
        '*',
      ),
    save.requestId,
  );
  await expect(page.getByRole('alert')).toContainText('Brouillon conservé');
  await expect(body).toHaveValue('PERSONAL_DRAFT');
  await expect(page.getByRole('button', { name: 'Enregistrer le profil' })).toBeEnabled();
  await page.getByRole('button', { name: 'Enregistrer le profil' }).click();
  const retry = await request(page);
  expect(retry.requestId).not.toBe(save.requestId);
  await page.evaluate(
    (requestId) =>
      window.postMessage(
        {
          type: 'profileSaveResult',
          requestId,
          path: '/personal/saved.md',
          revision: 'f'.repeat(64),
          scope: 'user',
        },
        '*',
      ),
    retry.requestId,
  );
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('skill : édition complète, version personnelle réelle et conservation du texte après refus', async ({
  page,
}) => {
  const data = state();
  await hosted(page, data);
  await page.getByRole('button', { name: 'Skills', exact: true }).click();
  await page.locator('.library-card').filter({ hasText: data.skills[0].name }).click();
  await expect(page.getByLabel('Contenu de la skill')).toHaveValue(/PROJECT_SKILL/);
  await page.getByLabel('Portée du profil').selectOption('user');
  await expect(page.getByLabel('Contenu de la skill')).toHaveValue(/PERSONAL_SKILL/);
  const content = '---\nname: Personal method\ndescription: Method\nunknown: custom\n---\nMY_DRAFT';
  await page.getByLabel('Contenu de la skill').fill(content);
  await page.getByRole('button', { name: 'Enregistrer la skill' }).click();
  const save = await request(page);
  expect(save).toMatchObject({
    type: 'saveSkill',
    content,
    options: { scope: 'user', expectedRevision: 'd'.repeat(64) },
  });
  await page.evaluate(
    (requestId) =>
      window.postMessage({ type: 'profileSaveResult', requestId, error: 'Révision obsolète' }, '*'),
    save.requestId,
  );
  await expect(page.getByRole('alert')).toContainText('Révision obsolète');
  await expect(page.getByLabel('Contenu de la skill')).toHaveValue(content);
});
test('nouveaux profils : collision visible et cible projet explicite', async ({ page }) => {
  const data = state();
  await hosted(page, data);
  await page.getByRole('button', { name: 'Agents', exact: true }).click();
  await page.getByRole('button', { name: 'Nouvel agent' }).click();
  await page.getByLabel('Nom du profil').fill('Copy');
  await page.getByLabel('Identifiant', { exact: true }).fill(data.agents[0].id);
  await page.getByLabel('Instructions', { exact: false }).fill('Draft');
  await expect(page.getByRole('alert')).toContainText('Cet identifiant existe déjà');
  await expect(page.getByRole('button', { name: 'Enregistrer le profil' })).toBeDisabled();
  await page.getByLabel('Identifiant', { exact: true }).fill('safe-copy');
  await page.getByLabel('Portée du profil').selectOption('workspace');
  await expect(
    page.getByText('/project/.github/agents/safe-copy.agent.md', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Enregistrer le profil' }).click();
  expect(await request(page)).toMatchObject({
    options: { scope: 'workspace', expectedRevision: null },
    agent: { id: 'safe-copy', instructions: 'Draft' },
  });
});

test('roast : niveau par portée, aperçu professionnel et brouillons conservés', async ({
  page,
}) => {
  await hosted(page);
  await page.getByRole('button', { name: 'Agents', exact: true }).click();
  const card = page.locator('.library-card').filter({ hasText: 'Project friend' });
  await expect(card).toContainText('Roast · Sans pitié');
  await card.click();
  const tone = page.getByLabel('Mode roast', { exact: true });
  await expect(tone).toHaveValue('ruthless');
  await tone.selectOption('spicy');
  await page.getByText('Aperçu des consignes roast · Piquant', { exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('diagnostic précis et une action utile');
  await expect(page.getByRole('dialog')).toContainText('messages de commit');
  await expect(page.getByRole('dialog')).toContainText('professionnels et sobres');
  await page.getByLabel('Portée du profil').selectOption('user');
  await expect(tone).toHaveValue('light');
  await tone.selectOption('off');
  await expect(page.getByText('Aperçu des consignes roast', { exact: false })).toHaveCount(0);
  await page.getByLabel('Portée du profil').selectOption('workspace');
  await expect(tone).toHaveValue('spicy');
  await page.getByLabel('Portée du profil').selectOption('user');
  await expect(tone).toHaveValue('off');
  await page.getByRole('button', { name: 'Enregistrer le profil' }).click();
  const save = await request(page);
  expect(save).toMatchObject({
    options: { scope: 'user', expectedRevision: 'b'.repeat(64) },
    agent: { roastLevel: 'off', instructions: 'PERSONAL_BODY' },
  });
  await page.evaluate(
    (requestId) =>
      window.postMessage({ type: 'profileSaveResult', requestId, error: 'Révision obsolète' }, '*'),
    save.requestId,
  );
  await expect(tone).toHaveValue('off');
});
