const jwt = require('jsonwebtoken');

const ISSUER = 'seemplify-idp-hub';
const AUDIENCE = 'time-attendance';

function getSecret() {
    return String(process.env.ATTENDANCE_HUB_SECRET || '').trim();
}

function verifyHubToken(token) {
    const secret = getSecret();
    if (!secret) return null;

    const decoded = jwt.decode(token);
    if (decoded?.iss !== ISSUER || decoded?.aud !== AUDIENCE) return null;

    const claims = jwt.verify(token, secret, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
    });
    if (claims.scope !== 'attendance:self') {
        throw new Error('Invalid attendance hub scope');
    }

    return {
        id: claims.sub,
        email: claims.email,
        name: claims.name,
        organizations: claims.organizations || [],
        teams: claims.teams || [],
        currentOrganization: claims.currentOrganization,
        authSurface: 'hub',
    };
}

module.exports = { verifyHubToken, ISSUER, AUDIENCE };
