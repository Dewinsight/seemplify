const express = require('express');
const mongoose = require('mongoose');
const Candidate = require('../models/Candidate');
const CandidateList = require('../models/CandidateList');
const authMiddleware = require('../middleware/authMiddleware');
const { requireOrganization } = require('../middleware/organizationMiddleware');

const router = express.Router();

router.use(authMiddleware);
router.use(requireOrganization);

const candidateSelect = 'firstName lastName email phone position status source skills location createdAt updatedAt';
const MAX_QUERY_LIST_SIZE = 5000;

function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildCandidateQuery(organizationId, { search, status } = {}) {
  const query = { organization: organizationId };

  if (status && status !== 'all') {
    query.status = status;
  }

  if (search && search.trim()) {
    const terms = search.trim().split(/\s+/).filter(Boolean).map(escapeRegex);
    const searchRegex = new RegExp(terms.join('|'), 'i');
    query.$or = [
      { firstName: searchRegex },
      { lastName: searchRegex },
      { email: searchRegex },
      { phone: searchRegex },
      { position: searchRegex },
      { skills: searchRegex },
      { experience: searchRegex },
      { education: searchRegex },
      { location: searchRegex },
      { resumeText: searchRegex },
      { coverLetter: searchRegex },
      { source: searchRegex },
      { status: searchRegex },
    ];
  }

  return query;
}

function normalizeCandidateId(value) {
  const id = typeof value === 'object' && value !== null
    ? value.candidateId || value.candidate || value.id || value._id
    : value;
  return id && mongoose.Types.ObjectId.isValid(id) ? String(id) : null;
}

async function getValidCandidateIds(candidateIds, organizationId) {
  const uniqueIds = [...new Set((candidateIds || []).map(normalizeCandidateId).filter(Boolean))];
  if (!uniqueIds.length) return [];

  const candidates = await Candidate.find({
    _id: { $in: uniqueIds },
    organization: organizationId,
  }).select('_id').lean();

  const allowed = new Set(candidates.map(candidate => String(candidate._id)));
  return uniqueIds.filter(id => allowed.has(id));
}

function buildEntries({ candidateIds = [], entries = [], userId, source }) {
  const explicitEntries = entries
    .map((entry, index) => {
      const candidateId = normalizeCandidateId(entry);
      if (!candidateId) return null;

      return {
        candidate: candidateId,
        rank: Number.isFinite(Number(entry.rank)) ? Number(entry.rank) : index + 1,
        score: Number.isFinite(Number(entry.score)) ? Number(entry.score) : undefined,
        source: entry.source || source,
        notes: entry.notes,
        addedBy: userId,
        addedAt: new Date(),
      };
    })
    .filter(Boolean);

  const plainEntries = candidateIds
    .map(normalizeCandidateId)
    .filter(Boolean)
    .map((candidateId, index) => ({
      candidate: candidateId,
      rank: index + 1,
      source,
      addedBy: userId,
      addedAt: new Date(),
    }));

  return [...explicitEntries, ...plainEntries];
}

function mergeEntries(existingEntries = [], nextEntries = [], allowedCandidateIds = []) {
  const allowed = new Set(allowedCandidateIds.map(String));
  const byCandidate = new Map();

  existingEntries.forEach((entry) => {
    const candidateId = String(entry.candidate?._id || entry.candidate);
    if (allowed.has(candidateId)) {
      byCandidate.set(candidateId, {
        candidate: candidateId,
        rank: entry.rank,
        score: entry.score,
        source: entry.source,
        notes: entry.notes,
        addedBy: entry.addedBy,
        addedAt: entry.addedAt || new Date(),
      });
    }
  });

  nextEntries.forEach((entry) => {
    const candidateId = String(entry.candidate);
    if (allowed.has(candidateId)) {
      byCandidate.set(candidateId, {
        candidate: candidateId,
        rank: entry.rank,
        score: entry.score,
        source: entry.source,
        notes: entry.notes,
        addedBy: entry.addedBy,
        addedAt: entry.addedAt || new Date(),
      });
    }
  });

  return [...byCandidate.values()].sort((a, b) => {
    const rankA = Number.isFinite(a.rank) ? a.rank : Number.MAX_SAFE_INTEGER;
    const rankB = Number.isFinite(b.rank) ? b.rank : Number.MAX_SAFE_INTEGER;
    return rankA - rankB;
  });
}

async function populateList(query) {
  return query.populate('entries.candidate', candidateSelect);
}

function summarizeList(list) {
  const plain = typeof list.toObject === 'function' ? list.toObject({ virtuals: true }) : list;
  return {
    ...plain,
    candidateCount: plain.entries?.length || 0,
  };
}

router.get('/', async (req, res) => {
  try {
    const organizationId = req.user.currentOrganization;
    const lists = await CandidateList.find({ organization: organizationId })
      .sort({ updatedAt: -1 })
      .select('name description source sourceRef entries createdBy updatedBy createdAt updatedAt')
      .lean({ virtuals: true });

    res.json({
      lists: lists.map(list => ({
        ...list,
        entries: undefined,
        candidateCount: list.entries?.length || 0,
      })),
    });
  } catch (error) {
    console.error('Error fetching candidate lists:', error);
    res.status(500).json({ msg: 'Server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const list = await populateList(CandidateList.findOne({
      _id: req.params.id,
      organization: req.user.currentOrganization,
    }));

    if (!list) {
      return res.status(404).json({ msg: 'Candidate list not found' });
    }

    res.json({ list: summarizeList(list) });
  } catch (error) {
    console.error('Error fetching candidate list:', error);
    res.status(500).json({ msg: 'Server error' });
  }
});

