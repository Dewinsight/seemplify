const express = require('express');
const router = express.Router();

const taxJurisdictionService = require('../services/TaxJurisdictionService');
const { requireHRAdmin } = require('../middleware/rbac');

const getUserInfo = (req) => ({
  userId: req.session?.user?.sub || req.session?.user?.id,
  organizationId: req.currentOrganization?.id || req.session?.currentOrganizationId,
  name: req.session?.user?.name,
});

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
    res.status(500).json({ error: err.message || 'Failed to create tax jurisdiction' });
  }
});

router.get('/jurisdictions/:id', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId } = getUserInfo(req);
    const jurisdiction = await taxJurisdictionService.getJurisdictionById(req.params.id, organizationId);
    if (!jurisdiction) {
      return res.status(404).json({ error: 'Tax jurisdiction not found' });
    }

    res.json({ jurisdiction });
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
    res.status(500).json({ error: err.message || 'Failed to update tax jurisdiction' });
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
    res.status(500).json({ error: err.message || 'Failed to create tax jurisdiction version' });
  }
});

router.post('/jurisdictions/:id/publish', requireHRAdmin, async (req, res) => {
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
    res.status(500).json({ error: err.message || 'Failed to publish tax jurisdiction version' });
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
