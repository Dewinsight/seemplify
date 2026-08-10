import {expect,test,type Page,type Route} from '@playwright/test';
test.describe.configure({retries:0});
const password='Playwright-Test-Password-2026!';
async function signIn(page:Page){await page.goto('/login');await page.getByLabel('Email').fill('qa@seemplify.local');await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Sign in'}).click();await expect(page.getByRole('heading',{name:'Experience overview'})).toBeVisible();}
async function fulfill(route:Route,value:unknown){await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});}

test('manager uploads a logo, versions a profile, defaults it and pins a saved view on desktop',async({page},testInfo)=>{test.skip(testInfo.project.name!=='desktop-chromium','desktop manager proof');
  await signIn(page);await page.goto('/settings/space');const panel=page.getByTestId('journey-export-brand-settings');await expect(panel).toBeVisible();
  const stamp=Date.now();await panel.getByLabel('Profile name').fill(`Export brand ${stamp}`);await panel.getByLabel('Organisation name').fill('Seemplify Research');
  await panel.getByLabel('Logo alternative text').fill('Seemplify research wordmark');
  await panel.locator('input[type=file]').setInputFiles({name:'seemplify-logo.png',mimeType:'image/png',buffer:Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')});
  await expect(panel.getByLabel('Selected brand logo')).toHaveValue(/.+/u);await panel.getByRole('button',{name:'Create profile'}).click();
  await expect(panel.getByRole('button',{name:'Create version'})).toBeVisible();await panel.getByRole('button',{name:'Set as space default'}).click();
  await expect(panel.getByTestId('journey-export-brand-effective')).toContainText(`Export brand ${stamp}`);

  const created=await page.request.post('/api/journey-maps',{data:{name:`Brand binding map ${stamp}`,purpose:'Verify exact export branding',stageNames:['Discover','Decide']}});
  expect(created.status(),await created.text()).toBe(201);const definition=await created.json() as{id:string};await page.goto(`/journey-maps?map=${definition.id}`);
  const bar=page.getByTestId('journey-saved-view-bar');await expect(bar).toBeVisible();
  await bar.getByRole('button',{name:'Save current'}).click();const editor=page.getByTestId('journey-saved-view-editor');await editor.getByLabel('Name').fill('Branded review');
  await editor.getByTestId('journey-saved-view-submit').click();await expect(editor).toBeHidden();await bar.getByRole('button',{name:'Brand'}).click();
  const brand=page.getByTestId('journey-saved-view-brand-dialog');await expect(brand).toBeVisible();await brand.getByLabel('Brand source').selectOption('pinned');
  const pinnedValue=await brand.getByLabel('Profile version').locator('option').nth(1).getAttribute('value');expect(pinnedValue).toBeTruthy();
  await brand.getByLabel('Profile version').selectOption(pinnedValue!);const bindingResponse=page.waitForResponse((response)=>response.url().includes('/api/journey-export-brand/saved-views/')&&response.request().method()==='PUT');
  await brand.getByRole('button',{name:'Save binding'}).click();const bound=await bindingResponse;expect(bound.status(),await bound.text()).toBe(200);await expect(brand).toContainText('binding revision 1');
  await brand.getByText('Close',{exact:true}).click();await bar.getByRole('button',{name:'Brand'}).click();await expect(brand.getByLabel('Brand source')).toHaveValue('pinned');
  await expect(brand.getByLabel('Profile version')).toHaveValue(/.+:1/u);});

test('member sees effective branding without mutation controls on mobile',async({page},testInfo)=>{test.skip(testInfo.project.name!=='mobile-chromium','mobile member proof');
  await page.route('**/api/auth/session',async(route)=>{const response=await route.fetch(),body=await response.json();if(body?.authenticated&&body.activeSpace)body.activeSpace.role='member';
    if(body?.authenticated&&body.subscription?.features)body.subscription.features.journeyExports=true;await route.fulfill({response,json:body});});
  await page.route('**/api/journey-export-brand/access',route=>fulfill(route,{canRead:true,canEdit:false,canManageViews:false,canExport:true}));
  await page.route('**/api/journey-export-brand/profiles',route=>fulfill(route,{profiles:[{profile:{id:'profile-mobile',name:'Member-visible brand',state:'active',currentVersion:3,revision:4,
    createdAt:'2026-08-08T10:00:00.000Z',updatedAt:'2026-08-08T11:00:00.000Z',retiredAt:null},version:{profileId:'profile-mobile',version:3,organisationName:'Member organisation',logoAssetId:null,
    primaryHex:'#292524',accentHex:'#B45309',backgroundHex:'#FFFFFF',textHex:'#1C1917',fontFamily:'Aptos',footerText:'Research export',locale:'en-GB',contentSha256:'a'.repeat(64),createdAt:'2026-08-08T11:00:00.000Z'}}],
    assets:[],settings:{defaultProfileId:'profile-mobile',defaultProfileVersion:3,revision:2,updatedAt:'2026-08-08T11:00:00.000Z'}}));
  await signIn(page);await page.goto('/settings/space');const panel=page.getByTestId('journey-export-brand-settings');await expect(panel).toBeVisible();
  await expect(panel.getByTestId('journey-export-brand-effective')).toContainText('Member-visible brand, version 3');await expect(panel.getByText('Member organisation')).toBeVisible();
  await expect(panel.getByRole('button',{name:'New profile'})).toHaveCount(0);await expect(panel.getByRole('button',{name:'Create version'})).toHaveCount(0);
  await panel.scrollIntoViewIfNeeded();await expect(panel).toBeInViewport();});
