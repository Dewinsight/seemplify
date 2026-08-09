const http = require('http');

const port = Number(process.env.LIVE_OIDC_PORT || 5119);
const issuer = process.env.LIVE_OIDC_ISSUER || `http://127.0.0.1:${port}`;

const user = {
    sub: 'employee-live-1',
    email: 'alex.live@example.test',
    name: 'Alex Live',
    email_verified: true,
    organizations: [{
        id: 'org-live-e2e',
        name: 'Seemplify Live E2E',
        role: 'admin',
    }],
    currentOrganization: {
        id: 'org-live-e2e',
        name: 'Seemplify Live E2E',
        role: 'admin',
    },
    teams: [{
        id: 'team-live-1',
        name: 'Operations',
        organizationId: 'org-live-e2e',
        role: 'line_manager',
        managerId: 'employee-live-1',
        managerName: 'Alex Live',
        managerEmail: 'alex.live@example.test',
        directReports: ['employee-live-2'],
    }],
};

function json(response, status, body) {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
}

const server = http.createServer((request, response) => {
    const url = new URL(request.url, issuer);
    if (url.pathname === '/.well-known/openid-configuration') {
        return json(response, 200, {
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            userinfo_endpoint: `${issuer}/userinfo`,
            jwks_uri: `${issuer}/jwks`,
            response_types_supported: ['code'],
            subject_types_supported: ['public'],
            id_token_signing_alg_values_supported: ['RS256'],
            token_endpoint_auth_methods_supported: ['client_secret_basic'],
            scopes_supported: ['openid', 'email', 'profile', 'organizations', 'teams'],
            claims_supported: Object.keys(user),
        });
    }

    if (url.pathname === '/userinfo') {
        if (request.headers.authorization !== 'Bearer live-e2e-token') {
            return json(response, 401, { error: 'invalid_token' });
        }
        return json(response, 200, user);
    }

    if (url.pathname === '/authorize') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return response.end('<main><h1>Live identity test sign-in</h1><p>The Time &amp; Attendance application reached the identity boundary.</p></main>');
    }

    if (url.pathname === '/jwks') return json(response, 200, { keys: [] });
    if (url.pathname === '/health') return json(response, 200, { status: 'ok' });
    return json(response, 404, { error: 'not_found' });
});

server.listen(port, '127.0.0.1', () => {
    console.log(`Live OIDC test boundary listening at ${issuer}`);
});

function close() {
    server.close(() => process.exit(0));
}

process.on('SIGINT', close);
process.on('SIGTERM', close);
