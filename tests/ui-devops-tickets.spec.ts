import { expect, test, type Page } from '@playwright/test';
import { installTicketsHost, ticketsState, ticketDetailFixture } from './fixtures/tickets';
import type { ClientMessage, DevOpsState } from '../src/shared/types';
const messages = (page: Page) =>
  page.evaluate(() => Reflect.get(window, 'ticketsMessages') as ClientMessage[]);
const panel = (page: Page) => page.locator('.tickets-panel:visible');
async function patch(page: Page, change: Partial<DevOpsState>) {
  await page.evaluate((change) => {
    const state = Object.assign(Reflect.get(window, 'ticketsState') as DevOpsState, change);
    window.postMessage({ type: 'devopsState', state }, '*');
  }, change);
}

test('liste compacte, recherche distante combinée et saisie de plusieurs tags au clavier', async ({
  page,
}) => {
  await installTicketsHost(page);
  const view = panel(page);
  await expect(view.getByRole('article')).toHaveCount(5);
  await expect(view.getByRole('article', { name: 'Ticket 1031', exact: true })).toContainText(
    'Non assigné',
  );
  await expect(view.getByRole('article', { name: 'Ticket 1031', exact: true })).toContainText(
    'Demande métier',
  );
  await expect(
    view.getByRole('button', { name: 'Reprendre la session du ticket 1024' }),
  ).toBeVisible();
  await view.getByLabel('Rechercher un ticket', { exact: true }).fill('session');
  await view.getByLabel('Type de ticket').selectOption('User Story');
  await view.getByLabel('État du ticket').selectOption('Prêt à développer');
  await view.getByLabel('Tags', { exact: true }).pressSequentially('UX; navigation');
  await expect(view.getByLabel('Tags', { exact: true })).toHaveValue('UX; navigation');
  await view.getByLabel('Zone', { exact: true }).fill('Studio\\Cockpit');
  await view.getByLabel('Sprint / itération').fill('Studio\\Sprint 24');
  await expect(view.getByRole('article')).toHaveCount(5);
  await expect(view.getByText(/Filtres modifiés/)).toBeVisible();
  await view.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(view.getByRole('article')).toHaveCount(1);
  const sent = (await messages(page))
    .filter((message) => message.type === 'devopsSearchTickets')
    .at(-1);
  expect(sent).toEqual({
    type: 'devopsSearchTickets',
    sourceProjectKey: 'atelier/studio',
    filters: {
      query: 'session',
      types: ['User Story'],
      states: ['Prêt à développer'],
      assignment: 'all',
      identity: '',
      tags: ['UX', 'navigation'],
      areaPath: 'Studio\\Cockpit',
      iterationPath: 'Studio\\Sprint 24',
    },
  });
});

test('chargement progressif conserve les résultats et atteint un type personnalisé non assigné', async ({
  page,
}) => {
  await installTicketsHost(page);
  await panel(page).getByRole('button', { name: 'Charger les 50 suivants' }).click();
  await expect(panel(page).getByRole('article')).toHaveCount(6);
  const last = panel(page).getByRole('article', { name: 'Ticket 888', exact: true });
  await expect(last).toContainText('Demande métier');
  await expect(last).toContainText('Non assigné');
  expect(
    (await messages(page)).some(
      (message) => message.type === 'devopsSearchTickets' && message.more,
    ),
  ).toBe(true);
});

