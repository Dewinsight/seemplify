'use strict';

function apiBase(value) {
  const normalized = String(value || '').trim().replace(/\/+$/, '');
  if (!normalized) throw new Error('DOKPLOY_URL is required');
  return normalized.endsWith('/api') ? normalized : `${normalized}/api`;
}

function responseItems(payload, keys) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) if (Array.isArray(payload?.[key])) return payload[key];
  if (Array.isArray(payload?.data)) return payload.data;
  if (payload?.data && typeof payload.data === 'object') return responseItems(payload.data, keys);
  return [];
}

function gatewayDataVolume(mountPayload) {
  return responseItems(mountPayload, ['mounts', 'items']).map((mount) => ({
    type: String(mount?.type ?? mount?.Type ?? '').trim().toLowerCase(),
    volumeName: String(mount?.volumeName ?? mount?.Name ?? '').trim(),
    mountPath: String(mount?.mountPath ?? mount?.Destination ?? '').trim()
  })).find((mount) => mount.type === 'volume'
    && mount.mountPath.replace(/\/+$/, '') === '/data'
    && mount.volumeName);
}

function selectDestination(destinationPayload, configuredId = '') {
  const destinations = responseItems(destinationPayload, ['destinations', 'items']);
  const explicit = String(configuredId || '').trim();
  if (explicit) {
    const match = destinations.find((item) => String(item?.destinationId || item?.id || '').trim() === explicit);
    if (!match) throw new Error('DOKPLOY_BACKUP_DESTINATION_ID does not identify an available destination');
    return match;
  }
  if (destinations.length !== 1) {
    throw new Error(`Exactly one Dokploy backup destination is required when DOKPLOY_BACKUP_DESTINATION_ID is unset; found ${destinations.length}`);
  }
  return destinations[0];
}

async function main({ fetchImpl = fetch, source = process.env } = {}) {
  const token = String(source.DOKPLOY_TOKEN || '').trim();
  const applicationId = String(source.CHATGPT_GATEWAY_APP_ID || '').trim();
  if (!token) throw new Error('DOKPLOY_TOKEN is required');
  if (!applicationId) throw new Error('CHATGPT_GATEWAY_APP_ID is required');

  const request = async (path, options = {}) => {
    const response = await fetchImpl(`${apiBase(source.DOKPLOY_URL)}${path}`, {
      ...options,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-api-key': token,
        ...(options.headers || {})
      }
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Dokploy request ${path} failed with HTTP ${response.status}: ${body.slice(0, 200)}`);
    return body ? JSON.parse(body) : {};
  };

  const [mounts, backups] = await Promise.all([
    request(`/mounts.allNamedByApplicationId?applicationId=${encodeURIComponent(applicationId)}`),
    request(`/volumeBackups.list?id=${encodeURIComponent(applicationId)}&volumeBackupType=application`)
  ]);
  const volume = gatewayDataVolume(mounts);
  if (!volume) throw new Error('ChatGPT gateway /data is not a named Docker volume');
  const existing = responseItems(backups, ['volumeBackups', 'backups', 'items'])
    .find((item) => String(item?.volumeName || '').trim() === volume.volumeName);
  if (existing?.enabled === true) {
    process.stdout.write(`ChatGPT gateway volume backup already enabled for ${volume.volumeName}\n`);
    return existing;
  }

  const destination = selectDestination(
    await request('/destination.all'),
    source.DOKPLOY_BACKUP_DESTINATION_ID
  );
  const destinationId = String(destination?.destinationId || destination?.id || '').trim();
  if (!destinationId) throw new Error('Selected Dokploy backup destination has no identifier');
  const payload = {
    name: 'chatgpt-gateway-data-daily',
    volumeName: volume.volumeName,
    prefix: 'seemplify/chatgpt-gateway',
    cronExpression: '0 3 * * *',
    destinationId,
    serviceType: 'application',
    applicationId,
    turnOff: true,
    keepLatestCount: 14,
    enabled: true
  };
  const path = existing?.volumeBackupId ? '/volumeBackups.update' : '/volumeBackups.create';
  if (existing?.volumeBackupId) payload.volumeBackupId = existing.volumeBackupId;
  await request(path, { method: 'POST', body: JSON.stringify(payload) });

  const verified = responseItems(
    await request(`/volumeBackups.list?id=${encodeURIComponent(applicationId)}&volumeBackupType=application`),
    ['volumeBackups', 'backups', 'items']
  ).find((item) => String(item?.volumeName || '').trim() === volume.volumeName && item?.enabled === true);
  if (!verified) throw new Error('Dokploy did not report the ChatGPT gateway backup as enabled after provisioning');
  process.stdout.write(`Enabled daily retained backup for ChatGPT gateway volume ${volume.volumeName}\n`);
  return verified;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { apiBase, responseItems, gatewayDataVolume, selectDestination, main };
