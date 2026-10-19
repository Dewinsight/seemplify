import { expect, test, type Page } from '@playwright/test';
// UI contract fixtures. Real Mongo persistence and configured ClamAV proof are separate suites.
const framework = { id: 'framework-version', versionId: 'framework-version', frameworkId: 'framework', name: 'Leadership', sourceType: 'internal', version: 1, status: 'published', revision: 2, criteria: [{ id: 'delivery', code: 'DEL', name: 'Delivery', description: 'Deliver reliable outcomes', levelIds: ['foundation', 'advanced'] }], levels: [{ id: 'foundation', label: 'Foundation', description: 'Works with guidance', order: 1 }, { id: 'advanced', label: 'Advanced', description: 'Works independently', order: 2 }] };
const publishedRole = { id: 'role', versionId: 'role-version', name: 'Delivery lead', version: 1, status: 'published', revision: 2, responsibilities: [{ id: 'resp', text: 'Deliver reliable work' }], requirements: [], criteria: [{ id: 'expectation', sourceType: 'internal', frameworkVersionId: 'framework-version', criterionId: 'delivery', expectedLevelId: 'advanced', weight: 1, required: true, evidenceRequired: true, rationaleRequired: true, responsibilityIds: ['resp'], requirementIds: [] }] };
async function setup(page: Page, { denied = false, stale = false, initialEnabled = true } = {}) {
    const org = { id: 'library-qa', name: 'Atlas Demo', role: 'hr_manager' };
    const user = { id: 'hr', sub: 'hr', name: 'Harper HR', email: 'hr@example.test', organizations: [org] };
    let role: any = null;
    let cycle: any = null;
    let fw: any = null;
    let staleOnce = stale;
    let enabled = initialEnabled;
    let settings = { revision: 0, callEvidenceEnabled: false, aiDraftsEnabled: false, mediaRetentionDays: null as number | null, evidenceRetentionDays: null as number | null, exportRetentionHours: 24, noticeText: '' };
    await page.addInitScript(() => localStorage.setItem('accessToken', 'synthetic-library-ux'));
    await page.route('**/__mock-api/**', async (route) => {
        const path = new URL(route.request().url()).pathname.replace('/__mock-api', '');
        const method = route.request().method();
        let data: unknown = [];
        if (path === '/auth/me') {
            await route.fulfill({ json: { success: true, user, currentOrganization: org, currentOrganizationId: org.id } });
            return;
        }
        if (path === '/user/context') {
            await route.fulfill({ json: { success: true, data: { user, organization: org, role: { name: 'hr_admin', isManager: true, isHRAdmin: true }, teams: [], features: {}, stats: {} } } });
            return;
        }
        if (path === '/competency/bootstrap')
            data = { enabled, canEnable: !denied, capabilities: { roleManage: !denied, frameworkManage: !denied, cycleManage: !denied, retentionManage: !denied, assessmentLaunch: !denied }, people: [], roles: [publishedRole], frameworks: [framework], strategies: [], cycles: cycle?.status === 'published' ? [cycle] : [], settings };
        if (path === '/organization-features' && method === 'PATCH') {
            expect(route.request().postDataJSON()).toEqual({ features: { competencyAssessments: true } });
            enabled = true; data = { features: { competencyAssessments: true } };
        }
        if (path === '/competency/settings') {
            if (method === 'PATCH') { expect(route.request().headers()['if-match']).toBe(`"${settings.revision}"`); settings = { ...settings, ...route.request().postDataJSON(), revision: settings.revision + 1 }; }
            data = settings;
        }
        if (path === '/competency/roles' && method === 'POST') {
            const body = route.request().postDataJSON();
            role = { id: 'created-role', revision: 1, name: body.name, versions: [{ ...body, id: 'created-version', versionId: 'created-version', revision: 1, version: 1, status: 'draft' }] };
            data = { ...role, draftVersion: role.versions[0] };
        }
        if (path === '/competency/roles/created-role')
            data = role;
        if (path === '/competency/roles/created-role/versions/created-version' && method === 'PATCH') {
            if (staleOnce) {
                staleOnce = false;
                await route.fulfill({ status: 409, json: { error: { code: 'REVISION_CONFLICT', message: 'This draft changed. Reload before saving.' } } });
                return;
            }
            role.versions[0] = { ...role.versions[0], ...route.request().postDataJSON(), revision: role.versions[0].revision + 1 };
            data = role.versions[0];
        }
        if (path.endsWith('/created-version/publish')) {
            role.versions[0].status = 'published';
            role.versions[0].revision++;
            role.revision++;
            data = role.versions[0];
        }
        if (path === '/competency/roles/created-role/versions' && method === 'POST') {
            const old = role.versions[0];
            const v = { ...old, id: 'draft-two', versionId: 'draft-two', version: 2, revision: 1, status: 'draft' };
            role.versions.unshift(v);
            role.revision++;
            data = v;
        }
        if (path === '/competency/imports' && method === 'POST')
            data = { id: 'imported', originalName: 'delivery-role.txt', extractedText: 'Delivery operations lead\nOwn reliable delivery.', extractedDraft: { name: 'Delivery operations lead', description: 'Own reliable delivery.', responsibilities: [], requirements: [], criteria: [] }, warnings: ['Source locations are unavailable. Check the original.'], extractionStatus: 'ready' };
        if (path === '/competency/imports/imported/confirm') {
            const body = route.request().postDataJSON();
            expect(body.reviewed).toBe(true);
            role = { id: 'created-role', name: body.draft.name, revision: 1, versions: [{ ...body.draft, id: 'created-version', version: 1, revision: 1, status: 'draft' }] };
            data = { ...role, draftVersion: role.versions[0] };
        }
        if (path === '/competency/frameworks' && method === 'POST') {
            const body = route.request().postDataJSON();
            fw = { id: 'created-framework', revision: 1, name: body.name, sourceType: body.sourceType, versions: [{ ...body, id: 'new-framework-version', version: 1, revision: 1, status: 'draft' }] };
            data = { ...fw, draftVersion: fw.versions[0] };
        }
        if (path === '/competency/frameworks/created-framework')
            data = fw;
        if (path === '/competency/cycles' && method === 'POST') {
            cycle = { ...route.request().postDataJSON(), id: 'created-cycle', revision: 1, status: 'draft' };
            data = cycle;
        }
        if (path === '/competency/cycles/created-cycle') {
            if (method === 'PATCH')
                cycle = { ...cycle, ...route.request().postDataJSON(), revision: cycle.revision + 1 };
            data = cycle;
        }
        if (path.endsWith('/created-cycle/validate'))
            data = { valid: true };
        if (path.endsWith('/created-cycle/publish')) {
            cycle = { ...cycle, status: 'published', revision: cycle.revision + 1 };
            data = cycle;
        }
        await route.fulfill({ json: { data, meta: { schemaVersion: '1' } } });
    });
    return { getRole: () => role, getCycle: () => cycle, getSettings: () => settings };
}
async function manualRole(page: Page) { await page.goto('/competency/roles/new'); await page.getByRole('button', { name: 'Create manually', exact: true }).click(); await page.getByRole('textbox', { name: 'Role name', exact: true }).fill('Operations lead'); await page.getByRole('textbox', { name: 'Summary', exact: true }).fill('Own accountable delivery.'); await page.getByRole('button', { name: 'Add responsibility', exact: true }).click(); await page.getByRole('textbox', { name: 'Responsibility 1', exact: true }).fill('Deliver reliable work.'); await page.getByRole('button', { name: 'Save draft', exact: true }).click(); await expect(page).toHaveURL(/roles\/created-role$/); }
test('manual role create, source-specific expectations, publish and new version', async ({ page }, info) => { const f = await setup(page); await manualRole(page); await page.getByRole('tab', { name: 'Expectations (0)' }).click(); await page.getByRole('button', { name: 'Add expectation', exact: true }).click(); await page.getByRole('combobox', { name: 'Expected level for expectation 1' }).click(); await page.getByRole('option', { name: 'Advanced', exact: true }).click(); await expect(page.getByText('Works independently', { exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Save draft', exact: true }).click(); await expect(page.getByText('All changes saved', { exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Review and publish', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Publish v1', exact: true }).click(); await expect(page.getByRole('button', { name: 'Create new version', exact: true })).toBeVisible(); expect(f.getRole().versions[0].status).toBe('published'); await page.getByRole('button', { name: 'Create new version', exact: true }).click(); await expect(page.getByRole('textbox', { name: 'Role name', exact: true })).toBeEnabled(); await expect(page.getByText('Draft v2', { exact: true })).toBeVisible(); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ animations: 'disabled', path: info.outputPath('role-editor-local-ui-contract.png'), fullPage: true }); });
test('upload review requires explicit human confirmation and allows editing extracted draft', async ({ page }) => { await setup(page); await page.goto('/competency/roles/new'); await page.getByRole('button', { name: 'Upload role description', exact: true }).click(); await page.getByLabel('Choose role description', { exact: true }).setInputFiles({ name: 'delivery-role.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic role') }); await expect(page.getByText('delivery-role.txt', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Save reviewed draft', exact: true })).toBeDisabled(); await page.getByRole('textbox', { name: 'Role name', exact: true }).fill('Reviewed delivery lead'); await page.getByRole('checkbox', { name: 'I have reviewed these role details' }).check(); await page.getByRole('button', { name: 'Save reviewed draft', exact: true }).click(); await expect(page).toHaveURL(/roles\/created-role$/); await expect(page.getByRole('textbox', { name: 'Role name', exact: true })).toHaveValue('Reviewed delivery lead'); });
test('stale role save preserves edits and exposes deliberate reload', async ({ page }) => { await setup(page, { stale: true }); await manualRole(page); await page.getByRole('textbox', { name: 'Summary', exact: true }).fill('Keep my unsaved text.'); await page.getByRole('button', { name: 'Save draft', exact: true }).click(); await expect(page.getByText('This draft changed. Reload before saving.', { exact: true })).toBeVisible(); await expect(page.getByRole('textbox', { name: 'Summary', exact: true })).toHaveValue('Keep my unsaved text.'); await page.getByRole('button', { name: 'Compare latest version', exact: true }).click(); await expect(page.getByRole('dialog', { name: 'Compare your draft with the latest version' })).toBeVisible(); await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(page.getByRole('textbox', { name: 'Summary', exact: true })).toHaveValue('Keep my unsaved text.'); });
test('framework native levels and criteria are practical forms, with no JSON editor', async ({ page }) => { await setup(page); await page.goto('/competency/frameworks/new'); await page.getByRole('textbox', { name: 'Framework name', exact: true }).fill('Internal leadership'); await page.getByRole('tab', { name: 'Native levels (0)' }).click(); await page.getByRole('button', { name: 'Add level', exact: true }).click(); await page.getByRole('textbox', { name: 'Level 1 label', exact: true }).fill('Independent'); await page.getByRole('textbox', { name: 'Level 1 description', exact: true }).fill('Plans and delivers independently.'); await page.getByRole('tab', { name: 'Criteria (0)' }).click(); await page.getByRole('button', { name: 'Add criterion', exact: true }).click(); await page.getByRole('textbox', { name: 'Criterion 1 code', exact: true }).fill('DEL'); await page.getByRole('textbox', { name: 'Criterion 1 name', exact: true }).fill('Delivery'); await page.getByRole('textbox', { name: 'Criterion 1 description', exact: true }).fill('Reliable delivery'); await page.getByRole('combobox', { name: 'Available levels for criterion 1' }).click(); await page.getByRole('option', { name: 'Independent', exact: true }).click(); await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Save draft', exact: true }).click(); await expect(page).toHaveURL(/frameworks\/created-framework$/); await expect(page.getByRole('textbox', { name: 'Framework name', exact: true })).toHaveValue('Internal leadership'); });
test('cycle internal-only setup uses explicit conversions then readiness and publish', async ({ page }, info) => { const fixture = await setup(page); await page.goto('/competency/cycles/new'); await page.getByRole('textbox', { name: 'Cycle name', exact: true }).fill('Q3 competency review'); await page.getByLabel('Assessment period starts', { exact: true }).fill('2026-07-01'); await page.getByLabel('Assessment period ends', { exact: true }).fill('2026-09-30'); await page.getByRole('checkbox', { name: 'Internal competencies', exact: true }).check(); await page.getByRole('combobox', { name: 'Internal competencies versions' }).click(); await page.getByRole('option', { name: /Leadership v1/ }).click(); await page.keyboard.press('Escape'); await page.getByRole('combobox', { name: 'Assessment role versions' }).click(); await page.getByRole('option', { name: 'Delivery lead v1' }).click(); await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Continue', exact: true }).click(); await page.getByRole('spinbutton', { name: 'Internal competencies weight' }).fill('1'); await page.getByRole('spinbutton', { name: 'Delivery: Foundation score (0–100)' }).fill('20'); await page.getByRole('spinbutton', { name: 'Delivery: Advanced score (0–100)' }).fill('100'); await page.getByRole('button', { name: 'Save draft', exact: true }).click(); await expect(page).toHaveURL(/cycles\/created-cycle$/); await page.getByRole('button', { name: 'Continue', exact: true }).click(); await page.getByRole('button', { name: 'Continue', exact: true }).click(); await page.getByRole('button', { name: 'Continue', exact: true }).click(); await page.getByRole('button', { name: 'Check readiness', exact: true }).click(); await expect(page.getByText(/Configuration is valid/)).toBeVisible(); await page.getByRole('button', { name: 'Publish cycle', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Publish cycle', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); expect(fixture.getCycle().selectedInputTypes).toEqual(['internal']); expect(fixture.getCycle().scoringConfig.normalization[0].levelScores).toEqual({ foundation: 20, advanced: 100 }); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ animations: 'disabled', path: info.outputPath('cycle-review-local-ui-contract.png'), fullPage: true }); });
test('configuration denied for staff; role mobile layout preserves primary action without overflow', async ({ page }, info) => { await setup(page, { denied: true }); await page.goto('/competency/roles/new'); await expect(page.getByText('You do not have permission to configure this area.')).toBeVisible(); await expect(page.getByRole('button', { name: 'Create manually' })).toHaveCount(0); });
test('mobile dark role form remains usable with long content and no horizontal overflow', async ({ page }, info) => { await page.setViewportSize({ width: 390, height: 844 }); await setup(page); await page.addInitScript(() => { localStorage.setItem('seemplify_theme', 'dark'); }); await page.goto('/competency/roles/new'); await page.getByRole('button', { name: 'Create manually', exact: true }).click(); await page.getByRole('textbox', { name: 'Role name', exact: true }).fill('Operations and delivery leadership'); await page.getByRole('button', { name: 'Add responsibility', exact: true }).click(); await page.getByRole('textbox', { name: 'Responsibility 1', exact: true }).fill('Coordinate a distributed team and communicate delivery outcomes clearly.'); await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ animations: 'disabled', path: info.outputPath('role-mobile-dark-local-ui-contract.png'), fullPage: true }); });
test('overview deliberately enables the organisation feature without enabling AI or recording',async({page})=>{await setup(page,{initialEnabled:false});await page.goto('/competency');await page.getByRole('button',{name:'Enable competency assessments',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('It does not create assessments, invite employees or enable recording and AI.');await page.getByRole('button',{name:'Enable for this organisation',exact:true}).click();await expect(page.getByText('Enabled',{exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Open assessments',exact:true})).toBeVisible();});
test('settings make optional AI and purpose/retention decisions explicit before CAS save',async({page},info)=>{const fixture=await setup(page);await page.goto('/competency/settings');await page.getByRole('switch',{name:'Allow AI assessment drafts',exact:true}).check();await page.getByRole('textbox',{name:'Assessment processing notice',exact:true}).fill('Synthetic pilot assessment evidence is reviewed by authorised assessors and retained for 30 days.');await page.getByRole('spinbutton',{name:'Assessment evidence retention (days)',exact:true}).fill('30');await page.getByRole('button',{name:'Review and save settings',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('AI assessment drafts: Allowed');await page.getByRole('button',{name:'Save settings',exact:true}).click();await expect(page.getByText('Settings saved',{exact:true})).toBeVisible();expect(fixture.getSettings().aiDraftsEnabled).toBe(true);expect(fixture.getSettings().callEvidenceEnabled).toBe(false);expect(fixture.getSettings().evidenceRetentionDays).toBe(30);await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({animations:'disabled',path:info.outputPath('settings-local-ui-contract.png'),fullPage:true});});
