// Disposable full-application acceptance environment. Never imported by app.js.
// The login bridge exists only on this loopback listener, with synthetic IdP claims.
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const http = require('node:http');
const { randomUUID, createHmac } = require('node:crypto');
const signature = require('cookie-signature');

const ORG = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const FOREIGN_ORG = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const actors = ['employee', 'peer', 'team_lead', 'manager', 'hr_manager', 'admin', 'owner', 'department_head', 'teamless', 'foreign', 'parent_manager', 'child_lead', 'hierarchy_staff', 'unmanaged'];
const ids = Object.fromEntries(actors.map((role) => [role, `acceptance-${role}`]));
const sessions = new Map();
let accessRoles;
let buildPerformanceDirectory;
let buildPerformanceColleagues;

function performancePermissions(actor) {
  const keys = new Set(['employee']);
  if (['owner', 'admin'].includes(actor)) keys.add(`organization_${actor}`);
  else if (['hr_manager', 'department_head', 'team_lead'].includes(actor)) keys.add(actor);
  else if (['manager', 'parent_manager'].includes(actor)) keys.add('line_manager');
  else if (actor === 'child_lead') keys.add('team_lead');
  const selected = accessRoles.filter(role => keys.has(role.key));
  const denied = new Set(selected.flatMap(role => role.denies.filter(row => row.appId === 'performance-management').flatMap(row => row.permissions)));
  return [...new Set(selected.flatMap(role => role.grants.filter(row => row.appId === 'performance-management').flatMap(row => row.permissions)))].filter(permission => !denied.has(permission));
}

function principal(actor) {
  const organizationId = actor === 'foreign' ? FOREIGN_ORG : ORG;
  const role = ['hr_manager', 'admin', 'owner'].includes(actor) ? actor : 'employee';
  const organization = { id: organizationId, name: 'Disposable acceptance organization', role, appAccess: { mode: 'all', appIds: [] },
    authorization: { permissionsByApp: { 'performance-management': performancePermissions(actor) } },
    ...(actor === 'department_head' ? { departmentHeadPermissions: [{ id: 'acceptance-department', name: 'Operations' }] } : {}) };
  const teams = actor === 'teamless' ? [] : [{ id: 'acceptance-team', name: 'Acceptance team', organizationId, departmentId: 'acceptance-department',
    role: actor === 'manager' ? 'line_manager' : actor === 'team_lead' ? 'team_lead' : 'member',
    isManager: actor === 'manager', managerId: ids.manager, managerName: 'Acceptance Manager', managerEmail: 'manager@example.test',
    ...(['manager', 'team_lead', 'department_head'].includes(actor) ? { directReports: [ids.employee, ids.peer] } : {}) }];
  // Additional hierarchy actors are isolated from the established flat team.
  // Parent-manager claims deliberately contain no directReports; authority is
  // derived by the real IdP directory builder from active nested membership.
  const hierarchyTeams = {
    parent_manager: { id: 'hierarchy-parent', role: 'line_manager', isManager: true },
    child_lead: { id: 'hierarchy-child', parentTeamId: 'hierarchy-parent', role: 'team_lead', isManager: true },
    hierarchy_staff: { id: 'hierarchy-leaf', parentTeamId: 'hierarchy-child', role: 'member' },
    unmanaged: { id: 'hierarchy-unmanaged', role: 'member', departmentId: 'unmanaged-department' }
  };
  const hierarchy = hierarchyTeams[actor];
  const selectedTeams = hierarchy ? [{ organizationId, name: hierarchy.id, departmentId: 'acceptance-department', ...hierarchy }] : teams;
  return { id: ids[actor], sub: ids[actor], name: `Acceptance ${actor.replaceAll('_', ' ')}`, email: `${actor}@example.test`,
    organizations: [organization], currentOrganization: organization, teams: selectedTeams, idpTeams: selectedTeams,
    accessToken: `disposable-acceptance-${actor}` };
}

