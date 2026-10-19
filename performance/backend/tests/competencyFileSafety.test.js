const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const AdmZip = require('adm-zip');
const safety = require('../services/competency/fileSafetyService');
const file = (buffer, originalName = 'role.txt', mimeType = 'text/plain') => ({ buffer, originalName, mimeType, purpose: 'role' });
test('type, signature and size validation is not represented as malware scanning', () => {
    assert.equal(safety.inspectFile(file(Buffer.from('Delivery role'))).extension, 'txt');
    assert.throws(() => safety.inspectFile(file(Buffer.alloc(safety.MAX_BYTES + 1))), e => e.status === 413);
    assert.throws(() => safety.inspectFile(file(Buffer.from('plain'), 'role.pdf', 'application/pdf')), e => e.code === 'UNSAFE_FILE');
    assert.throws(() => safety.inspectFile(file(Buffer.from('plain'), 'role.exe', 'application/octet-stream')), e => e.code === 'UNSAFE_FILE');
    assert.throws(() => safety.inspectFile(file(Buffer.from([0, 1, 2]))), e => e.code === 'UNSAFE_FILE');
    assert.throws(() => safety.inspectFile(file(Buffer.from([0xff, 0xfe]))), e => e.code === 'UNSAFE_FILE');
});
test('DOCX content and expansion limits reject other ZIPs, path traversal and highly compressed payloads', () => {
    const zip = new AdmZip();
    zip.addFile('[Content_Types].xml', Buffer.from('<Types/>'));
    zip.addFile('word/document.xml', Buffer.from('<document>Delivery</document>'));
    assert.equal(safety.inspectFile(file(zip.toBuffer(), 'role.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).extension, 'docx');
    const ordinary = new AdmZip();
    ordinary.addFile('source.txt', Buffer.from('Not DOCX'));
    assert.throws(() => safety.inspectFile(file(ordinary.toBuffer(), 'role.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')), e => e.code === 'UNSAFE_FILE');
    zip.addFile('word/media/large.txt', Buffer.alloc(2 * 1024 * 1024, 65));
    assert.throws(() => safety.inspectFile(file(zip.toBuffer(), 'role.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')), e => e.code === 'UNSAFE_FILE');
});
test('missing scanner fails closed, before parsing or storing any private file', async () => {
    const previous = process.env.COMPETENCY_CLAMAV_HOST;
    delete process.env.COMPETENCY_CLAMAV_HOST;
    try {
        await assert.rejects(safety.inspectAndScan(file(Buffer.from('Synthetic role'))), e => e.status === 503 && e.code === 'SCAN_UNAVAILABLE');
    }
    finally {
        if (previous)
            process.env.COMPETENCY_CLAMAV_HOST = previous;
    }
});
test('named mocked scanner adapter may prove service wiring but is not real antivirus acceptance', async () => {
    const result = await safety.inspectAndScan(file(Buffer.from('Synthetic role')), { scan: async () => ({ provider: 'MOCK antivirus adapter', version: 'fixture', scannedAt: new Date().toISOString() }) });
    assert.equal(result.status, 'clean');
    assert.match(result.scanner.provider, /MOCK/);
    assert.equal(result.sha256.length, 64);
    await assert.rejects(safety.inspectAndScan(file(Buffer.from('Synthetic role')), { scan: async () => null }), e => e.code === 'SCAN_UNAVAILABLE');
});
test('mock ClamAV TCP peer verifies INSTREAM framed bytes, clean, found and protocol-error branches', async () => {
    // This peer only simulates the ClamAV protocol. It does not inspect malware.
    let reply = 'stream: OK\0';
    const received = [];
    const server = net.createServer(socket => { let pending = Buffer.alloc(0), header = false; socket.on('data', chunk => { pending = Buffer.concat([pending, chunk]); if (!header) {
        if (pending.length < 10)
            return;
        assert.equal(pending.subarray(0, 10).toString(), 'zINSTREAM\0');
        pending = pending.subarray(10);
        header = true;
    } while (pending.length >= 4) {
        const size = pending.readUInt32BE(0);
        if (pending.length < size + 4)
            return;
        const data = pending.subarray(4, size + 4);
        pending = pending.subarray(size + 4);
        if (!size) {
            socket.end(reply);
            return;
        }
        received.push(data);
    } }); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const oldHost = process.env.COMPETENCY_CLAMAV_HOST, oldPort = process.env.COMPETENCY_CLAMAV_PORT;
    process.env.COMPETENCY_CLAMAV_HOST = '127.0.0.1';
    process.env.COMPETENCY_CLAMAV_PORT = String(server.address().port);
    try {
        const clean = await safety.inspectAndScan(file(Buffer.from('Synthetic transport check')));
        assert.equal(clean.status, 'clean');
        assert.equal(Buffer.concat(received).toString(), 'Synthetic transport check');
        reply = 'stream: Eicar-Test-Signature FOUND\0';
        await assert.rejects(safety.inspectAndScan(file(Buffer.from('not real malware detection'))), e => e.status === 422 && e.code === 'UNSAFE_FILE');
        reply = 'INSTREAM size limit exceeded. ERROR\0';
        await assert.rejects(safety.inspectAndScan(file(Buffer.from('Synthetic failure'))), e => e.status === 503 && e.code === 'SCAN_UNAVAILABLE');
    }
    finally {
        await new Promise(resolve => server.close(resolve));
        if (oldHost)
            process.env.COMPETENCY_CLAMAV_HOST = oldHost;
        else
            delete process.env.COMPETENCY_CLAMAV_HOST;
        if (oldPort)
            process.env.COMPETENCY_CLAMAV_PORT = oldPort;
        else
            delete process.env.COMPETENCY_CLAMAV_PORT;
    }
});
test('plain extraction is bounded; private source storage uses opaque keys and rejects traversal', async () => {
    const content = Buffer.from('Delivery role\nEvidence-based assessment.');
    const extracted = await safety.extractText(content, 'txt');
    assert.equal(extracted.text, content.toString());
    const key = await safety.storePrivate(content);
    try {
        assert.equal((await safety.readPrivate(key)).toString(), content.toString());
        await assert.rejects(safety.readPrivate('../secret'), e => e.status === 404);
    }
    finally {
        await safety.deletePrivate(key);
    }
    await assert.rejects(safety.readPrivate(key), e => e.status === 404);
});
test('valid PDFKit PDF extracts in the bounded worker using a Uint8Array parser input',async()=>{
  const PDFDocument=require('pdfkit');const bytes=await new Promise(resolve=>{const doc=new PDFDocument({compress:false,pdfVersion:'1.4'});const chunks=[];doc.on('data',chunk=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.text('Synthetic role: Delivery lead.');doc.end();});
  const extracted=await safety.extractText(bytes,'pdf');assert.match(extracted.text,/Delivery lead/);
});
