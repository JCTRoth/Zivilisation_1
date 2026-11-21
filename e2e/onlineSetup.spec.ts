import { expect, test } from '@playwright/test';

/**
 * The pre-game flow is one page, one choice.
 *
 * Step two offers "Play online" *in place*: choosing it swaps the local-only
 * settings for the room table without leaving the wizard, and the command bar
 * explains when the game starts instead of offering a local Start button.
 * Without a connection the choice is grayed out and inert — the wizard stays
 * on the local table rather than stranding a dead room panel.
 */
test.describe('setup step two — where to play', () => {
  test('Play online opens the room table inside the wizard', async ({ page }) => {
    await page.goto('/');

    // The wizard is the first screen — no hub in front of it — and the old
    // hub heading is gone for good.
    await expect(page.getByRole('heading', { name: 'Choose Your Civilization' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'The Table Is Set' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Next →' }).click();
    await expect(page.getByText('Fine-tune Your Challenge')).toBeVisible();

    // Local by default: the local-only settings and the local action.
    await expect(page.getByText('Terms of Engagement')).toBeVisible();
    await expect(page.getByRole('button', { name: '🏛️ Start Game' })).toBeVisible();

    // "Play online" is a choice on this very page — picking it must not
    // navigate anywhere.
    await page.getByRole('button', { name: 'Play online' }).click();
    await expect(page.getByRole('button', { name: 'Create room' })).toBeVisible();
    await expect(page.getByText('Fine-tune Your Challenge')).toBeVisible();

    // The room took the place of the local-only settings and of the local
    // Start button; the command bar now says when the first turn begins.
    await expect(page.getByText('Terms of Engagement')).toBeHidden();
    await expect(page.getByRole('button', { name: '🏛️ Start Game' })).toBeHidden();
    await expect(page.getByText('The game starts when your friends open their links.')).toBeVisible();

    // Stepping back to the local table restores the local flow.
    await page.getByRole('button', { name: 'On this device' }).click();
    await expect(page.getByRole('button', { name: '🏛️ Start Game' })).toBeVisible();
    await expect(page.getByText('Terms of Engagement')).toBeVisible();
    await expect(page.getByText('The game starts when your friends open their links.')).toBeHidden();
  });

  test('offline grays the online choice out', async ({ page, context }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Choose Your Civilization' })).toBeVisible();
    await page.getByRole('button', { name: 'Next →' }).click();

    const online = page.getByRole('button', { name: 'Play online' });
    await expect(online).toBeEnabled();

    // Connected → choosing the room works.
    await online.click();
    await expect(page.getByRole('button', { name: 'Create room' })).toBeVisible();

    // Lose the connection: the choice goes gray and says why, and the wizard
    // falls back to the local table instead of showing a dead room.
    await context.setOffline(true);
    await expect(online).toBeDisabled();
    await expect(online).toContainText('offline');
    await expect(page.getByText('Terms of Engagement')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create room' })).toBeHidden();

    // Back online: the choice lights up again.
    await context.setOffline(false);
    await expect(online).toBeEnabled();
  });
});
