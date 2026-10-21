import { expect, test, type Locator, type Page } from '@playwright/test';

const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.stack || error.message));
});
test.afterEach(async ({ page }, info) => {
  const errors = browserErrors.get(page) || [];
  if (errors.length) await info.attach('uncaught-browser-errors', { body: errors.join('\n\n'), contentType: 'text/plain' });
  expect(errors, 'Rendered design journeys must not raise uncaught browser errors').toEqual([]);
});

// This fixture substitutes transport only. All assertions exercise the rendered
// Performance app, including its real theme provider, controls and portal tree.
async function installDesignFixture(page: Page) {
  const user = { id: 'design-user', sub: 'design-user', name: 'Alex Morgan', email: 'alex@example.test' };
  const organization = { id: 'design-org', name: 'Synthetic design organization', role: 'owner' };
  const team = { id: 'design-team', name: 'Customer Success', organizationId: organization.id, role: 'line_manager', isManager: true };
  const colleague = { id: 'design-colleague', userId: 'design-colleague', name: 'Jordan Lee', email: 'jordan@example.test' };
  const domainWrites: Array<{ path: string; body: unknown }> = [];
  let failFeedback = false;
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => {
    localStorage.setItem('accessToken', 'synthetic-apple-design-token');
    if (!localStorage.getItem('seemplify_theme')) localStorage.setItem('seemplify_theme', 'light');
    const NativeWebSocket = window.WebSocket;
    class StableSocket {
      static OPEN = 1;
      readyState = 1;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;
      constructor() { window.setTimeout(() => this.onopen?.(new Event('open')), 0); }
      send() {}
      close() {}
    }
    Object.defineProperty(window, 'WebSocket', {
      configurable: true,
      value: new Proxy(NativeWebSocket, {
        construct(Target, args) {
          return String(args[0]).includes('/__mock-ws') ? new StableSocket() : Reflect.construct(Target, args);
        },
      }),
    });
  });
  await page.route('**/__mock-api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/__mock-api', '');
    const respond = (data: unknown) => route.fulfill({ json: { success: true, data } });
    if (path === '/auth/me') return route.fulfill({ json: { success: true, user: { ...user, organizations: [organization], idpOrganizations: [organization] }, currentOrganization: organization, currentOrganizationId: organization.id } });
    if (path === '/user/context') return respond({ user, organization, role: { name: 'hr_admin', displayName: 'HR Administrator', isManager: true, isHRAdmin: true, isTeamLead: true }, teams: [team], currentTeam: team, managerData: { directReportCount: 1 }, stats: {}, features: { canonicalAppraisals: true, continuousPerformance: true, canRequestFeedback: true, recognition: true, projectFeedback: true, competencyAssessments: true, notifications: false } });
    if (path === '/user/current-team') return respond({ currentTeam: team, availableTeams: [team] });
    if (path === '/user/my-team-members') return respond({ directReports: [colleague], teams: [], totalDirectReports: 1 });
    if (path === '/user/search') return respond([colleague]);
    if (path === '/dashboard/summary') return respond({ okrProgress: 35, totalOkrs: 1, completedOkrs: 0, pendingReviews: 0, recentFeedback: 2, upcomingDeadlines: 1 });
    if (path === '/appraisals/notifications/manager') return respond({ notifications: [{ appraisalId: 'design-appraisal', message: 'Jordan submitted a self-assessment.', employee: { name: 'Jordan Lee' }, sentAt: '2026-10-20T10:00:00.000Z' }] });
    if (path === '/notifications/count') return respond({ unread: 0, actionable: 0 });
    if (path === '/presence/sessions') return route.fulfill({ json: { success: true, sessionId: 'synthetic-design-presence' } });
    if (path === '/feedback' && request.method() === 'POST') {
      domainWrites.push({ path, body: request.postDataJSON() });
      if (failFeedback) return route.fulfill({ status: 503, json: { error: 'Synthetic feedback outage. Please retry.' } });
      return respond({ _id: 'design-feedback' });
    }
    return respond([]);
  });
  return { domainWrites, failFeedback: () => { failFeedback = true; } };
}

const header = (page: Page) => page.locator('nav').filter({ has: page.getByTestId('desktop-primary-navigation') });

async function chooseTheme(page: Page, theme: 'Light' | 'Dark') {
  await page.getByRole('button', { name: /^Appearance:/ }).click();
  await page.getByRole('menuitemradio', { name: theme, exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme.toLowerCase());
}

async function paint(locator: Locator) {
  return locator.evaluate(element => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color, opacity: style.opacity, transform: style.transform };
  });
}

