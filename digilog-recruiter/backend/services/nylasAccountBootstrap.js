const prisma = require('../db/client');

/**
 * Ensure a default, active + verified Nylas account exists, derived from
 * environment variables (NYLAS_CLIENT_ID / NYLAS_API_KEY / NYLAS_CLIENT_SECRET).
 *
 * The multi-account grant pool reads accounts from the database, so a deployment
 * that only has Nylas creds in env (e.g. on the VM) has no usable account and
 * calendar connection fails. This bootstrap lets "set the env vars + restart" be
 * all that's needed — no manual admin setup.
 *
 * Idempotent: keyed on clientId. Safe to call on every startup / serverless cold
 * start. Never throws — calendar is optional, so failures only log.
 *
 * Optional env: NYLAS_REGION (us|eu|au, default us), NYLAS_API_URI,
 * NYLAS_MAX_GRANTS (default 5).
 *
 * @returns {Promise<Object|null>} the ensured account, or null if skipped/failed
 */
async function ensureDefaultNylasAccountFromEnv() {
  try {
    const clientId = process.env.NYLAS_CLIENT_ID;
    const apiKey = process.env.NYLAS_API_KEY;
    const clientSecret = process.env.NYLAS_CLIENT_SECRET;

    if (!clientId || !apiKey || !clientSecret) {
      console.log(
        'ℹ️ Nylas bootstrap skipped — set NYLAS_CLIENT_ID, NYLAS_API_KEY and NYLAS_CLIENT_SECRET to auto-provision the calendar account.'
      );
      return null;
    }

    const rawRegion = (process.env.NYLAS_REGION || 'us').toLowerCase();
    const region = ['us', 'eu', 'au'].includes(rawRegion) ? rawRegion : 'us';
    const apiUri = process.env.NYLAS_API_URI || `https://api.${region}.nylas.com`;
    const parsedMax = parseInt(process.env.NYLAS_MAX_GRANTS, 10);
    const maxGrants = Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : 5;

    const existing = await prisma.nylasAccount.findFirst({ where: { clientId } });

    if (existing) {
      // Make sure the env-provided account is actually usable. findAvailableAccount()
      // only considers active + verified accounts with maxGrants > 0.
      const updates = {};
      if (!existing.active) updates.active = true;
      if (!existing.verified) updates.verified = true;
      if (!existing.maxGrants || existing.maxGrants < 1) updates.maxGrants = maxGrants;

      if (Object.keys(updates).length > 0) {
        await prisma.nylasAccount.update({ where: { id: existing.id }, data: updates });
        console.log(
          `✅ Nylas bootstrap: reactivated existing account "${existing.name}" (${Object.keys(updates).join(', ')}).`
        );
      } else {
        console.log(`ℹ️ Nylas bootstrap: default account "${existing.name}" already active & verified.`);
      }
      return existing;
    }

    const account = await prisma.nylasAccount.create({ data: {
      name: 'Default Account (from env)',
      clientId,
      apiKey,
      clientSecret,
      region,
      apiUri,
      maxGrants,
      accountType: 'production',
      priority: 100, // prefer this account first
      active: true,
      verified: true, // trust the env creds (admin panel can re-verify)
      isDefault: true,
      notes: 'Auto-created from environment variables on startup'
    } });

    console.log(
      `✅ Nylas bootstrap: created default account "${account.name}" (${account._id}) from env — region=${region}, maxGrants=${maxGrants}.`
    );
    return account;
  } catch (error) {
    // Never block startup — calendar features are optional.
    console.error('⚠️ Nylas bootstrap failed (calendar connection may be unavailable):', error.message);
    return null;
  }
}

module.exports = { ensureDefaultNylasAccountFromEnv };
