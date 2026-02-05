# Coturn Integration for WebRTC and Mediasoup

This document describes how to use the Seemplify Coturn server (`turn.seemplifyai.com`) for WebRTC and Mediasoup, including test results and code examples.

---

## 1. Test Results (Coturn API)

| Endpoint | Method | Result |
|----------|--------|--------|
| **Health** | `GET https://turn.seemplifyai.com/api/health` | `200` — `{"status":"ok","service":"turn-api"}` |
| **Credentials** | `GET https://turn.seemplifyai.com/api/turn-credentials` | `200` — JSON with `urls`, `username`, `credential`, `ttl` |

### Sample credentials response

```json
{
  "urls": [
    "turn:turn.seemplifyai.com:3478?transport=udp",
    "turn:turn.seemplifyai.com:3478?transport=tcp"
  ],
  "username": "1770134698:86400",
  "credential": "Yp5egMdlN73TnSm6L849B3tYAuU=",
  "ttl": 86400
}
```

- **TTL**: 24 hours (86400 seconds). Fetch new credentials before expiry if a session lasts longer.
- **STUN** (no auth): You can use `stun:turn.seemplifyai.com:3478` for STUN-only; TURN entries require `username` and `credential`.

### Quick test from terminal

```bash
# Health
curl -s https://turn.seemplifyai.com/api/health

# Credentials (use in your app)
curl -s https://turn.seemplifyai.com/api/turn-credentials
```

---

## 2. WebRTC Integration

Use the credentials API to build `iceServers` for `RTCPeerConnection`. Prefer fetching once per session (or when creating the first peer connection) and reusing; refresh before TTL expiry if needed.

### 2.1 Fetch credentials and build `iceServers`

```typescript
const TURN_CREDENTIALS_URL = 'https://turn.seemplifyai.com/api/turn-credentials';

interface TurnCredentials {
  urls: string[];
  username: string;
  credential: string;
  ttl: number;
}

async function getIceServers(): Promise<RTCIceServer[]> {
  const fallback: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' }
  ];

  try {
    const res = await fetch(TURN_CREDENTIALS_URL);
    if (!res.ok) return fallback;
    const data: TurnCredentials = await res.json();

    const turnServers: RTCIceServer[] = data.urls.map(url => ({
      urls: url,
      username: data.username,
      credential: data.credential
    }));

    return [
      { urls: 'stun:turn.seemplifyai.com:3478' },
      ...turnServers,
      ...fallback
    ];
  } catch {
    return fallback;
  }
}
```

### 2.2 Use in `RTCPeerConnection`

```typescript
// One-time or when starting a call
const iceServers = await getIceServers();

const rtcConfig: RTCConfiguration = {
  iceServers
};

const pc = new RTCPeerConnection(rtcConfig);
// ... rest of your WebRTC flow (createOffer, setLocalDescription, etc.)
```

### 2.3 Angular / experienments2 (messaging component)

In `messaging.component.ts`, replace the static `rtcConfig` with credentials from the API:

1. **Fetch credentials when the component initializes (or when joining voice):**

```typescript
private rtcConfig: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

async ngOnInit() {
  // ... existing init ...
  await this.loadTurnCredentials();
}

private async loadTurnCredentials(): Promise<void> {
  try {
    const res = await this.http.get<{ urls: string[]; username: string; credential: string }>(
      'https://turn.seemplifyai.com/api/turn-credentials'
    ).toPromise();
    if (res?.urls?.length && res.username && res.credential) {
      const turnServers: RTCIceServer[] = res.urls.map(url => ({
        urls: url,
        username: res!.username,
        credential: res!.credential
      }));
      this.rtcConfig = {
        iceServers: [
          { urls: 'stun:turn.seemplifyai.com:3478' },
          ...turnServers,
          { urls: 'stun:stun.l.google.com:19302' }
        ]
      };
    }
  } catch (e) {
    console.warn('TURN credentials unavailable, using STUN only', e);
  }
}
```

2. **Use `this.rtcConfig`** in `getOrCreatePeerConnection()` and `getOrCreateDmPeerConnection()` (already used via `new RTCPeerConnection(this.rtcConfig)`). No other changes required.

