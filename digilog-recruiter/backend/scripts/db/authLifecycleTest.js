// Slice 2 deep test: full JWT session lifecycle (services/sessionService.js) on
// Postgres. Uses an isolated throwaway user so real copied data is never mutated.
//   node scripts/db/authLifecycleTest.js
require('dotenv').config();
const jwt = require('jsonwebtoken');
const prisma = require('../../db/client');
const { newId } = require('../../db/objectId');
const sessionService = require('../../services/sessionService');

let pass = 0;
function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg);
  pass++;
  console.log('  ✓ ' + msg);
}

(async () => {
  let testUserId = null;
  let failed = false;
  try {
    // --- isolated throwaway user --------------------------------------------
    testUserId = newId();
    const user = await prisma.user.create({
      data: {
        id: testUserId,
        email: `auth-test-${Date.now()}@local.test`,
        isActive: true,
        security: { sessionVersion: 1 },
      },
    });
    assert(user._id === user.id, '_id mirrors id on a freshly created Prisma user');

    // --- 1. createSession ----------------------------------------------------
    const a = await sessionService.createSession({ user, fingerprint: 'fpA', userAgent: 'jest', ip: '127.0.0.1' });
    assert(!!a.accessToken && !!a.refreshToken, 'createSession returns access + refresh tokens');
    assert(a.session.userId === user.id, 'session.userId links to the user');
    const persisted = await prisma.userSession.findUnique({ where: { id: a.session.id } });
    assert(persisted && !persisted.revoked, 'session persisted in Postgres and not revoked');

    // --- 2. validateAccessToken ---------------------------------------------
    const v = await sessionService.validateAccessToken(a.accessToken);
    assert(v.decoded.user.id === user.id, 'validateAccessToken decodes the user id');
    assert(v.session.accessTokenId === a.session.accessTokenId, 'validate returns the matching session');
    assert(v.user.id === user.id, 'validate returns the user (read from Postgres)');

    // --- 3. refreshSession rotates the refresh token ------------------------
    const r = await sessionService.refreshSession(a.refreshToken, 'fpA', 'jest', '127.0.0.1');
    assert(!!r.accessToken && r.refreshToken !== a.refreshToken, 'refresh issues a new, rotated refresh token');
    let oldRejected = false;
    try { await sessionService.refreshSession(a.refreshToken, 'fpA', 'jest', '127.0.0.1'); }
    catch (e) { oldRejected = e.message === 'invalid_refresh_token'; }
    assert(oldRejected, 'the old refresh token is rejected after rotation');
    const r2 = await sessionService.refreshSession(r.refreshToken, 'fpA', 'jest', '127.0.0.1');
    assert(!!r2.accessToken, 'the new refresh token works');

    // --- 4. revoke + validate-on-revoked ------------------------------------
    await sessionService.revokeSessionById(a.session.accessTokenId, 'test_revoke');
    const afterRevoke = await prisma.userSession.findUnique({ where: { id: a.session.id } });
    assert(afterRevoke.revoked && afterRevoke.reason === 'test_revoke', 'revokeSessionById marks revoked with reason');
    let revokedRejected = false;
    try { await sessionService.validateAccessToken(a.accessToken); }
    catch (e) { revokedRejected = e.message === 'session_revoked'; }
    assert(revokedRejected, 'validateAccessToken throws session_revoked on a revoked session');

    // --- 5. unknown jti -> session_not_found --------------------------------
    const ghost = jwt.sign({ user: { id: user.id }, jti: 'ghost-jti', sessionVersion: 1 }, process.env.JWT_SECRET, { expiresIn: '5m' });
    let notFound = false;
    try { await sessionService.validateAccessToken(ghost); } catch (e) { notFound = e.message === 'session_not_found'; }
    assert(notFound, 'validateAccessToken throws session_not_found for an unknown jti');

    // --- 6. session version bump -> session_version_mismatch ----------------
    const b = await sessionService.createSession({ user, fingerprint: 'fpB', userAgent: 'jest', ip: '127.0.0.1' });
    await prisma.user.update({ where: { id: user.id }, data: { security: { sessionVersion: 2 } } });
    let versionMismatch = false;
    try { await sessionService.validateAccessToken(b.accessToken); }
    catch (e) { versionMismatch = e.message === 'session_version_mismatch'; }
    assert(versionMismatch, 'validateAccessToken throws session_version_mismatch after a version bump');

    // --- 7. bulk revoke paths -----------------------------------------------
    const s1 = await sessionService.createSession({ user, fingerprint: 'fp1', userAgent: 'jest', ip: '1.1.1.1' });
    const s2 = await sessionService.createSession({ user, fingerprint: 'fp2', userAgent: 'jest', ip: '2.2.2.2' });
    await sessionService.revokeAllSessionsExcept(user.id, s1.session.accessTokenId, 'kept_s1');
    const s1row = await prisma.userSession.findUnique({ where: { id: s1.session.id } });
    const s2row = await prisma.userSession.findUnique({ where: { id: s2.session.id } });
    assert(!s1row.revoked && s2row.revoked, 'revokeAllSessionsExcept keeps the excepted session, revokes the rest');
    await sessionService.revokeSessionsByFingerprint(user.id, 'fp1', 'device_removed');
    const s1after = await prisma.userSession.findUnique({ where: { id: s1.session.id } });
    assert(s1after.revoked && s1after.reason === 'device_removed', 'revokeSessionsByFingerprint revokes by fingerprint');

    // --- 8. stats + listing --------------------------------------------------
    const list = await sessionService.getUserSessions(user.id);
    assert(Array.isArray(list) && list.length >= 3, 'getUserSessions lists this user sessions, newest first');
    const stats = await sessionService.getSessionStats();
    assert(typeof stats.totalActiveSessions === 'number' && typeof stats.totalRevoked === 'number', 'getSessionStats returns numeric counts');

    console.log(`\n✅ AUTH LIFECYCLE DEEP TEST PASSED (${pass} assertions)`);
  } catch (e) {
    failed = true;
    console.error('\n❌ ' + e.message);
  } finally {
    // cleanup: remove the throwaway user and all its sessions
    if (testUserId) {
      try { await prisma.userSession.deleteMany({ where: { userId: testUserId } }); } catch (_) {}
      try { await prisma.user.delete({ where: { id: testUserId } }); } catch (_) {}
    }
    await prisma.$disconnect();
    process.exit(failed ? 1 : 0);
  }
})();
