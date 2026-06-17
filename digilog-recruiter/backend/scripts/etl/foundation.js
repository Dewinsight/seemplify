// Foundation ETL: Atlas(smart_hr_db) -> Postgres for the core/auth entities.
//   Admin, User, Organization, OrganizationMember (merged), Department
//
// Idempotent (upsert on the preserved Mongo _id, or the org+user unique for
// members), dependency-ordered, and resilient to orphaned references.
//
//   node scripts/etl/foundation.js              # copy + verify
//   node scripts/etl/foundation.js --verify-only
const { prisma, getSource, closeSource, SOURCE_DB, oid, nz, asDate, safe } = require('./lib');

const VERIFY_ONLY = process.argv.includes('--verify-only');

// ---------------------------------------------------------------- copy phases

async function copyAdmins(db, stats) {
  const docs = await db.collection('admins').find({}).toArray();
  for (const d of docs) {
    const id = oid(d._id);
    const data = {
      email: d.email,
      password: d.password ?? null,
      name: d.name ?? '(unknown)',
      role: d.role ?? 'admin',
      permissions: d.permissions ?? null,
      authSource: d.authSource ?? 'local',
      idpAccountId: nz(d.idpAccountId),
      isActive: d.isActive ?? true,
      lastLogin: asDate(d.lastLogin),
      lastSsoLoginAt: asDate(d.lastSsoLoginAt),
      lastIdpSyncAt: asDate(d.lastIdpSyncAt),
      loginAttempts: d.loginAttempts ?? 0,
      lockUntil: asDate(d.lockUntil),
      resetPasswordOTP: d.resetPasswordOTP ?? null,
      resetPasswordOTPExpires: asDate(d.resetPasswordOTPExpires),
      resetPasswordAttempts: d.resetPasswordAttempts ?? 0,
      createdAt: asDate(d.createdAt) ?? new Date(),
    };
    await safe(stats, 'admins', () =>
      prisma.admin.upsert({ where: { id }, create: { id, ...data }, update: data }));
  }
}

async function copyUsers(db, stats, userIds) {
  const docs = await db.collection('users').find({}).toArray();
  for (const d of docs) {
    const id = oid(d._id);
    const data = {
      email: d.email,
      password: d.password ?? null,
      profile: d.profile ?? null,
      company: d.company ?? null,
      preferences: d.preferences ?? null,
      profileCompletion: d.profileCompletion ?? null,
      features: d.features ?? null,
      security: d.security ?? null,
      role: d.role ?? null,
      permissions: Array.isArray(d.permissions) ? d.permissions : [],
      isActive: d.isActive ?? true,
      lastLoginAt: asDate(d.lastLoginAt),
      loginCount: d.loginCount ?? 0,
      subscription: d.subscription ?? null,
      emailCapabilities: d.emailCapabilities ?? null,
      twoFactorEnabled: d.twoFactorEnabled ?? null,
      resetPasswordToken: nz(d.resetPasswordToken),
      resetPasswordExpires: asDate(d.resetPasswordExpires),
      lastPasswordChange: asDate(d.lastPasswordChange),
      hasCompletedOrganizationSetup: d.hasCompletedOrganizationSetup ?? null,
      defaultOrganizationId: oid(d.defaultOrganization),
      legacyOrganizations: d.organizations ?? null,
      calendarConnected: d.calendarConnected ?? null,
      calendarConnectedEmail: d.calendarConnectedEmail ?? null,
      calendarEmail: d.calendarEmail ?? null,
      calendarProvider: d.calendarProvider ?? null,
      nylasAccountId: oid(d.nylasAccountId),
      nylasGrantId: nz(d.nylasGrantId),
      nylasGrantStatus: d.nylasGrantStatus ?? null,
      grantConnectedAt: asDate(d.grantConnectedAt),
      lastGrantRefresh: asDate(d.lastGrantRefresh),
      lastGrantRevocation: asDate(d.lastGrantRevocation),
      idpAccessToken: d.idpAccessToken ?? null,
      idpTokenExpiry: asDate(d.idpTokenExpiry),
      idpTeams: d.idpTeams ?? null,
      idpTeamPermissions: d.idpTeamPermissions ?? null,
      // currentOrganizationId deferred to the back-fill phase (FK ordering)
      createdAt: asDate(d.createdAt) ?? new Date(),
    };
    await safe(stats, 'users', async () => {
      await prisma.user.upsert({ where: { id }, create: { id, ...data }, update: data });
      userIds.add(id);
    });
  }
}

