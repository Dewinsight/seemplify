const clients = new Map();

function key(userId, organizationId) {
    return `${String(organizationId)}:${String(userId)}`;
}

function subscribe(userId, organizationId, response) {
    const clientKey = key(userId, organizationId);
    const current = clients.get(clientKey) || new Set();
    current.add(response);
    clients.set(clientKey, current);
    return () => {
        current.delete(response);
        if (current.size === 0) clients.delete(clientKey);
    };
}

function publish(userId, organizationId, event) {
    const current = clients.get(key(userId, organizationId));
    if (!current) return;
    const payload = `event: attendance\ndata: ${JSON.stringify(event)}\n\n`;
    current.forEach(response => {
        try { response.write(payload); } catch (_) { /* disconnected client */ }
    });
}

module.exports = { subscribe, publish };
