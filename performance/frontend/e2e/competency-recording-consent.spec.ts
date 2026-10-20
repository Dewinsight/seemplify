import { expect, test, Page } from '@playwright/test';

// Actual rendered consent component; the gateway boundary is deliberately mocked.
// Participant identity, persistence and provider side effects are tested separately.
const meetingId='6ad000000000000000000001';
const base=`/one-on-ones/${meetingId}/call/recording-consent`;
type State={required:boolean;noticeVersion:string;ownRole:'manager'|'employee'|null;manager:{acceptedAt?:string;revokedAt?:string};employee:{acceptedAt?:string;revokedAt?:string};state:string;canAcknowledge:boolean;canStart:boolean;canWithdraw:boolean;canStop?:boolean;canAddNow?:boolean;windowClosed?:boolean;cancellationPending?:boolean};
async function setup(page:Page,patch:Partial<State>={},options:{readFailure?:boolean;cancelFailure?:boolean}={}){
 const state:State={required:true,noticeVersion:'nylas-recording-v1',ownRole:'manager',manager:{},employee:{},state:'awaiting_consent',canAcknowledge:true,canStart:false,canWithdraw:false,...patch};
 const posts:{path:string;body:Record<string,unknown>}[]=[];let failRead=!!options.readFailure;let failedCancellation=false;
 const user={id:state.ownRole==='employee'?'employee':'manager',sub:state.ownRole==='employee'?'employee':'manager',name:'Synthetic Participant',email:'synthetic@example.test'};const org={id:'org',name:'Synthetic Consent QA',role:'employee'};
 await page.addInitScript(()=>localStorage.setItem('accessToken','synthetic-recording-consent-ui'));
 await page.route('**/__mock-api/**',async route=>{const path=new URL(route.request().url()).pathname.replace('/__mock-api','');const method=route.request().method();let data:unknown=[];
  if(path==='/auth/me'){await route.fulfill({json:{success:true,user:{...user,organizations:[org]},currentOrganization:org,currentOrganizationId:org.id}});return;}
  if(path==='/user/context')data={user,organization:org,role:{name:'employee',isManager:false,isHRAdmin:false},teams:[],features:{},stats:{}};
  if(path===`/one-on-ones/${meetingId}`)data={_id:meetingId,title:'Synthetic consent meeting',managerId:'manager',employeeId:'employee',managerInfo:{name:'Reviewer'},employeeInfo:{name:'Employee'},status:'scheduled',scheduledDate:'2026-12-01T12:00:00Z',duration:30,call:{mode:'calendar'}};
  if(path===`/one-on-ones/${meetingId}/call`)data=[{_id:meetingId,title:'Synthetic consent meeting',mode:'calendar',scheduledDate:'2026-12-01T12:00:00Z',duration:30,status:'scheduled',conferenceUrl:'https://meet.google.com/aaa-bbbb-ccc',integration:{recordingRequested:true,recordingState:state.state}}];
  if(path===`/one-on-ones/${meetingId}/call/connection`)data={connected:true,email:'calendar@example.test',provider:'google',connectUrl:'https://app.seemplifyai.com/settings/calendar'};
  if(path===base&&method==='GET'){if(failRead){await route.fulfill({status:503,json:{error:'Read unavailable'}});return;}data=state;}
  if(path.startsWith(base)&&method==='POST'){const body=route.request().postDataJSON();posts.push({path,body});if(path.endsWith('/start')){state.state='scheduling';state.canStart=false;}else if(body.acknowledged){state[state.ownRole!].acceptedAt='2026-10-19T10:00:00Z';state.canAcknowledge=false;state.canWithdraw=true;}else{if(options.cancelFailure&&state.cancellationPending&&!failedCancellation){failedCancellation=true;await route.fulfill({status:502,json:{error:'Provider cancellation is pending. Please retry.'}});return;}state[state.ownRole!].revokedAt='2026-10-19T11:00:00Z';state.state='revoked';state.canWithdraw=false;state.cancellationPending=options.cancelFailure&&posts.length===1;}data=state;}
  await route.fulfill({json:{success:true,data}});
 });
 await page.goto(`/one-on-ones/${meetingId}`);return{state,posts,allowRead:()=>{failRead=false;}};
}

for (const ownRole of ['manager', 'employee'] as const) {
 test(`${ownRole} sees notetaker status without permission prompts`, async ({ page }, info) => {
  await setup(page, { ownRole, state: 'scheduled', canAcknowledge: false, canStart: false, canStop: true });
  await expect(page.getByRole('heading', { name: 'Meeting notetaker', exact: true })).toBeVisible();
  await expect(page.getByText('The notetaker is scheduled.', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /I agree/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /permission/ })).toHaveCount(0);
  await expect(page.getByText(/Reviewer:|Employee:|Waiting for agreement/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Stop notetaker', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath(`notetaker-${ownRole}.png`), fullPage: true });
 });
 test(`${ownRole} can add the notetaker without another participant agreeing`, async ({ page }) => {
  const fixture = await setup(page, { ownRole, canAcknowledge: false, canStart: true, canAddNow: true });
  await page.getByRole('button', { name: 'Add notetaker to call', exact: true }).click();
  expect(fixture.posts).toEqual([{ path: `${base}/start`, body: { joinNow: true } }]);
  await expect(page.getByText('Scheduling the notetaker. Please wait before retrying.')).toBeVisible();
 });
}
test('stopping a notetaker sends no permission declarations', async ({ page }) => {
 const fixture = await setup(page, { state: 'scheduled', canStop: true });
 await page.getByRole('button', { name: 'Stop notetaker', exact: true }).click();
 expect(fixture.posts).toEqual([{ path: `${base}/stop`, body: {} }]);
 await expect(page.getByText('The notetaker was stopped.', { exact: true })).toBeVisible();
});
test('closed recording window has no scheduling or permission control on mobile', async ({ page }) => {
 await page.setViewportSize({ width: 390, height: 844 });
 await setup(page, { canAcknowledge: false, canStart: false, windowClosed: true });
 await expect(page.getByText(/The scheduled recording window has ended/)).toBeVisible();
 await expect(page.getByRole('button', { name: /Add notetaker|Schedule notetaker|permission/ })).toHaveCount(0);
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
test('failed notetaker read allows recovery without showing permission prompts', async ({ page }) => {
 const fixture = await setup(page, {}, { readFailure: true });
 await expect(page.getByText('Notetaker status is unavailable. Please retry.')).toBeVisible();
 fixture.allowRead(); await page.getByRole('button', { name: 'Retry', exact: true }).click();
 await expect(page.getByRole('heading', { name: 'Meeting notetaker', exact: true })).toBeVisible();
});