function contrast(foreground: string, background: string) {
  const luminance = (value: string) => {
    const channels = value.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(channel => {
      const linear = channel / 255;
      return linear <= 0.04045 ? linear / 12.92 : ((linear + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

async function noDocumentOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

for (const theme of ['Light', 'Dark'] as const) {
  test(`shared Tailwind and MUI controls and portal surfaces agree in ${theme.toLowerCase()} mode`, async ({ page }, info) => {
    await installDesignFixture(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/dashboard');
    await expect(page.locator('.suite-dashboard-title')).toBeVisible();
    await chooseTheme(page, theme);
    await page.getByRole('button', { name: 'Personal', exact: true }).click();
    await page.getByRole('menuitemradio', { name: /^Manager/ }).click();
    const startReview = page.getByRole('button', { name: 'Start review', exact: true });
    await expect(startReview).toBeVisible();
    const suiteAction = await paint(startReview);
    const suiteSurface = await paint(page.locator('.suite-metrics'));
    expect(contrast(suiteAction.color, suiteAction.background)).toBeGreaterThanOrEqual(4.5);
    await page.goto('/feedback');
    const give = page.getByRole('button', { name: 'Give feedback', exact: true }).first();
    await expect(give).toBeVisible();
    const muiAction = await paint(give);
    expect(muiAction.background).toBe(suiteAction.background);
    expect(muiAction.color).toBe(suiteAction.color);
    await give.click();
    const dialog = page.getByRole('dialog', { name: 'Give feedback', exact: true });
    await expect(dialog).toBeVisible();
    expect((await paint(dialog)).background).toBe(suiteSurface.background);
    await expect(dialog.getByRole('combobox', { name: /^Recipient/ })).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: /^Feedback\s*\*?$/ })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Send feedback', exact: true })).toBeDisabled();
    await page.screenshot({ path: info.outputPath(`feedback-portal-${theme.toLowerCase()}.png`) });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(give).toBeFocused();
    await noDocumentOverflow(page);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.toLowerCase());
    await expect(give).toBeVisible();
    expect((await paint(give)).background).toBe(suiteAction.background);
  });
}

test('desktop navigation opens from the keyboard and restores focus on Escape', async ({ page }) => {
  await installDesignFixture(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/dashboard');
  const trigger = page.getByTestId('desktop-primary-navigation').getByRole('button', { name: 'Growth', exact: true });
  await expect(trigger).toBeVisible();
  await trigger.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'Growth navigation' });
  await expect(menu).toBeVisible();
  const items = menu.getByRole('menuitem');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(items.last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.getByTestId('desktop-primary-navigation').getByRole('link', { name: 'Dashboard', exact: true })).toHaveAttribute('aria-current', 'page');
  await trigger.press('Enter');
  await expect(menu).toBeVisible();
  await items.last().focus();
  await page.keyboard.press('Tab');
  await expect(menu).toBeHidden();
  expect(await menu.evaluateAll(elements => elements.some(element => element.contains(document.activeElement)))).toBe(false);
});

test('mobile navigation contains focus, closes safely, and keeps narrow content usable', async ({ page }, info) => {
  const fixture = await installDesignFixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard');
  const trigger = page.getByRole('button', { name: 'Open menu', exact: true });
  await trigger.click();
  const navigation = page.getByRole('dialog', { name: /navigation|menu/i });
  await expect(navigation).toBeVisible();
  const controls = navigation.locator('a[href],button:not([disabled]):not([tabindex="-1"]),[tabindex="0"]');
  await controls.first().focus();
  await page.keyboard.press('Shift+Tab');
  await expect(controls.last()).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(controls.first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(navigation).toBeHidden();
  await expect(trigger).toBeFocused();
  await noDocumentOverflow(page);
  await trigger.click();
  await expect(navigation).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(navigation).toBeHidden();
  const desktopDashboard = page.getByTestId('desktop-primary-navigation').getByRole('link', { name: 'Dashboard', exact: true });
  await expect(desktopDashboard).toBeVisible();
  await desktopDashboard.focus();
  await expect(desktopDashboard).toBeFocused();
  expect(await page.getByRole('main').evaluate(element => element.closest('[inert]') === null)).toBe(true);
  expect(await page.locator('body').evaluate(element => element.style.overflow)).not.toBe('hidden');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/feedback');
  await page.getByRole('button', { name: 'Give feedback', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Give feedback', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
  await noDocumentOverflow(page);
  await page.screenshot({ path: info.outputPath('feedback-mobile.png') });
  expect(fixture.domainWrites).toEqual([]);
});

test('press feedback is immediate and releasing away cancels the action', async ({ page }) => {
  await installDesignFixture(page);
  await page.goto('/feedback');
  const give = page.getByRole('button', { name: 'Give feedback', exact: true }).first();
  await expect(give).toBeVisible();
  const bounds = (await give.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  const before = await paint(give);
  await page.mouse.down();
  const pressed = await paint(give);
  // Exclude hover-background changes: this must be feedback from the press.
  expect(pressed.opacity !== before.opacity || pressed.transform !== before.transform).toBe(true);
  await page.mouse.move(1, 300);
  await page.mouse.up();
  await expect(page.getByRole('dialog', { name: 'Give feedback', exact: true })).toHaveCount(0);
  await give.click();
  await expect(page.getByRole('dialog', { name: 'Give feedback', exact: true })).toBeVisible();
});

test('reduced motion and material preferences retain readable interactive controls', async ({ page }, info) => {
  await installDesignFixture(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/feedback');
  const give = page.getByRole('button', { name: 'Give feedback', exact: true }).first();
  await expect(give).toBeVisible();
  const durations = await give.evaluate(element => getComputedStyle(element).transitionDuration.split(',').map(value => parseFloat(value) * (value.trim().endsWith('ms') ? 1 : 1000)));
  expect(Math.max(...durations)).toBeLessThanOrEqual(10);
  await give.click();
  const dialog = page.getByRole('dialog', { name: 'Give feedback', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: /^Recipient/ })).toBeEnabled();
  await page.keyboard.press('Escape');
  const session = await page.context().newCDPSession(page);
  // These are independent accessibility signals, not one combined fallback.
  for (const preference of [
    { name: 'prefers-reduced-transparency', value: 'reduce', file: 'reduced-transparency' },
    { name: 'prefers-contrast', value: 'more', file: 'increased-contrast' },
  ]) {
    await session.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: preference.name, value: preference.value }] });
    const immediate = await header(page).evaluate((element, feature) => ({ matches: matchMedia(`(${feature.name}: ${feature.value})`).matches, blur: getComputedStyle(element).backdropFilter }), preference);
    await info.attach(`${preference.file}-immediate-state`, { body: JSON.stringify(immediate), contentType: 'application/json' });
    // CDP acknowledges the command before Chrome necessarily invalidates style.
    // Wait for the actual accessibility preference and its rendered fallback.
    await expect.poll(() => page.evaluate(feature => matchMedia(`(${feature.name}: ${feature.value})`).matches, preference), { timeout: 2000 }).toBe(true);
    await expect.poll(() => header(page).evaluate(element => getComputedStyle(element).backdropFilter), { timeout: 2000, message: `${preference.name} must remove chrome blur` }).toBe('none');
    const material = await header(page).evaluate(element => {
      const style = getComputedStyle(element);
      const components = style.backgroundColor.match(/[\d.]+/g)?.map(Number) || [];
      return { blur: style.backdropFilter, alpha: components.length > 3 ? components[3] : 1, border: parseFloat(style.borderBottomWidth) };
    });
    expect(material.blur).toBe('none');
    expect(material.alpha).toBeGreaterThanOrEqual(0.95);
    expect(material.border).toBeGreaterThan(0);
    await page.screenshot({ path: info.outputPath(`${preference.file}.png`) });
  }
  await session.detach();
});

test('a portal feedback failure preserves the draft and recovery controls', async ({ page }) => {
  const fixture = await installDesignFixture(page);
  fixture.failFeedback();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/feedback');
  await page.getByRole('button', { name: 'Give feedback', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Give feedback', exact: true });
  await dialog.getByRole('combobox', { name: /^Recipient/ }).fill('Jordan');
  await page.getByRole('option', { name: /Jordan Lee/ }).click();
  const message = dialog.getByRole('textbox', { name: /^Feedback\s*\*?$/ });
  await message.fill('You raised the launch dependency early and helped us keep the delivery on track.');
  const send = dialog.getByRole('button', { name: 'Send feedback', exact: true });
  await expect(send).toBeEnabled();
  await send.click();
  await expect(dialog.getByRole('alert')).toContainText('Synthetic feedback outage');
  await expect(message).toHaveValue('You raised the launch dependency early and helped us keep the delivery on track.');
  await expect(send).toBeEnabled();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
  await noDocumentOverflow(page);
  expect(fixture.domainWrites).toHaveLength(1);
});

test('sign-in error and an incomplete Identity handoff expose usable recovery', async ({ page }, info) => {
  await page.clock.install();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.route('**/__mock-api/**', route => {
    if (new URL(route.request().url()).pathname.endsWith('/auth/oidc/start')) {
      // A no-content navigation retains the original page but cannot finish
      // sign-in. Unlike an indefinitely paused route it does not block browser
      // automation from observing the timeout recovery UI.
      return route.fulfill({ status: 204, body: '' });
    }
    return route.fulfill({ status: 401, json: { error: 'Synthetic sign-in required' } });
  });
  await page.goto('/login?error=Synthetic%20identity%20error');
  const main = page.getByRole('main');
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
  await expect(main.getByRole('alert')).toHaveText('Synthetic identity error');
  const login = page.getByRole('button', { name: 'Login with Identity Provider', exact: true });
  await expect(login).toBeEnabled();
  const handoff = page.waitForResponse(response => response.url().includes('/auth/oidc/start'));
  await login.click();
  await handoff;
  await expect(main.getByRole('heading', { name: 'Redirecting to Login', exact: true })).toBeVisible();
  await page.clock.fastForward(15_100);
  await expect(main.getByRole('alert')).toContainText('Sign-in is taking too long');
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeEnabled();
  await expect(page.getByRole('link', { name: 'Back to App Hub', exact: true })).toBeVisible();
  await noDocumentOverflow(page);
  await page.screenshot({ path: info.outputPath('identity-timeout-dark.png') });
});