3. **Optional:** Call `loadTurnCredentials()` again before creating a new call if the session may outlast the TTL (e.g. 24h).

---

## 3. Mediasoup Integration

Mediasoup uses **WebRtcTransport** (and optionally **PlainTransport**). For WebRtcTransport, the server creates the transport with `iceServers`; the browser connects using the same ICE parameters. You can pass the same TURN credentials from the Coturn API.

### 3.1 Server-side (Node.js) — transport options

Fetch credentials on the server (or receive them from your app config) and pass them when creating the WebRtcTransport:

```javascript
const https = require('https');

function fetchTurnCredentials() {
  return new Promise((resolve, reject) => {
    https.get('https://turn.seemplifyai.com/api/turn-credentials', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// When creating the router or WebRtcTransport:
const turnCredentials = await fetchTurnCredentials();

const webRtcTransport = await router.createWebRtcTransport({
  listenIps: [ { ip: '0.0.0.0', announcedIp: 'YOUR_PUBLIC_IP' } ],
  enableUdp: true,
  enableTcp: true,
  preferUdp: true,
  iceServers: [
    { urls: 'stun:turn.seemplifyai.com:3478' },
    ...turnCredentials.urls.map(url => ({
      urls: url,
      username: turnCredentials.username,
      credential: turnCredentials.credential
    }))
  ],
  // ... other options
});
```

The client will receive `iceServers` (and other transport options) via your signaling; ensure the same TURN credentials (or a fresh fetch from the same API) are used on the client when creating the mediasoup `Device` / transport so that ICE succeeds.

### 3.2 Client-side (browser) — mediasoup Device

Your signaling server should send `iceServers` (and `iceCandidates`, etc.) to the client. The client uses them when creating the transport:

```typescript
// After receiving transport params from your server (e.g. via socket)
const transport = device.createRecvTransport({
  id: serverTransport.id,
  iceServers: serverTransport.iceServers,  // from your server (Coturn credentials)
  iceCandidates: serverTransport.iceCandidates,
  dtlsParameters: serverTransport.dtlsParameters,
  // ...
});
```

Alternatively, the client can fetch TURN credentials itself and merge with server-provided ICE candidates:

```typescript
const creds = await fetch('https://turn.seemplifyai.com/api/turn-credentials').then(r => r.json());
const iceServers = [
  { urls: 'stun:turn.seemplifyai.com:3478' },
  ...creds.urls.map((url: string) => ({ urls: url, username: creds.username, credential: creds.credential }))
];

const transport = device.createRecvTransport({
  id: serverTransport.id,
  iceServers,
  iceCandidates: serverTransport.iceCandidates,
  dtlsParameters: serverTransport.dtlsParameters,
});
```

### 3.3 Credential refresh

Credentials expire after `ttl` seconds (e.g. 86400). For long-lived Mediasoup sessions, either:

- Re-fetch from `GET /api/turn-credentials` before creating new transports, or  
- Have your server cache credentials and refresh when they are close to expiry (e.g. timestamp in username).

---

## 4. Summary

| Use case | Credentials source | Where to use |
|----------|--------------------|--------------|
| **WebRTC (RTCPeerConnection)** | `GET https://turn.seemplifyai.com/api/turn-credentials` | `RTCConfiguration.iceServers` |
| **Mediasoup (WebRtcTransport)** | Same API (server or client) | Server: `createWebRtcTransport({ iceServers })`; client: same `iceServers` in `createRecvTransport` / `createSendTransport` |

- **STUN only:** `stun:turn.seemplifyai.com:3478`  
- **TURN (with auth):** Use `urls`, `username`, and `credential` from `/api/turn-credentials`  
- **CORS:** The credentials API allows browser requests; use the same URL from your frontend or backend.

For the experienments2 messaging app, integrating the Coturn TURN server means calling the credentials API once (e.g. in `ngOnInit` or when entering voice), then setting `rtcConfig.iceServers` as above so all new `RTCPeerConnection` instances use TURN and improve connectivity behind symmetric NATs and strict firewalls.
