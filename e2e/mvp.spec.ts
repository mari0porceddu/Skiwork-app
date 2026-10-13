import { expect, test } from '@playwright/test';

test('registra una giornata di lavoro, verifica ore e compensi, funziona offline', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  // Lezione privata già svolta: 2 ore a 50 €/h
  await page.getByRole('button', { name: 'Aggiungi attività' }).first().click();
  const dlg = page.getByRole('dialog', { name: 'Aggiungi attività' });
  await dlg.getByLabel('Tipologia', { exact: true }).selectOption('private_lesson');
  await dlg.getByLabel('Committente', { exact: true }).selectOption({ label: 'Scuola di sci' });
  await dlg.getByLabel('Data', { exact: true }).fill('2026-01-10');
  await dlg.getByLabel('Inizio', { exact: true }).fill('09:00');
  await dlg.getByLabel('Fine', { exact: true }).fill('11:00');
  await dlg.getByLabel('Tariffa applicabile', { exact: true }).selectOption('manual');
  await dlg.getByLabel('Importo all’ora', { exact: true }).fill('50');
  await expect(dlg.getByText('Compenso maturato')).toBeVisible();
  await expect(dlg.locator('.preview')).toContainText('100,00');
  await dlg.getByRole('button', { name: 'Salva' }).click();
  await expect(page.getByText('Attività salvata').last()).toBeVisible();

  // Allenamento ASD 17:30-19:15 a 18 €/h = 31,50 €
  await page.getByRole('button', { name: 'Aggiungi attività' }).first().click();
  const dlg2 = page.getByRole('dialog', { name: 'Aggiungi attività' });
  await dlg2.getByLabel('Tipologia', { exact: true }).selectOption('training');
  await dlg2.getByLabel('Committente', { exact: true }).selectOption({ label: 'Associazione sportiva' });
  await dlg2.getByLabel('Data', { exact: true }).fill('2026-01-10');
  await dlg2.getByLabel('Inizio', { exact: true }).fill('17:30');
  await dlg2.getByLabel('Fine', { exact: true }).fill('19:15');
  await dlg2.getByLabel('Tariffa applicabile', { exact: true }).selectOption('manual');
  await dlg2.getByLabel('Importo all’ora', { exact: true }).fill('18');
  await dlg2.getByRole('button', { name: 'Salva' }).click();
  await expect(page.getByText('Attività salvata').last()).toBeVisible();

  // Verifica nella sezione Attività
  await page.goto('/#/attivita?from=2026-01-10&to=2026-01-10');
  await expect(page.locator('.totals-bar')).toContainText('2 attività');
  await expect(page.locator('.totals-bar')).toContainText('3 h 45′');
  await expect(page.locator('.totals-bar')).toContainText('131,50');

  // Offline: ricarica senza rete, i dati restano
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.totals-bar')).toContainText('131,50');
  await page.getByRole('button', { name: 'Aggiungi attività' }).first().click();
  const dlg3 = page.getByRole('dialog', { name: 'Aggiungi attività' });
  await dlg3.getByLabel('Data', { exact: true }).fill('2026-01-10');
  await dlg3.getByLabel('Inizio', { exact: true }).fill('13:00');
  await dlg3.getByLabel('Fine', { exact: true }).fill('14:00');
  await dlg3.getByLabel('Tipologia', { exact: true }).selectOption('personal');
  await dlg3.getByRole('button', { name: 'Salva' }).click();
  await expect(page.getByText('Attività salvata').last()).toBeVisible();
  await page.reload();
  await expect(page.locator('.totals-bar')).toContainText('3 attività');
  // Modulo fiscale: senza parametri verificati nessuna stima
  await page.goto('/#/fisco');
  await expect(page.getByText('Stima fiscale non configurata: verifica i parametri con il commercialista.')).toBeVisible();
  await page.goto('/#/finanze');
  await page.getByRole('radio', { name: 'Anno' }).click();
  await expect(page.getByRole('heading', { name: /Andamento mensile/ })).toBeVisible();
  expect(errors).toEqual([]);
});