test('détail à la demande, champs utiles, commentaires datés et liens sûrs', async ({ page }) => {
  await installTicketsHost(page);
  expect((await messages(page)).some((message) => message.type === 'devopsLoadTicket')).toBe(false);
  await panel(page).getByRole('button', { name: 'Voir le détail du ticket 1042' }).click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('heading', { name: 'Préparer une session à partir d’un ticket' }),
  ).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Critères d’acceptation' })).toBeVisible();
  await expect(dialog.locator('.ticket-comment')).toHaveCount(2);
  await expect(dialog.locator('.ticket-comment').first()).toContainText('16 oct. 2026');
  await dialog.getByText('Autres champs du ticket (2)', { exact: true }).click();
  await expect(dialog.getByText('Valeur utilisateur', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Pièce jointe · contenu non importé')).toBeVisible();
  await expect(dialog.getByRole('link', { name: /Parent/ })).toHaveAttribute(
    'href',
    /workitems\/edit\/990$/,
  );
  expect(await page.evaluate(() => Reflect.get(window, 'ticketInjected'))).toBeUndefined();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(
    panel(page).getByRole('button', { name: 'Voir le détail du ticket 1042' }),
  ).toBeFocused();
});

test('préparation garde la source en changeant de dépôt, importe les commentaires choisis et laisse le lancement humain', async ({
  page,
}) => {
  await installTicketsHost(page);
  await panel(page)
    .getByRole('button', { name: 'Préparer le développement du ticket 1042' })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Dépôt local cible')).toHaveValue('cockpit');
  await expect(dialog.getByRole('radio', { name: /Worktree isolé/ })).toBeChecked();
  await dialog.getByLabel('Dépôt local cible').selectOption('portal');
  await expect(dialog.getByLabel('Branche de départ')).toHaveValue('refs/heads/develop');
  await expect(dialog.locator('.ticket-source-pill')).toContainText('atelier/studio');
  await expect(dialog.locator('.ticket-source-pill')).toContainText('#1042');
  await dialog.getByLabel('Titre de la session').fill('Mon développement préparé');
  await dialog.getByLabel('Consignes complémentaires').fill('Conserver la navigation validée.');
  await dialog.getByRole('checkbox').first().check();
  const preview = dialog.getByLabel('Contexte qui sera importé');
  await expect(preview).toContainText('Décision : les commentaires sont sélectionnables.');
  await expect(preview).not.toContainText('Ancienne piste');
  await expect(preview).toContainText('Conserver la navigation validée.');
  await dialog.getByRole('button', { name: 'Créer la session', exact: true }).click();
  const sent = (await messages(page)).find((message) => message.type === 'devopsCreateFeature');
  expect(sent).toMatchObject({
    ticketId: 1042,
    plan: {
      sourceProjectKey: 'atelier/studio',
      targetProjectId: 'portal',
      title: 'Mon développement préparé',
      isolated: true,
      baseRef: 'refs/heads/develop',
      baseCommit: 'c'.repeat(40),
      commentIds: [71],
      instructions: 'Conserver la navigation validée.',
    },
  });
  expect(
    (await messages(page)).some((message) =>
      ['runStep', 'startAutopilot', 'saveFeatureTeam'].includes(message.type),
    ),
  ).toBe(false);
  await expect(dialog).toHaveCount(0);
});

test('reprise passe par le host et ne prépare pas une nouvelle création', async ({ page }) => {
  await installTicketsHost(page);
  await panel(page).getByRole('button', { name: 'Reprendre la session du ticket 1024' }).click();
  expect(await messages(page)).toContainEqual({
    type: 'devopsPrepareTicket',
    ticketId: 1024,
    sourceProjectKey: 'atelier/studio',
  });
  expect((await messages(page)).some((message) => message.type === 'devopsCreateFeature')).toBe(
    false,
  );
});

test('erreur de détail et commentaires indisponibles ne ressemblent pas à des données absentes', async ({
  page,
}) => {
  await installTicketsHost(page);
  await panel(page).getByRole('button', { name: 'Voir le détail du ticket 1042' }).click();
  await patch(page, {
    ticketDetail: undefined,
    ticketDetailError: { ticketId: 1042, message: 'Accès refusé au ticket.' },
  });
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('alert')).toContainText('Accès refusé');
  await expect(dialog.getByRole('button', { name: 'Réessayer le chargement' })).toBeVisible();
  await patch(page, {
    ticketDetailError: undefined,
    ticketDetail: {
      ...ticketDetailFixture,
      comments: [],
      commentsLoaded: false,
      commentsError: 'Droits commentaires manquants.',
    },
  });
  await expect(dialog.getByRole('alert')).toContainText('Droits commentaires manquants');
  await expect(dialog.getByText('Aucun commentaire.', { exact: true })).toHaveCount(0);
});

test('recherche indisponible, vide et partielle sont distinguées', async ({ page }) => {
  const state = structuredClone(ticketsState);
  state.ticketSearch = {
    filters: state.ticketFilters!,
    tickets: [],
    hasMore: false,
    limitReached: false,
    omitted: 0,
    error: 'Réseau indisponible',
  };
  state.error = 'Réseau indisponible';
  await installTicketsHost(page, state);
  await expect(
    panel(page).getByRole('heading', { name: 'La recherche est indisponible' }),
  ).toBeVisible();
  await patch(page, {
    error: undefined,
    ticketSearch: { ...state.ticketSearch, error: undefined, searchedAt: '2026-10-17T09:00:00Z' },
  });
  await expect(
    panel(page).getByRole('heading', { name: 'Aucun résultat pour ces filtres' }),
  ).toBeVisible();
  await patch(page, {
    ticketSearch: { ...ticketsState.ticketSearch!, limitReached: true, omitted: 2 },
  });
  await expect(panel(page).getByText(/Limite de 1 000 tickets/)).toBeVisible();
  await expect(panel(page).getByText(/2 ticket\(s\) n’ont pas pu être lus/)).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Charger les 50 suivants' })).toHaveCount(0);
});

for (const width of [390, 1101, 1440])
  test(`liste et fenêtres utilisables à ${width}px sans débordement`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await installTicketsHost(page);
    await expect(panel(page).getByRole('article')).toHaveCount(5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    const listBounds = await panel(page).locator('.ticket-list').boundingBox();
    for (const action of await panel(page).locator('.ticket-row-actions button').all()) {
      const bounds = await action.boundingBox();
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(listBounds!.x + listBounds!.width);
    }
    await panel(page).getByRole('button', { name: 'Voir le détail du ticket 1042' }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Préparer le développement', exact: true })
      .click();
    await expect(page.getByRole('dialog').getByLabel('Dépôt local cible')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  });
