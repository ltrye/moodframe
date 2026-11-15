import { expect, test } from '@playwright/test';

test('Tauri controls render binary frames, accept input, and close cleanly', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/tests/player.html');
  await expect(page.getByRole('button', { name: 'Play (Space)', exact: true })).toBeEnabled();
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Open.*player/i })).toHaveCount(0);
  await page.getByRole('button', { name: 'Play (Space)', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause (Space)' })).toBeVisible();
  await page.getByRole('button', { name: 'Next frame (Right)' }).click();
  await expect(page.locator('.media-frame-number')).toHaveText('Frame 2 / 72');
  await page.getByRole('button', { name: 'Mute', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Volume', exact: true })).toHaveValue('0');
  await page.getByRole('button', { name: 'Unmute', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Volume', exact: true })).toHaveValue('0.25');
  await page.getByRole('button', { name: 'Loop playback' }).click();
  await expect(page.getByRole('button', { name: 'Loop playback' })).toHaveAttribute('aria-pressed', 'false');
  const timeline = page.getByRole('slider', { name: 'Video timeline' });
  await timeline.focus(); await page.keyboard.press('End');
  await expect(page.locator('.media-frame-number')).toHaveText('Frame 72 / 72');
  const ordered = await page.evaluate(() => (window as any).mediaTest.commands.filter((c: any) => c.action === 'controlVideo').map((c: any) => c.control));
  expect(ordered.slice(-2)).toEqual(['preview', 'finishScrub']);
  await page.locator('.media-stage').focus(); await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Pause (Space)' })).toBeVisible();
  await page.locator('.media-player').screenshot({ path: 'artifacts/tauri-player-controls.png' });
  await page.setViewportSize({ width: 720, height: 600 });
  await expect.poll(() => page.locator('.media-controls').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.locator('.media-player').screenshot({ path: 'artifacts/tauri-player-compact.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Video player' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).mediaTest.commands.filter((c: any) => c.action === 'closeVideo').length)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('WebGL reproduces YUV colors, handles RGBA, and bounds its texture cache', async ({ page }) => {
  await page.goto('/tests/player.html');
  await expect(page.getByRole('button', { name: 'Play (Space)', exact: true })).toBeEnabled();
  const result = await page.evaluate(() => {
    const api = (window as any).mediaTest, canvas = document.createElement('canvas');
    const renderer = new api.FrameRenderer(canvas, 100);
    const sample = (format: string, identity: string) => {
      renderer.draw(api.decodeFrame(api.solidFrame('test', format, identity)));
      const gl = canvas.getContext('webgl2')!, pixels = new Uint8Array(4);
      gl.readPixels(1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL rendering failed');
      return [...pixels];
    };
    const yuv = sample('yuv420', 'a'), rgba = sample('rgba', 'b');
    for (let i = 0; i < 20; i++) sample('yuv420', String(i));
    const stats = renderer.stats; renderer.dispose();
    const replacement = new api.FrameRenderer(canvas); replacement.draw(api.decodeFrame(api.solidFrame('test'))); replacement.dispose();
    let malformed = false; try { api.decodeFrame(new ArrayBuffer(3)); } catch { malformed = true; }
    return { yuv, rgba, stats, malformed };
  });
  expect(result.rgba).toEqual([120, 90, 240, 255]);
  const expected = [201, 61, 33, 255];
  result.yuv.forEach((value: number, index: number) => expect(Math.abs(value - expected[index])).toBeLessThanOrEqual(2));
  expect(result.stats.gpuBytes).toBeLessThanOrEqual(100); expect(result.stats.cachedFrames).toBeLessThan(6);
  expect(result.malformed).toBe(true);
});

test('media errors stay in the Tauri overlay', async ({ page }) => {
  await page.goto('/tests/player.html');
  await expect(page.getByRole('button', { name: 'Play (Space)', exact: true })).toBeEnabled();
  await page.evaluate(() => (window as any).mediaTest.error('Unsupported test codec'));
  await expect(page.getByRole('alert')).toHaveText('Unsupported test codec');
});
