const jwt = require('jsonwebtoken');
const CandidateAccount = require('../models/CandidateAccount');

const candidateAuthMiddleware = async (req, res, next) => {
  const header = req.header('Authorization');
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ msg: 'Candidate token required' });
  }

  try {
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      audience: 'candidate-portal'
    });

    if (decoded.type !== 'candidate') {
      return res.status(401).json({ msg: 'Invalid candidate token' });
    }

    const account = await CandidateAccount.findById(decoded.sub);
    if (!account || account.status === 'disabled') {
      return res.status(401).json({ msg: 'Candidate account is not active' });
    }

    if (decoded.tokenVersion === undefined || decoded.tokenVersion !== account.refreshTokenVersion) {
      return res.status(401).json({ msg: 'Candidate session has expired' });
    }

    req.candidateAccount = account;
    req.candidateToken = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ msg: 'Invalid or expired candidate token' });
  }
};

module.exports = candidateAuthMiddleware;