async function copyOrganizations(db, stats, userIds, orgIds) {
  const docs = await db.collection('organizations').find({}).toArray();
  for (const d of docs) {
    const id = oid(d._id);
    const ownerId = oid(d.owner);
    const data = {
      name: d.name ?? '(unnamed)',
      description: d.description ?? null,
      industry: d.industry ?? null,
      size: d.size ?? null,
      website: d.website ?? null,
      logo: d.logo ?? null,
      idpOrganizationId: nz(d.idpOrganizationId),
      settings: d.settings ?? null,
      subscription: d.subscription ?? null,
      legacyUsers: d.users ?? null,
      ownerId: userIds.has(ownerId) ? ownerId : null,
      isActive: d.isActive ?? true,
      createdAt: asDate(d.createdAt) ?? new Date(),
    };
    await safe(stats, 'organizations', async () => {
      await prisma.organization.upsert({ where: { id }, create: { id, ...data }, update: data });
      orgIds.add(id);
    });
  }
}

async function backfillUserCurrentOrg(db, stats, userIds, orgIds) {
  const docs = await db.collection('users')
    .find({ currentOrganization: { $ne: null } }, { projection: { currentOrganization: 1 } })
    .toArray();
  for (const d of docs) {
    const id = oid(d._id);
    const orgId = oid(d.currentOrganization);
    if (!userIds.has(id) || !orgIds.has(orgId)) { stats.currentOrgSkipped = (stats.currentOrgSkipped || 0) + 1; continue; }
    await safe(stats, 'currentOrgLinked', () =>
      prisma.user.update({ where: { id }, data: { currentOrganizationId: orgId } }));
  }
}

async function copyMembers(db, stats, userIds, orgIds) {
  const seen = new Set();
  const rows = [];
  const push = (orgId, userId, m) => {
    if (!orgId || !userId) return;
    const key = `${orgId}|${userId}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      orgId, userId,
      role: m.role || 'member',
      status: m.status || 'active',
      invitedById: oid(m.invitedBy),
      joinedAt: asDate(m.joinedAt) || new Date(),
    });
  };

  const orgs = await db.collection('organizations').find({}, { projection: { members: 1 } }).toArray();
  for (const o of orgs) for (const m of (o.members || [])) push(oid(o._id), oid(m.user), m);

  const users = await db.collection('users').find({}, { projection: { organizationMemberships: 1 } }).toArray();
  for (const u of users) for (const m of (u.organizationMemberships || [])) push(oid(m.organization), oid(u._id), m);

  stats.membersMergedPairs = rows.length;
  for (const r of rows) {
    if (!userIds.has(r.userId) || !orgIds.has(r.orgId)) { stats.membersSkipped = (stats.membersSkipped || 0) + 1; continue; }
    const data = { role: r.role, status: r.status, invitedById: r.invitedById, joinedAt: r.joinedAt };
    await safe(stats, 'members', () =>
      prisma.organizationMember.upsert({
        where: { organizationId_userId: { organizationId: r.orgId, userId: r.userId } },
        create: { organizationId: r.orgId, userId: r.userId, ...data },
        update: data,
      }));
  }
}

async function copyDepartments(db, stats, userIds, orgIds) {
  const docs = await db.collection('departments').find({}).toArray();
  for (const d of docs) {
    const id = oid(d._id);
    const orgId = oid(d.organization);
    if (!orgIds.has(orgId)) { stats.departmentsSkipped = (stats.departmentsSkipped || 0) + 1; continue; }
    const createdById = oid(d.createdBy);
    const data = {
      name: d.name ?? '(unnamed)',
      description: d.description ?? null,
      isActive: d.isActive ?? true,
      organizationId: orgId,
      createdById: userIds.has(createdById) ? createdById : null,
      createdAt: asDate(d.createdAt) ?? new Date(),
    };
    await safe(stats, 'departments', () =>
      prisma.department.upsert({ where: { id }, create: { id, ...data }, update: data }));
  }
}

// ------------------------------------------------------------------- verify

async function verify(db) {
  console.log('\n================ DEEP VERIFICATION ================');

  // Direct parity for entities we copy in full.
  let allMatch = true;
  console.log('\n-- count parity (Mongo source vs Postgres) --');
  const direct = [
    ['admins', () => prisma.admin.count()],
    ['users', () => prisma.user.count()],
    ['organizations', () => prisma.organization.count()],
  ];
  for (const [name, pgCount] of direct) {
    const mongo = await db.collection(name).countDocuments();
    const pg = await pgCount();
    const ok = mongo === pg;
    if (!ok) allMatch = false;
    console.log(`  ${name.padEnd(15)} mongo=${String(mongo).padEnd(6)} pg=${String(pg).padEnd(6)} ${ok ? 'OK' : '*** MISMATCH ***'}`);
  }

  // Departments: parity must account for legitimately-skipped rows whose parent
  // organization no longer exists in the source (orphans we cannot FK-insert).
  const pgOrgIds = new Set((await prisma.organization.findMany({ select: { id: true } })).map((o) => o.id));
  const deptRefs = await db.collection('departments').find({}, { projection: { organization: 1 } }).toArray();
  const mongoDepts = deptRefs.length;
  const orphanDepts = deptRefs.filter((d) => !pgOrgIds.has(oid(d.organization))).length;
  const pgDepts = await prisma.department.count();
  const deptOk = pgDepts === mongoDepts - orphanDepts;
  if (!deptOk) allMatch = false;
  console.log(`  departments     mongo=${String(mongoDepts).padEnd(6)} pg=${String(pgDepts).padEnd(6)} (− ${orphanDepts} orphaned-org) ${deptOk ? 'OK' : '*** MISMATCH ***'}`);

  console.log('\n-- orphan / merge stats (source data quality, handled gracefully) --');
  const orgsNoOwner = await prisma.organization.count({ where: { ownerId: null } });
  const deptsNoCreator = await prisma.department.count({ where: { createdById: null } });
  const memberCount = await prisma.organizationMember.count();
  console.log(`  organizations w/o owner (nulled)     ${orgsNoOwner}`);
  console.log(`  departments w/o creator (nulled)     ${deptsNoCreator}`);
  console.log(`  departments skipped (no parent org)  ${orphanDepts}`);
  console.log(`  organization_members (merged rows)   ${memberCount}`);

  console.log('\n-- FK integrity (raw LEFT JOIN; must all be 0) --');
  const brokenDeptOrg = (await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM "Department" d LEFT JOIN "Organization" o ON d."organizationId"=o.id WHERE o.id IS NULL`))[0].n;
  const brokenMemOrg = (await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM "OrganizationMember" m LEFT JOIN "Organization" o ON m."organizationId"=o.id WHERE o.id IS NULL`))[0].n;
  const brokenMemUser = (await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM "OrganizationMember" m LEFT JOIN "User" u ON m."userId"=u.id WHERE u.id IS NULL`))[0].n;
  console.log(`  departments -> missing org           ${brokenDeptOrg}`);
  console.log(`  members -> missing org               ${brokenMemOrg}`);
  console.log(`  members -> missing user              ${brokenMemUser}`);
  const fkOk = brokenDeptOrg === 0 && brokenMemOrg === 0 && brokenMemUser === 0;

  console.log('\n-- spot checks (field-by-field, 3 random of each) --');
  let spotOk = true;
  for (const name of ['users', 'organizations']) {
    const sample = await db.collection(name).aggregate([{ $sample: { size: 3 } }]).toArray();
    for (const doc of sample) {
      const id = oid(doc._id);
      const row = name === 'users'
        ? await prisma.user.findUnique({ where: { id } })
        : await prisma.organization.findUnique({ where: { id } });
      if (!row) { spotOk = false; console.log(`  [${name}] ${id} MISSING in pg`); continue; }
      const field = name === 'users' ? 'email' : 'name';
      const match = (doc[field] ?? null) === (row[field] ?? null) && row._id === id;
      if (!match) spotOk = false;
      console.log(`  [${name}] ${id} ${field}="${row[field]}" _id==id:${row._id === id} ${match ? 'OK' : '*** DIFF ***'}`);
    }
  }

  console.log('\n==================================================');
  const verdict = allMatch && spotOk && fkOk;
  console.log(verdict ? '✅ VERIFICATION PASSED' : '❌ VERIFICATION FOUND ISSUES (see above)');
  return verdict;
}

