const express = require('express');
const axios = require('axios');
const router = express.Router();

const taxJurisdictionService = require('../services/TaxJurisdictionService');
const { requireAuth, requireHRAdmin } = require('../middleware/rbac');
const { getIdentityProviderIssuerUrl } = require('../config/identityProvider');

const getUserInfo = (req) => ({
  userId: req.session?.user?.sub || req.session?.user?.id,
  organizationId: req.currentOrganization?.id || req.session?.currentOrganizationId,
  name: req.session?.user?.name,
  role: req.currentOrganization?.role || req.session?.user?.currentOrganization?.role || req.session?.user?.organizationRole,
});

const TAX_PUBLISHER_ROLES = new Set(['owner', 'admin']);
const requireTaxPublisher = (req, res, next) => requireHRAdmin(req, res, () => {
  const { role } = getUserInfo(req);
  if (!TAX_PUBLISHER_ROLES.has(String(role || '').toLowerCase())) {
    return res.status(403).json({
      error: 'Only an organization owner or administrator can publish a statutory tax pack.',
      code: 'TAX_PACK_PUBLISHER_REQUIRED',
    });
  }
  return next();
});

const requireTaxRegistryAdministrator = (req, res, next) => requireHRAdmin(req, res, () => {
  const { role } = getUserInfo(req);
  if (!TAX_PUBLISHER_ROLES.has(String(role || '').toLowerCase())) {
    return res.status(403).json({
      error: 'Only an organization owner or administrator can manage the tax reviewer registry.',
      code: 'TAX_REVIEWER_REGISTRY_ADMIN_REQUIRED',
    });
  }
  return next();
});

const getBearerAccessToken = (req) => {
  const authorization = String(req.headers?.authorization || '').trim();
  return authorization.toLowerCase().startsWith('bearer ')
    ? authorization.substring(7).trim()
    : '';
};

const getIdpAccessToken = (req) => String(
  req.session?.user?.accessToken || getBearerAccessToken(req) || ''
).trim();

const normalizeOrganizationMember = (entry = {}) => {
  const user = entry.user && typeof entry.user === 'object' ? entry.user : entry;
  return {
    userId: String(user.sub || user.userId || user.id || entry.userId || '').trim(),
    name: String(
      user.name
      || user.displayName
      || [user.given_name, user.family_name].filter(Boolean).join(' ')
      || user.email
      || entry.name
      || ''
    ).trim(),
    email: String(user.email || entry.email || '').trim(),
  };
};

async function verifyOrganizationMember(req, organizationId, requestedUserId) {
  if (!String(organizationId || '').trim()) {
    const error = new Error('No organization is selected for reviewer verification.');
    error.statusCode = 400;
    throw error;
  }
  const userId = String(requestedUserId || '').trim();
  if (!userId) {
    const error = new Error('Reviewer userId is required.');
    error.statusCode = 400;
    throw error;
  }
  const accessToken = getIdpAccessToken(req);
  if (!accessToken) {
    const error = new Error('Identity Provider membership verification is unavailable for this session.');
    error.statusCode = 503;
    error.code = 'TAX_REVIEWER_MEMBERSHIP_VERIFICATION_UNAVAILABLE';
    throw error;
  }

  try {
    const idpBaseUrl = getIdentityProviderIssuerUrl('http://localhost:4000').replace(/\/$/, '');
    const response = await axios.get(
      `${idpBaseUrl}/api/organizations/${encodeURIComponent(organizationId)}/members`,
      { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 15000 }
    );
    const members = Array.isArray(response.data?.members)
      ? response.data.members
      : (Array.isArray(response.data) ? response.data : []);
    const member = members.map(normalizeOrganizationMember)
      .find((entry) => entry.userId === userId);
    if (!member?.userId || !member?.name) {
      const error = new Error('The selected reviewer is not a current member of this organization.');
      error.statusCode = 400;
      error.code = 'TAX_REVIEWER_ORGANIZATION_MEMBERSHIP_REQUIRED';
      throw error;
    }
    return member;
  } catch (error) {
    if (error.statusCode) throw error;
    const verificationError = new Error('Identity Provider membership verification failed; no reviewer authorization was created.');
    verificationError.statusCode = 502;
    verificationError.code = 'TAX_REVIEWER_MEMBERSHIP_VERIFICATION_UNAVAILABLE';
    throw verificationError;
  }
}

