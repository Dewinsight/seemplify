import crypto from 'node:crypto';
import dgram from 'node:dgram';
import dns from 'node:dns/promises';
import https from 'node:https';

const MAGIC_COOKIE = 0x2112a442;
const TURN_HOST = process.env.TURN_HOST || 'turn.seemplifyai.com';
const TURN_PORT = Number(process.env.TURN_PORT || 3478);
const CREDENTIALS_URL = process.env.TURN_CREDENTIALS_URL
  || `https://${TURN_HOST}/api/turn-credentials`;

const ATTR = {
  username: 0x0006,
  messageIntegrity: 0x0008,
  errorCode: 0x0009,
  lifetime: 0x000d,
  realm: 0x0014,
  nonce: 0x0015,
  xorRelayedAddress: 0x0016,
  requestedTransport: 0x0019,
};

const METHOD = {
  allocate: 0x003,
  refresh: 0x004,
};

function encodeMessageType(method, messageClass) {
  return (method & 0x000f)
    | ((method & 0x0070) << 1)
    | ((method & 0x0f80) << 2)
    | ((messageClass & 0x01) << 4)
    | ((messageClass & 0x02) << 7);
}

function encodeAttribute(type, value) {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const paddingLength = (4 - (data.length % 4)) % 4;
  const output = Buffer.alloc(4 + data.length + paddingLength);
  output.writeUInt16BE(type, 0);
  output.writeUInt16BE(data.length, 2);
  data.copy(output, 4);
  return output;
}

function uint32(value) {
  const output = Buffer.alloc(4);
  output.writeUInt32BE(value >>> 0);
  return output;
}

function buildMessage(method, attributes, transactionId, integrityKey) {
  const encodedAttributes = Buffer.concat(attributes.map(([type, value]) => encodeAttribute(type, value)));
  const integrityLength = integrityKey ? 24 : 0;
  const header = Buffer.alloc(20);
  header.writeUInt16BE(encodeMessageType(method, 0), 0);
  header.writeUInt16BE(encodedAttributes.length + integrityLength, 2);
  header.writeUInt32BE(MAGIC_COOKIE, 4);
  transactionId.copy(header, 8);

  if (!integrityKey) return Buffer.concat([header, encodedAttributes]);

  const digest = crypto
    .createHmac('sha1', integrityKey)
    .update(Buffer.concat([header, encodedAttributes]))
    .digest();
  return Buffer.concat([
    header,
    encodedAttributes,
    encodeAttribute(ATTR.messageIntegrity, digest),
  ]);
}

function parseMessage(message) {
  if (message.length < 20 || message.readUInt32BE(4) !== MAGIC_COOKIE) {
    throw new Error('invalid STUN response');
  }

  const declaredLength = message.readUInt16BE(2);
  if (message.length < 20 + declaredLength) throw new Error('truncated STUN response');

  const attributes = new Map();
  let offset = 20;
  const end = 20 + declaredLength;
  while (offset + 4 <= end) {
    const type = message.readUInt16BE(offset);
    const length = message.readUInt16BE(offset + 2);
    const valueStart = offset + 4;
    const valueEnd = valueStart + length;
    if (valueEnd > end) throw new Error('invalid STUN attribute length');
    attributes.set(type, message.subarray(valueStart, valueEnd));
    offset = valueEnd + ((4 - (length % 4)) % 4);
  }

  return {
    type: message.readUInt16BE(0),
    transactionId: message.subarray(8, 20),
    attributes,
  };
}

function errorCode(response) {
  const value = response.attributes.get(ATTR.errorCode);
  if (!value || value.length < 4) return 0;
  return (value[2] & 0x07) * 100 + value[3];
}

async function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: 15000 }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`credentials endpoint returned HTTP ${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('credentials endpoint returned invalid JSON'));
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('credentials request timed out')));
    request.on('error', reject);
  });
}

async function exchange(socket, address, message, transactionId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeListener('message', onMessage);
      reject(new Error('TURN UDP response timed out'));
    }, 10000);

    function onMessage(data) {
      let parsed;
      try {
        parsed = parseMessage(data);
      } catch {
        return;
      }
      if (!crypto.timingSafeEqual(parsed.transactionId, transactionId)) return;
      clearTimeout(timer);
      socket.removeListener('message', onMessage);
      resolve(parsed);
    }

    socket.on('message', onMessage);
    socket.send(message, TURN_PORT, address, (error) => {
      if (!error) return;
      clearTimeout(timer);
      socket.removeListener('message', onMessage);
      reject(error);
    });
  });
}

async function run() {
  const credentials = await getJson(CREDENTIALS_URL);
  const expiry = Number(String(credentials.username || '').split(':', 1)[0]);
  if (!Number.isFinite(expiry) || expiry <= Math.floor(Date.now() / 1000)) {
    throw new Error('credentials endpoint returned an expired username');
  }

  const { address, family } = await dns.lookup(TURN_HOST, { family: 4 });
  if (family !== 4) throw new Error('TURN hostname did not resolve to IPv4');

  const socket = dgram.createSocket('udp4');
  try {
    const firstTransaction = crypto.randomBytes(12);
    const unauthenticated = buildMessage(
      METHOD.allocate,
      [[ATTR.requestedTransport, Buffer.from([17, 0, 0, 0])]],
      firstTransaction,
    );
    const challenge = await exchange(socket, address, unauthenticated, firstTransaction);
    if (challenge.type !== encodeMessageType(METHOD.allocate, 3) || errorCode(challenge) !== 401) {
      throw new Error('TURN server did not return the expected authentication challenge');
    }

    const realm = challenge.attributes.get(ATTR.realm);
    const nonce = challenge.attributes.get(ATTR.nonce);
    if (!realm?.length || !nonce?.length) throw new Error('TURN challenge omitted realm or nonce');

    const username = Buffer.from(credentials.username, 'utf8');
    const password = String(credentials.credential || '');
    const integrityKey = crypto
      .createHash('md5')
      .update(`${credentials.username}:${realm.toString('utf8')}:${password}`)
      .digest();

    const allocateTransaction = crypto.randomBytes(12);
    const allocationRequest = buildMessage(
      METHOD.allocate,
      [
        [ATTR.username, username],
        [ATTR.realm, realm],
        [ATTR.nonce, nonce],
        [ATTR.requestedTransport, Buffer.from([17, 0, 0, 0])],
      ],
      allocateTransaction,
      integrityKey,
    );
    const allocation = await exchange(socket, address, allocationRequest, allocateTransaction);
    if (allocation.type === encodeMessageType(METHOD.allocate, 3)) {
      throw new Error(`TURN allocation was rejected with ${errorCode(allocation) || 'an unknown error'}`);
    }
    if (
      allocation.type !== encodeMessageType(METHOD.allocate, 2)
      || !allocation.attributes.has(ATTR.xorRelayedAddress)
    ) {
      throw new Error('TURN allocation response omitted the relayed address');
    }

    const refreshTransaction = crypto.randomBytes(12);
    const closeRequest = buildMessage(
      METHOD.refresh,
      [
        [ATTR.username, username],
        [ATTR.realm, realm],
        [ATTR.nonce, nonce],
        [ATTR.lifetime, uint32(0)],
      ],
      refreshTransaction,
      integrityKey,
    );
    await exchange(socket, address, closeRequest, refreshTransaction).catch(() => {});
    console.log('PASS authenticated TURN UDP allocation succeeded from the external client');
  } finally {
    socket.close();
  }
}

run().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
});
