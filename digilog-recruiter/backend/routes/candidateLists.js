const express = require('express');
const prisma = require('../db/client');
const { isObjectIdLike } = require('../db/objectId');
const authMiddleware = require('../middleware/authMiddleware');
const { requireOrganization } = require('../middleware/organizationMiddleware');

const router = express.Router();

router.use(authMiddleware);
router.use(requireOrganization);

const candidateSelect = {
  firstName: true, lastName: true, email: true, phone: true, position: true,
  status: true, source: true, skills: true, location: true, createdAt: true, updatedAt: true,
};
const MAX_QUERY_LIST_SIZE = 5000;

function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildCandidateQuery(organizationId, { search, status } = {}) {
  const query = { organizationId: organizationId };

  if (status && status !== 'all') {
    query.status = status;
  }

  if (search && search.trim()) {
    const terms = search.trim().split(/\s+/).filter(Boolean).map(escapeRegex);
    const pattern = terms.join('|');
    query.OR = [
      { firstName: { contains: pattern, mode: 'insensitive' } },
      { lastName: { contains: pattern, mode: 'insensitive' } },
      { email: { contains: pattern, mode: 'insensitive' } },
      { phone: { contains: pattern, mode: 'insensitive' } },
      { position: { contains: pattern, mode: 'insensitive' } },
      { skills: { contains: pattern, mode: 'insensitive' } },
      { experience: { contains: pattern, mode: 'insensitive' } },
      { education: { contains: pattern, mode: 'insensitive' } },
      { location: { contains: pattern, mode: 'insensitive' } },
      { resumeText: { contains: pattern, mode: 'insensitive' } },
      { coverLetter: { contains: pattern, mode: 'insensitive' } },
      { source: { contains: pattern, mode: 'insensitive' } },
      { status: { contains: pattern, mode: 'insensitive' } },
    ];
  }

  return query;
}

function normalizeCandidateId(value) {
  const id = typeof value === 'object' && value !== null
    ? value.candidateId || value.candidate || value.id || value._id
    : value;
  return id && isObjectIdLike(id) ? String(id) : null;
}