router.get('/jurisdictions', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId } = getUserInfo(req);
    const jurisdictions = await taxJurisdictionService.listJurisdictions(organizationId, {
      includeGlobal: req.query.includeGlobal !== 'false',
    });

    res.json({ jurisdictions });
  } catch (err) {
    console.error('List Tax Jurisdictions Error:', err);
    res.status(500).json({ error: 'Failed to fetch tax jurisdictions' });
  }
});

router.get('/jurisdiction-backlog', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId } = getUserInfo(req);
    const groups = await taxJurisdictionService.listRolloutBacklog(organizationId);
    res.json({ groups });
  } catch (err) {
    console.error('List Tax Jurisdiction Backlog Error:', err);
    res.status(err.statusCode || 500).json({
      error: err.message || 'Failed to fetch the tax jurisdiction rollout backlog',
      code: err.code,
      details: err.details,
    });
  }
});

router.post('/jurisdictions', requireHRAdmin, async (req, res) => {
  try {
    const actor = getUserInfo(req);
    const jurisdiction = await taxJurisdictionService.createJurisdiction(actor.organizationId, req.body || {}, actor);
    res.status(201).json({
      success: true,
      jurisdiction: jurisdiction.toSummary ? jurisdiction.toSummary() : jurisdiction,
    });
  } catch (err) {
    console.error('Create Tax Jurisdiction Error:', err);
    res.status(err.statusCode || 500).json({
      error: err.message || 'Failed to create tax jurisdiction',
      code: err.code,
      details: err.details,
    });
  }
});

router.get('/jurisdictions/:id', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId } = getUserInfo(req);
    const jurisdiction = await taxJurisdictionService.getJurisdictionById(req.params.id, organizationId);
    if (!jurisdiction) {
      return res.status(404).json({ error: 'Tax jurisdiction not found' });
    }

    const serialized = jurisdiction.toObject ? jurisdiction.toObject() : jurisdiction;
    serialized.versions = (jurisdiction.versions || []).map((version) => ({
      ...(version.toObject ? version.toObject() : version),
      certification: taxJurisdictionService.getCertificationStatus(version, {
        reviewTeam: jurisdiction.reviewTeam || [],
      }),
    }));
    res.json({ jurisdiction: serialized });
  } catch (err) {
    console.error('Get Tax Jurisdiction Error:', err);
    res.status(500).json({ error: 'Failed to fetch tax jurisdiction' });
  }
});

router.put('/jurisdictions/:id', requireHRAdmin, async (req, res) => {
  try {
    const actor = getUserInfo(req);
    const jurisdiction = await taxJurisdictionService.updateJurisdiction(req.params.id, actor.organizationId, req.body || {}, actor);
    res.json({
      success: true,
      jurisdiction,
    });
  } catch (err) {
    console.error('Update Tax Jurisdiction Error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to update tax jurisdiction', details: err.details });
  }
});

router.post('/jurisdictions/:id/versions', requireHRAdmin, async (req, res) => {
  try {
    const actor = getUserInfo(req);
    const version = await taxJurisdictionService.createVersion(req.params.id, actor.organizationId, req.body || {}, actor);
    res.status(201).json({
      success: true,
      version,
    });
  } catch (err) {
    console.error('Create Tax Jurisdiction Version Error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to create tax jurisdiction version', details: err.details });
  }
});

router.post('/jurisdictions/:id/reviewers', requireTaxRegistryAdministrator, async (req, res) => {
  try {
    const actor = getUserInfo(req);
    const organizationMember = await verifyOrganizationMember(
      req,
      actor.organizationId,
      req.body?.userId
    );
    const result = await taxJurisdictionService.authorizeReviewer(
      req.params.id,
      actor.organizationId,
      req.body || {},
      actor,
      organizationMember
    );
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    console.error('Authorize Tax Reviewer Error:', err);
    res.status(err.statusCode || 500).json({
      error: err.message || 'Failed to authorize tax reviewer',
      code: err.code,
      details: err.details,
    });
  }
});

