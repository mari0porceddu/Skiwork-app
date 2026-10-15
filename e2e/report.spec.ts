import { expect, test } from '@playwright/test';

test('scarica il report PDF del mese dalla pagina Finanze', async ({ page }) => {
  await page.goto('/#/finanze');
  await expect(page.getByRole('heading', { name: 'Finanze' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Report PDF' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^skiwork-report-\d{4}-\d{2}-01_\d{4}-\d{2}-\d{2}\.pdf$/);
  await page.screenshot({ path: test.info().outputPath('finanze.png') });
});