async function getValidCandidateIds(candidateIds, organizationId) {
  const uniqueIds = [...new Set((candidateIds || []).map(normalizeCandidateId).filter(Boolean))];
  if (!uniqueIds.length) return [];

  const candidates = await prisma.candidate.findMany({
    where: { id: { in: uniqueIds }, organizationId: organizationId },
    select: { id: true },
  });

  const allowed = new Set(candidates.map(candidate => String(candidate.id)));
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

// Stitch each entry's `candidate` id (soft ref in the Json entries array) into a
// candidate object (replaces Mongoose `.populate('entries.candidate', candidateSelect)`).
async function populateList(list) {
  if (!list) return list;
  const entries = Array.isArray(list.entries) ? list.entries : [];
  const candidateIds = [...new Set(
    entries.map(entry => entry && (entry.candidate?._id || entry.candidate)).filter(Boolean).map(String)
  )];
  if (candidateIds.length) {
    const candidates = await prisma.candidate.findMany({
      where: { id: { in: candidateIds } },
      select: { id: true, ...candidateSelect },
    });
    const candidateMap = new Map(candidates.map(c => [c.id, c]));
    list.entries = entries.map(entry => {
      const cid = entry && (entry.candidate?._id || entry.candidate);
      return cid && candidateMap.has(String(cid))
        ? { ...entry, candidate: candidateMap.get(String(cid)) }
        : entry;
    });
  }
  return list;
}

function summarizeList(list) {
  const plain = list;
  return {
    ...plain,
    candidateCount: plain.entries?.length || 0,
  };
}

router.get('/', async (req, res) => {
  try {
    const organizationId = req.user.currentOrganization;
    const lists = await prisma.candidateList.findMany({
      where: { organizationId: organizationId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true, name: true, description: true, source: true, sourceRef: true,
        entries: true, createdBy: true, updatedBy: true, createdAt: true, updatedAt: true,
      },
    });

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
    const list = await populateList(await prisma.candidateList.findFirst({
      where: { id: req.params.id, organizationId: req.user.currentOrganization },
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

    const list = await prisma.candidateList.create({
      data: {
        organizationId: organizationId,
        name: name.trim(),
        description,
        source,
        sourceRef,
        entries: mergeEntries([], requestedEntries, validCandidateIds),
        createdBy: req.user.id,
        updatedBy: req.user.id,
      },
    });

    const populated = await populateList(await prisma.candidateList.findUnique({ where: { id: list.id } }));
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
    const candidates = await prisma.candidate.findMany({
      where: buildCandidateQuery(organizationId, { search, status }),
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
      select: { id: true },
    });

    const entries = candidates.map((candidate, index) => ({
      candidate: candidate.id,
      rank: index + 1,
      source: 'candidates',
      addedBy: req.user.id,
      addedAt: new Date(),
    }));

    const list = await prisma.candidateList.create({
      data: {
        organizationId: organizationId,
        name: name.trim(),
        description,
        source: 'candidates',
        sourceRef: { search, status, limit: safeLimit },
        entries,
        createdBy: req.user.id,
        updatedBy: req.user.id,
      },
    });

    const populated = await populateList(await prisma.candidateList.findUnique({ where: { id: list.id } }));
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

    const existing = await prisma.candidateList.findFirst({
      where: { id: req.params.id, organizationId: req.user.currentOrganization },
      select: { id: true },
    });
    const list = existing
      ? await populateList(await prisma.candidateList.update({
          where: { id: existing.id },
          data: updates,
        }))
      : null;

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
    const list = await prisma.candidateList.findFirst({ where: { id: req.params.id, organizationId: organizationId } });

    if (!list) {
      return res.status(404).json({ msg: 'Candidate list not found' });
    }

    const existingEntries = Array.isArray(list.entries) ? list.entries : [];
    const requestedEntries = buildEntries({
      candidateIds: req.body.candidateIds || [],
      entries: req.body.entries || [],
      userId: req.user.id,
      source: req.body.source || list.source || 'manual',
    });
    const allCandidateIds = [
      ...existingEntries.map(entry => entry.candidate),
      ...requestedEntries.map(entry => entry.candidate),
    ];
    const validCandidateIds = await getValidCandidateIds(allCandidateIds, organizationId);

    const updated = await prisma.candidateList.update({
      where: { id: list.id },
      data: {
        entries: mergeEntries(existingEntries, requestedEntries, validCandidateIds),
        updatedBy: req.user.id,
      },
    });

    const populated = await populateList(await prisma.candidateList.findUnique({ where: { id: updated.id } }));
    res.json({ list: summarizeList(populated) });
  } catch (error) {
    console.error('Error adding candidates to list:', error);
    res.status(500).json({ msg: 'Server error' });
  }
});

router.delete('/:id/candidates', async (req, res) => {
  try {
    const candidateIds = new Set((req.body.candidateIds || []).map(normalizeCandidateId).filter(Boolean));
    const list = await prisma.candidateList.findFirst({ where: { id: req.params.id, organizationId: req.user.currentOrganization } });

    if (!list) {
      return res.status(404).json({ msg: 'Candidate list not found' });
    }

    const existingEntries = Array.isArray(list.entries) ? list.entries : [];
    const updated = await prisma.candidateList.update({
      where: { id: list.id },
      data: {
        entries: existingEntries.filter(entry => !candidateIds.has(String(entry.candidate))),
        updatedBy: req.user.id,
      },
    });

    const populated = await populateList(await prisma.candidateList.findUnique({ where: { id: updated.id } }));
    res.json({ list: summarizeList(populated) });
  } catch (error) {
    console.error('Error removing candidates from list:', error);
    res.status(500).json({ msg: 'Server error' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { count } = await prisma.candidateList.deleteMany({
      where: { id: req.params.id, organizationId: req.user.currentOrganization },
    });

    if (!count) {
      return res.status(404).json({ msg: 'Candidate list not found' });
    }

    res.json({ msg: 'Candidate list deleted' });
  } catch (error) {
    console.error('Error deleting candidate list:', error);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