router.post('/jurisdictions/:id/reviewers/:authorizationId/revoke', requireTaxRegistryAdministrator, async (req, res) => {
  try {
    const actor = getUserInfo(req);
    const result = await taxJurisdictionService.revokeReviewer(
      req.params.id,
      req.params.authorizationId,
      actor.organizationId,
      req.body || {},
      actor
    );
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Revoke Tax Reviewer Error:', err);
    res.status(err.statusCode || 500).json({
      error: err.message || 'Failed to revoke tax reviewer authorization',
      code: err.code,
      details: err.details,
    });
  }
});

router.get('/jurisdictions/:id/versions/:versionId/review-context', requireAuth, async (req, res) => {
  try {
    const actor = getUserInfo(req);
    const result = await taxJurisdictionService.getCertificationReviewContext(
      req.params.id,
      req.params.versionId,
      actor.organizationId,
      actor
    );
    res.json(result);
  } catch (err) {
    console.error('Get Tax Certification Review Context Error:', err);
    res.status(err.statusCode || 500).json({
      error: err.message || 'Failed to fetch tax certification review context',
      code: err.code,
      details: err.details,
    });
  }
});

router.post('/jurisdictions/:id/versions/:versionId/reviews', requireAuth, async (req, res) => {
  try {
    const actor = getUserInfo(req);
    const result = await taxJurisdictionService.submitCertificationReview(
      req.params.id,
      req.params.versionId,
      actor.organizationId,
      req.body || {},
      actor
    );
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    console.error('Submit Tax Certification Review Error:', err);
    res.status(err.statusCode || 500).json({
      error: err.message || 'Failed to submit tax certification review',
      code: err.code,
      details: err.details,
    });
  }
});

router.post('/jurisdictions/:id/versions/:versionId/automated-review', requireHRAdmin, async (req, res) => {
  try {
    const actor = getUserInfo(req);
    const result = await taxJurisdictionService.runAutomatedTechnicalReview(
      req.params.id,
      req.params.versionId,
      actor.organizationId,
      req.body || {},
      actor
    );
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    console.error('Run Automated Tax Technical Review Error:', err);
    res.status(err.statusCode || 500).json({
      error: err.message || 'Failed to run the automated tax technical review',
      code: err.code,
      details: err.details,
    });
  }
});

router.post('/jurisdictions/:id/publish', requireTaxPublisher, async (req, res) => {
  try {
    const actor = getUserInfo(req);
    const versionId = req.body?.versionId;
    if (!versionId) {
      return res.status(400).json({ error: 'versionId is required' });
    }

    const jurisdiction = await taxJurisdictionService.publishVersion(req.params.id, versionId, actor.organizationId, actor);
    res.json({
      success: true,
      jurisdiction,
    });
  } catch (err) {
    console.error('Publish Tax Jurisdiction Version Error:', err);
    res.status(err.statusCode || 500).json({
      error: err.message || 'Failed to publish tax jurisdiction version',
      code: err.code,
      details: err.details,
    });
  }
});

router.post('/preview', requireHRAdmin, async (req, res) => {
  try {
    const actor = getUserInfo(req);
    const result = await taxJurisdictionService.calculate({
      organizationId: actor.organizationId,
      grossPay: Number(req.body?.grossPay || 0),
      taxableIncome: Number(req.body?.taxableIncome || req.body?.grossPay || 0),
      basicSalary: Number(req.body?.basicSalary || 0),
      preTaxDeductions: Number(req.body?.preTaxDeductions || 0),
      paymentDate: req.body?.paymentDate ? new Date(req.body.paymentDate) : new Date(),
      payFrequency: req.body?.payFrequency || 'monthly',
      employeeInfo: req.body?.employeeInfo || {},
      statutoryContributions: req.body?.statutoryContributions || {},
      ytdGrossPay: Number(req.body?.ytdGrossPay || 0),
      ytdTaxableIncome: Number(req.body?.ytdTaxableIncome || 0),
      taxConfig: req.body?.taxConfig || {},
      versionDefinition: req.body?.versionDefinition,
      configDefinition: req.body?.configDefinition,
    });

    res.json(result);
  } catch (err) {
    console.error('Tax Preview Sandbox Error:', err);
    res.status(500).json({ error: err.message || 'Failed to preview tax jurisdiction' });
  }
});

module.exports = router;
