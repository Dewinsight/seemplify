// Disposable full-application acceptance environment. Never imported by app.js.
// The login bridge exists only on this loopback listener, with synthetic IdP claims.
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const signature = require('cookie-signature');

const ORG = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const FOREIGN_ORG = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const actors = ['employee', 'peer', 'team_lead', 'manager', 'hr_manager', 'admin', 'owner', 'department_head', 'teamless', 'foreign'];
const ids = Object.fromEntries(actors.map((role) => [role, `acceptance-${role}`]));
const sessions = new Map();

function principal(actor) {
  const organizationId = actor === 'foreign' ? FOREIGN_ORG : ORG;
  const role = ['hr_manager', 'admin', 'owner'].includes(actor) ? actor : 'employee';
  const organization = { id: organizationId, name: 'Disposable acceptance organization', role, appAccess: { mode: 'all', appIds: [] },
    ...(actor === 'department_head' ? { departmentHeadPermissions: [{ id: 'acceptance-department', name: 'Operations' }] } : {}) };
  const teams = actor === 'teamless' ? [] : [{ id: 'acceptance-team', name: 'Acceptance team', organizationId, departmentId: 'acceptance-department',
    role: actor === 'manager' ? 'line_manager' : actor === 'team_lead' ? 'team_lead' : 'member',
    isManager: actor === 'manager', managerId: ids.manager, managerName: 'Acceptance Manager', managerEmail: 'manager@example.test',
    ...(['manager', 'team_lead', 'department_head'].includes(actor) ? { directReports: [ids.employee, ids.peer] } : {}) }];
  return { id: ids[actor], sub: ids[actor], name: `Acceptance ${actor.replaceAll('_', ' ')}`, email: `${actor}@example.test`,
    organizations: [organization], currentOrganization: organization, teams, idpTeams: teams };
}

async function start() {
  if (process.env.NODE_ENV === 'production') throw new Error('Acceptance fixtures cannot run in production');
  const mongo = await MongoMemoryServer.create();
  // Set every operational value before loading the application; no local .env services are used.
  Object.assign(process.env, { NODE_ENV: 'test', MONGO_URI: mongo.getUri('performance_acceptance'),
    FRONTEND_URL: 'http://127.0.0.1:5015', SESSION_SECRET: 'disposable-acceptance-only', DISABLE_BACKGROUND_WORKERS: 'true',
    IDP_ISSUER_URL: 'http://127.0.0.1:5014/__no_external_identity', SEEMPLIFY_SHARED_AI_URL: 'http://127.0.0.1:5014/__no_external_ai',
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