function directoryFor(actor, view, search) {
  const organizationId = actor === 'foreign' ? FOREIGN_ORG : ORG;
  const members = actors.filter(value => (value === 'foreign') === (actor === 'foreign')).map(value => {
    const user = principal(value);
    return { account: { _id: user.sub, sub: user.sub, email: user.email, profile: { name: user.name } }, role: user.currentOrganization.role, status: 'active', department: 'acceptance-department' };
  });
  const organization = { _id: organizationId, owner: actor === 'foreign' ? ids.foreign : ids.owner, members,
    departments: [{ _id: 'acceptance-department', name: 'Operations', headAccount: ids.department_head }] };
  const teamMap = new Map();
  for (const value of actors.filter(value => (value === 'foreign') === (actor === 'foreign'))) {
    for (const team of principal(value).idpTeams) {
      if (!teamMap.has(team.id)) teamMap.set(team.id, { _id: team.id, name: team.name, organization: organizationId,
        department: team.departmentId, parentTeam: team.parentTeamId, members: [] });
      teamMap.get(team.id).members.push({ account: ids[value], status: 'active', role: team.role });
    }
  }
  const teams = [...teamMap.values()];
  if (search) return buildPerformanceColleagues({ organization, actorId: ids[actor],
    authorization: principal(actor).currentOrganization.authorization, q: search.q, userId: search.userId, action: search.action, limit: search.limit });
  return buildPerformanceDirectory({ organization, teams, actorId: ids[actor], view });
}

