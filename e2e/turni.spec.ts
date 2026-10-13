import { expect, test } from '@playwright/test';

test('turni del committente: orari da impostazioni e scelta rapida nell’attività', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/#/impostazioni');
  await page.getByRole('button', { name: 'Associazione sportiva' }).first().click();
  const ed = page.getByRole('dialog', { name: 'Associazione sportiva' });
  await ed.getByLabel('Mattina: inizio', { exact: true }).fill('09:00');
  await ed.getByLabel('Mattina: fine', { exact: true }).fill('12:00');
  await ed.getByLabel('Pomeriggio: inizio', { exact: true }).fill('14:00');
  await ed.getByLabel('Pomeriggio: fine', { exact: true }).fill('16:30');
  await ed.getByRole('button', { name: 'Salva' }).click();
  await expect(page.getByText('Committente salvato').last()).toBeVisible();

  await page.getByRole('button', { name: 'Aggiungi attività' }).first().click();
  const dlg = page.getByRole('dialog', { name: 'Aggiungi attività' });
  await dlg.getByLabel('Tipologia', { exact: true }).selectOption('training');
  await dlg.getByLabel('Committente', { exact: true }).selectOption({ label: 'Associazione sportiva' });
  await expect(dlg.getByRole('button', { name: 'Giornata intera' })).toHaveCount(0);
  await dlg.getByRole('button', { name: 'Pomeriggio' }).click();
  await expect(dlg.getByLabel('Inizio', { exact: true })).toHaveValue('14:00');
  await expect(dlg.getByLabel('Fine', { exact: true })).toHaveValue('16:30');
  await dlg.getByLabel('Data', { exact: true }).fill('2026-12-05');
  await dlg.getByLabel('Tariffa applicabile', { exact: true }).selectOption('none');
  await dlg.getByRole('button', { name: 'Salva' }).click();
  await expect(page.getByText('Attività salvata').last()).toBeVisible();

  // Cambio orario del pomeriggio: l'attività pianificata si aggiorna
  await page.goto('/#/impostazioni');
  await page.getByRole('button', { name: 'Associazione sportiva' }).first().click();
  await ed.getByLabel('Pomeriggio: inizio', { exact: true }).fill('13:30');
  await ed.getByRole('button', { name: 'Salva' }).click();
  await expect(page.getByText('orari aggiornati su 1 attività').last()).toBeVisible();
  expect(errors).toEqual([]);
});
