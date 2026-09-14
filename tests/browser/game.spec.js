import { expect, test } from '@playwright/test';
import { LEVELS } from '../../src/rules.js';
import { KEY } from '../../src/store.js';

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  await page.exposeFunction('getBrowserErrors', () => errors);
});

test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => window.getBrowserErrors())).toEqual([]);
});

test('the built app loads its styles, four levels, and initial menu', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Testcontainers: the game', exact: true })).toBeVisible();
  await expect(page.locator('#levelnav button')).toHaveCount(LEVELS.length);
  await expect(page.locator('#howtoGrid article')).toHaveCount(LEVELS.length);
  await expect(page.locator('#levelnav button').first()).toBeEnabled();
  await expect(page.locator('#levelnav button').nth(1)).toBeDisabled();
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /four-level/);
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(8, 26, 46)');
  await expect(page.locator('body')).toHaveCSS('font-family', /Rubik/);
  expect(await page.locator('.brand-mark').evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  // Canvas labels use Roboto Mono, so verify that both local font families load.
  expect(await page.evaluate(async () => {
    const fonts = await Promise.all([
      document.fonts.load('400 16px Rubik'),
      document.fonts.load('500 16px "Roboto Mono"'),
    ]);
    return fonts.every((faces) => faces.length > 0 && faces.every((face) => face.status === 'loaded'));
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

for (const level of LEVELS) {
  test(`level ${level.id} starts, renders, pauses, resumes, and returns to the menu`, async ({ page }) => {
    await page.addInitScript(({ key }) => {
      localStorage.setItem(key, JSON.stringify({ unlocked: 4, best: {}, sound: false }));
    }, { key: KEY });
    await page.goto('/');
    await page.getByRole('button', { name: `${level.id}. ${level.name}`, exact: true }).click();
    await expect(page.locator('#overlay h2')).toHaveText(level.name);
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page.locator('#overlay')).toBeHidden();
    await expect(page.locator('#hudLevel')).toContainText(`Level ${level.id}`);
    // Wait for actual painted canvas content, exercising each scene's draw method.
    await expect.poll(() => page.locator('#game').evaluate((canvas) =>
      canvas.getContext('2d').getImageData(10, 10, 1, 1).data[3])).toBe(255);
    await page.keyboard.press('p');
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(page.locator('#overlay')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.locator('#overlay h2')).toHaveText('Testcontainers: the game');
  });
}

test('sound preference survives a reload', async ({ page }) => {
  await page.goto('/');
  const sound = page.getByRole('button', { name: 'Toggle sound' });
  await expect(sound).toHaveAttribute('aria-pressed', 'true');
  await sound.click();
  await expect(sound).toHaveAttribute('aria-pressed', 'false');
  await page.reload();
  await expect(sound).toHaveAttribute('aria-pressed', 'false');
});

test('previously saved scores and unlocked levels survive the extraction', async ({ page }) => {
  await page.addInitScript(({ key }) => {
    localStorage.setItem(key, JSON.stringify({ unlocked: 3, best: { 1: 900, 2: 1200 }, sound: false }));
  }, { key: KEY });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Play level 3/ })).toBeVisible();
  await expect(page.locator('#overlay')).toContainText('Career score 2,100');
  await expect(page.locator('#levelnav button').nth(2)).toBeEnabled();
  await expect(page.locator('#levelnav button').nth(3)).toBeDisabled();
});