async function start() {
  if (process.env.NODE_ENV === 'production') throw new Error('Acceptance fixtures cannot run in production');
  // Mirror the actual IdP claim and directory contracts, not a product-side
  // authorization bypass. These imports are dependency-free IdP definitions.
  ({ DEFAULT_ACCESS_ROLES: accessRoles } = await import('../../../../Identityprovider/src/config/accessControlCatalog.js'));
  ({ buildPerformanceDirectory } = await import('../../../../Identityprovider/src/utils/performanceDirectory.js'));
  ({ buildPerformanceColleagues } = await import('../../../../Identityprovider/src/utils/performanceColleagues.js'));
  // Ordinary appraisal + competency links/finalisation are transactional in
  // production. Exercise those fences with a real disposable replica set.
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  // Set every operational value before loading the application; no local .env services are used.
  Object.assign(process.env, { NODE_ENV: 'test', MONGO_URI: mongo.getUri('performance_acceptance'),
    FRONTEND_URL: 'http://127.0.0.1:5015', SESSION_SECRET: 'disposable-acceptance-only', DISABLE_BACKGROUND_WORKERS: 'true',
    IDP_ISSUER_URL: 'http://127.0.0.1:5014/__no_external_identity', SEEMPLIFY_SHARED_AI_URL: 'http://127.0.0.1:5014/__no_external_ai',
    PERFORMANCE_AI_SHARED_SECRET: 'disposable-loopback-shared-service-only',
    TIME_ATTENDANCE_PRESENCE_URL: 'http://127.0.0.1:5014/__no_external_presence' });
  const app = require('../../app');
  await mongoose.connection.asPromise();
  const User = require('../../models/User');
  for (const actor of actors) {
    const user = principal(actor);
    await User.create({ idpSub: user.id, email: user.email, profile: { displayName: user.name },
      currentOrganizationId: user.currentOrganization.id, idpTeams: user.teams,
      organizationMemberships: [{ organization: user.currentOrganization.id, role: user.currentOrganization.role, isActive: true }] });
    const sessionId = randomUUID();
    const expires = new Date(Date.now() + 8 * 3600000);
    await mongoose.connection.db.collection('sessions').insertOne({ _id: sessionId, expires,
      session: JSON.stringify({ cookie: { originalMaxAge: 8 * 3600000, expires, httpOnly: true, path: '/', sameSite: 'lax' },
        user, currentOrganizationId: user.currentOrganization.id }) });
    sessions.set(actor, `connect.sid=${encodeURIComponent(`s:${signature.sign(sessionId, process.env.SESSION_SECRET)}`)}`);
  }
  // Retain production indexes in every acceptance journey.
  await Promise.all(Object.values(mongoose.models).map((model) => model.createIndexes()));
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1:5014');
    const calendarPath = '/api/internal/ai/v1/meetings/connection';
    if (url.pathname === `/__no_external_ai${calendarPath}` && req.method === 'POST') {
      // Substitute the external calendar account boundary, while the real
      // product route still performs RBAC, identity resolution and signed HTTP.
      // This fixture represents a healthy service with no connected calendar.
      let raw = '';
      req.setEncoding('utf8');
      req.on('data', chunk => { raw += chunk; });
      req.on('end', () => {
        let identity;
        try { identity = JSON.parse(raw).identity; } catch { /* denied below */ }
        const actor = actors.find(value => ids[value] === identity?.sub);
        const canonical = `${req.headers['x-seemplify-timestamp']}\n${req.headers['x-seemplify-nonce']}\nperformance-management\nPOST\n${calendarPath}\n${raw}`;
        const expected = createHmac('sha256', process.env.PERFORMANCE_AI_SHARED_SECRET).update(canonical).digest('hex');
        const valid = actor && identity.email === principal(actor).email
          && identity.organizationId === principal(actor).currentOrganization.id
          && req.headers['x-seemplify-service'] === 'performance-management'
          && req.headers['x-seemplify-signature'] === expected;
        res.writeHead(valid ? 200 : 403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(valid ? { connected: false, email: null, provider: null } : { error: 'Synthetic calendar identity/signature denied' }));
      });
      return;
    }
    if (url.pathname.startsWith('/__no_external_identity/api/organizations/')) {
      const actor = actors.find(value => req.headers.authorization === `Bearer disposable-acceptance-${value}`);
      const prefix = actor && `/__no_external_identity/api/organizations/${principal(actor).currentOrganization.id}`;
      if (!actor || ![`${prefix}/performance-directory`, `${prefix}/performance-colleagues`].includes(url.pathname)) {
        res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Synthetic directory access denied' }));
      }
      try {
        const search = url.pathname.endsWith('/performance-colleagues') ? { q: url.searchParams.get('q'),
          userId: url.searchParams.get('userId') ?? undefined, action: url.searchParams.get('action') ?? undefined, limit: url.searchParams.get('limit') } : null;
        const result = directoryFor(actor, url.searchParams.get('scope'), search);
        res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(result));
      } catch (error) {
        res.writeHead(error.status || 503, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Synthetic directory request denied' }));
      }
    }
    if (url.pathname === '/__test/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ready: true, actors }));
    }
    if (url.pathname.startsWith('/__test/login/')) {
      const actor = url.pathname.split('/').pop();
      if (!sessions.has(actor)) { res.writeHead(404); return res.end(); }
      const destination = url.searchParams.get('path') || '/dashboard';
      if (!destination.startsWith('/') || destination.startsWith('//')) { res.writeHead(400); return res.end(); }
      res.writeHead(302, { 'Set-Cookie': `${sessions.get(actor)}; Path=/; HttpOnly; SameSite=Lax`,
        Location: `http://127.0.0.1:5015${destination}#access_token=disposable-fixture` });
      return res.end();
    }
    // The executable script client uses the same real session cookie as the browser bridge.
    if (req.headers['x-acceptance-actor']) {
      req.headers.cookie = sessions.get(req.headers['x-acceptance-actor']) || '';
      delete req.headers['x-acceptance-actor'];
    }
    app(req, res);
  });
  await new Promise((resolve) => server.listen(5014, '127.0.0.1', resolve));
  require('../../services/websocketService').initWebSocket(server);
  console.log('Disposable acceptance server ready on http://127.0.0.1:5014 (real routes, real indexes, synthetic identities)');
  const close = async () => { server.close(); await mongoose.disconnect(); await mongo.stop(); process.exit(0); };
  process.once('SIGTERM', close); process.once('SIGINT', close);
}

start().catch((error) => { console.error(error); process.exit(1); });