router.post('/', async (req, res) => {
  try {
    const organizationId = req.user.currentOrganization;
    const {
      name,
      description,
      source = 'manual',
      sourceRef = {},
      candidateIds = [],
      entries = [],
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ msg: 'List name is required' });
    }

    const requestedEntries = buildEntries({
      candidateIds,
      entries,
      userId: req.user.id,
      source,
    });
    const validCandidateIds = await getValidCandidateIds(
      requestedEntries.map(entry => entry.candidate),
      organizationId
    );

    const list = await CandidateList.create({
      organization: organizationId,
      name: name.trim(),
      description,
      source,
      sourceRef,
      entries: mergeEntries([], requestedEntries, validCandidateIds),
      createdBy: req.user.id,
      updatedBy: req.user.id,
    });

    const populated = await populateList(CandidateList.findById(list._id));
    res.status(201).json({ list: summarizeList(populated) });
  } catch (error) {
    console.error('Error creating candidate list:', error);
    res.status(500).json({ msg: 'Server error' });
  }
});

router.post('/from-query', async (req, res) => {
  try {
    const organizationId = req.user.currentOrganization;
    const {
      name,
      description,
      search,
      status,
      limit = MAX_QUERY_LIST_SIZE,
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ msg: 'List name is required' });
    }

    const safeLimit = Math.min(Math.max(Number(limit) || MAX_QUERY_LIST_SIZE, 1), MAX_QUERY_LIST_SIZE);
    const candidates = await Candidate.find(buildCandidateQuery(organizationId, { search, status }))
      .sort({ createdAt: -1 })
      .limit(safeLimit)
      .select('_id')
      .lean();

    const entries = candidates.map((candidate, index) => ({
      candidate: candidate._id,
      rank: index + 1,
      source: 'candidates',
      addedBy: req.user.id,
      addedAt: new Date(),
    }));

    const list = await CandidateList.create({
      organization: organizationId,
      name: name.trim(),
      description,
      source: 'candidates',
      sourceRef: { search, status, limit: safeLimit },
      entries,
      createdBy: req.user.id,
      updatedBy: req.user.id,
    });

    const populated = await populateList(CandidateList.findById(list._id));
    res.status(201).json({ list: summarizeList(populated) });
  } catch (error) {
    console.error('Error creating candidate list from query:', error);
    res.status(500).json({ msg: 'Server error' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const updates = {};
    if (typeof req.body.name === 'string') updates.name = req.body.name.trim();
    if (typeof req.body.description === 'string') updates.description = req.body.description;
    if (typeof req.body.source === 'string') updates.source = req.body.source;
    if (req.body.sourceRef && typeof req.body.sourceRef === 'object') updates.sourceRef = req.body.sourceRef;
    updates.updatedBy = req.user.id;

    const list = await populateList(CandidateList.findOneAndUpdate(
      { _id: req.params.id, organization: req.user.currentOrganization },
      { $set: updates },
      { new: true, runValidators: true }
    ));

    if (!list) {
      return res.status(404).json({ msg: 'Candidate list not found' });
    }

    res.json({ list: summarizeList(list) });
  } catch (error) {
    console.error('Error updating candidate list:', error);
    res.status(500).json({ msg: 'Server error' });
  }
});

router.post('/:id/candidates', async (req, res) => {
  try {
    const organizationId = req.user.currentOrganization;
    const list = await CandidateList.findOne({ _id: req.params.id, organization: organizationId });

    if (!list) {
      return res.status(404).json({ msg: 'Candidate list not found' });
    }

    const requestedEntries = buildEntries({
      candidateIds: req.body.candidateIds || [],
      entries: req.body.entries || [],
      userId: req.user.id,
      source: req.body.source || list.source || 'manual',
    });
    const allCandidateIds = [
      ...list.entries.map(entry => entry.candidate),
      ...requestedEntries.map(entry => entry.candidate),
    ];
    const validCandidateIds = await getValidCandidateIds(allCandidateIds, organizationId);

    list.entries = mergeEntries(list.entries, requestedEntries, validCandidateIds);
    list.updatedBy = req.user.id;
    await list.save();

    const populated = await populateList(CandidateList.findById(list._id));
    res.json({ list: summarizeList(populated) });
  } catch (error) {
    console.error('Error adding candidates to list:', error);
    res.status(500).json({ msg: 'Server error' });
  }
});

router.delete('/:id/candidates', async (req, res) => {
  try {
    const candidateIds = new Set((req.body.candidateIds || []).map(normalizeCandidateId).filter(Boolean));
    const list = await CandidateList.findOne({ _id: req.params.id, organization: req.user.currentOrganization });

    if (!list) {
      return res.status(404).json({ msg: 'Candidate list not found' });
    }

    list.entries = list.entries.filter(entry => !candidateIds.has(String(entry.candidate)));
    list.updatedBy = req.user.id;
    await list.save();

    const populated = await populateList(CandidateList.findById(list._id));
    res.json({ list: summarizeList(populated) });
  } catch (error) {
    console.error('Error removing candidates from list:', error);
    res.status(500).json({ msg: 'Server error' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await CandidateList.findOneAndDelete({
      _id: req.params.id,
      organization: req.user.currentOrganization,
    });

    if (!result) {
      return res.status(404).json({ msg: 'Candidate list not found' });
    }

    res.json({ msg: 'Candidate list deleted' });
  } catch (error) {
    console.error('Error deleting candidate list:', error);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