// --------------------------------------------------------------------- main

(async () => {
  const { db } = await getSource();
  console.log(`ETL source: Atlas db="${SOURCE_DB}"  ->  target: Postgres (digilog)`);
  const stats = {};
  const userIds = new Set();
  const orgIds = new Set();

  if (!VERIFY_ONLY) {
    console.log('\n-- copying (dependency order) --');
    await copyAdmins(db, stats);          console.log(`  admins         ${stats.admins || 0}`);
    await copyUsers(db, stats, userIds);  console.log(`  users          ${stats.users || 0}`);
    await copyOrganizations(db, stats, userIds, orgIds); console.log(`  organizations  ${stats.organizations || 0}`);
    await backfillUserCurrentOrg(db, stats, userIds, orgIds); console.log(`  currentOrg link ${stats.currentOrgLinked || 0} (skipped ${stats.currentOrgSkipped || 0})`);
    await copyMembers(db, stats, userIds, orgIds); console.log(`  members        ${stats.members || 0} of ${stats.membersMergedPairs || 0} merged (skipped ${stats.membersSkipped || 0})`);
    await copyDepartments(db, stats, userIds, orgIds); console.log(`  departments    ${stats.departments || 0} (skipped ${stats.departmentsSkipped || 0})`);
    if (stats.failed) {
      console.log(`\n⚠️  ${stats.failed} row(s) failed:`);
      for (const e of stats.errors) console.log('   - ' + e);
    }
  }

  const ok = await verify(db);
  await closeSource();
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
})().catch(async (e) => {
  console.error('❌ ETL failed:', e);
  try { await closeSource(); await prisma.$disconnect(); } catch (_) {}
  process.exit(1);
});
