const net = require('net');
const crypto = require('crypto');
const path = require('path');
const os = require('os');
const fs = require('fs/promises');
const { Worker } = require('worker_threads');
const AdmZip = require('adm-zip');
const { DomainError } = require('../../contracts/competency');
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_TEXT = 200000;
let activeScans = 0;
let activeParsers = 0;
const mime = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain' };
function inspectFile({ buffer, originalName, mimeType }) {
    if (!Buffer.isBuffer(buffer) || !buffer.length)
        throw new DomainError(422, 'UNSAFE_FILE', 'Choose a non-empty PDF, DOCX or TXT file.');
    if (buffer.length > MAX_BYTES)
        throw new DomainError(413, 'FILE_TOO_LARGE', 'Choose a file no larger than 10 MiB.');
    const extension = path.extname(String(originalName || '')).slice(1).toLowerCase();
    if (!mime[extension] || mimeType !== mime[extension])
        throw new DomainError(422, 'UNSAFE_FILE', 'Choose a PDF, DOCX or TXT file.');
    if (extension === 'pdf' && !buffer.subarray(0, 5).equals(Buffer.from('%PDF-')))
        throw new DomainError(422, 'UNSAFE_FILE', 'The file does not match its type.');
    if (extension === 'txt') {
        if (buffer.subarray(0, 5).toString() === '%PDF-' || buffer.subarray(0, 2).toString() === 'PK')
            throw new DomainError(422, 'UNSAFE_FILE', 'The file does not match its plain text type.');
        try {
            const t = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
            if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(t))
                throw Error();
        }
        catch {
            throw new DomainError(422, 'UNSAFE_FILE', 'Choose a UTF-8 plain text file.');
        }
    }
    if (extension === 'docx') {
        try {
            if (buffer.readUInt32LE(0) !== 0x04034b50)
                throw Error();
            const entries = new AdmZip(buffer).getEntries();
            if (entries.length > 1000 || !entries.some(e => e.entryName === 'word/document.xml') || !entries.some(e => e.entryName === '[Content_Types].xml'))
                throw Error();
            let expanded = 0;
            for (const e of entries) {
                expanded += e.header.size;
                if (expanded > 30 * 1024 * 1024 || e.header.size > 10 * 1024 * 1024 || (e.header.size > 1024 * 1024 && e.header.size / Math.max(1, e.header.compressedSize) > 100) || e.entryName.includes('..') || e.entryName.startsWith('/') || e.entryName.includes('\\') || /vbaProject\.bin|embeddings\//i.test(e.entryName) || e.header.flags & 1)
                    throw Error();
            }
        }
        catch {
            throw new DomainError(422, 'UNSAFE_FILE', 'The DOCX file is invalid or exceeds safe document limits.');
        }
    }
    return { extension, mimeType: mime[extension], size: buffer.length, sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
}
function clamavScan(buffer) {
    const host = process.env.COMPETENCY_CLAMAV_HOST;
    if (!host)
        throw new DomainError(503, 'SCAN_UNAVAILABLE', 'File checking is unavailable. You can create the role manually.');
    const port = Number(process.env.COMPETENCY_CLAMAV_PORT || 3310);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new DomainError(503, 'SCAN_UNAVAILABLE', 'File checking is unavailable.');
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host, port });
        let output = '';
        let complete = false;
        const fail = () => { if (complete)
            return; complete = true; socket.destroy(); reject(new DomainError(503, 'SCAN_UNAVAILABLE', 'File checking is unavailable. You can continue manually.')); };
        socket.setTimeout(15000, fail);
        socket.on('error', fail);
        socket.on('connect', () => { socket.write(Buffer.from('zINSTREAM\0')); for (let offset = 0; offset < buffer.length; offset += 65536) {
            const chunk = buffer.subarray(offset, offset + 65536);
            const size = Buffer.alloc(4);
            size.writeUInt32BE(chunk.length);
            socket.write(size);
            socket.write(chunk);
        } socket.write(Buffer.alloc(4)); });
        socket.on('data', chunk => { output += chunk.toString(); if (output.length > 4096)
            return fail(); if (!output.includes('\0') && !output.includes('\n'))
            return; if (complete)
            return; complete = true; socket.destroy(); if (/\bFOUND(?:\s|\0|$)/.test(output))
            reject(new DomainError(422, 'UNSAFE_FILE', 'This file cannot be used. Choose another document.'));
        else if (/^stream: OK\s*\0?$/.test(output))
            resolve({ provider: 'clamav-instream', version: 'INSTREAM', scannedAt: new Date().toISOString() });
        else
            reject(new DomainError(503, 'SCAN_UNAVAILABLE', 'File checking did not complete.')); });
        socket.on('close', () => { if (!complete)
            fail(); });
    });
}
async function inspectAndScan(input, adapter) {
    if (activeScans >= 2) throw new DomainError(429, 'SCAN_BUSY', 'File checking is busy. Try again shortly or continue manually.');
    activeScans++;
    try {
    const inspected = inspectFile(input);
    // Adapter injection is for explicitly labelled scanner protocol tests only.
    const scanner = await (adapter ? adapter.scan(input.buffer) : clamavScan(input.buffer));
    if (!scanner || !scanner.provider)
        throw new DomainError(503, 'SCAN_UNAVAILABLE', 'File checking did not complete.');
    return { status: 'clean', ...inspected, scanner };
    } finally { activeScans--; }
}
async function extractText(buffer, extension) {
    if (extension === 'txt')
        return { text: buffer.toString('utf8').slice(0, MAX_TEXT), warnings: buffer.length > MAX_TEXT ? ['Source text was truncated. Review the original.'] : [] };
    if (activeParsers >= 2) throw new DomainError(429, 'PARSER_BUSY', 'Document extraction is busy. Try again shortly or continue manually.');
    activeParsers++;
    try { return await new Promise((resolve, reject) => {
        const worker = new Worker(`const {parentPort,workerData}=require('worker_threads');(async()=>{const b=Buffer.from(workerData.buffer);let text;if(workerData.extension==='pdf'){const p=await require(workerData.pdf)(new Uint8Array(b),{max:200,version:'v2.0.550'});text=p.text;}else{text=(await require(workerData.mammoth).extractRawText({buffer:b})).value;}parentPort.postMessage({text:String(text).slice(0,200000)});})().catch(()=>parentPort.postMessage({error:true}));`, { eval: true, resourceLimits: { maxOldGenerationSizeMb: 128 }, workerData: { buffer, extension, pdf: require.resolve('pdf-parse'), mammoth: require.resolve('mammoth') } });
        let done = false;
        const finish = (err, data) => { if (done)
            return; done = true; clearTimeout(timer); worker.terminate(); err ? reject(err) : resolve(data); };
        const timer = setTimeout(() => finish(new DomainError(422, 'UNREADABLE_FILE', 'We could not read this document. Enter the role manually.')), 8000);
        worker.on('error', () => finish(new DomainError(422, 'UNREADABLE_FILE', 'We could not read this document. Enter the role manually.')));
        worker.on('message', m => m.error ? finish(new DomainError(422, 'UNREADABLE_FILE', 'Upload an unlocked, readable document or continue manually.')) : finish(null, { text: m.text, warnings: ['Source locations are unavailable. Check the original document.'] }));
        worker.on('exit', code => { if (code !== 0 && !done)
            finish(new DomainError(422, 'UNREADABLE_FILE', 'Document processing exceeded safe limits.')); });
    });    } finally { activeParsers--; }
}
function privateRoot() { if (process.env.NODE_ENV === 'production' && !process.env.COMPETENCY_PRIVATE_STORAGE_ROOT)
    throw new DomainError(503, 'PRIVATE_STORAGE_UNAVAILABLE', 'Private document storage is unavailable. You can continue manually.'); return path.resolve(process.env.COMPETENCY_PRIVATE_STORAGE_ROOT || path.join(os.tmpdir(), 'seemplify-competency-private')); }
async function storePrivate(buffer, options = {}) { if (options.documentType === 'cv') return require('./managedCvStorageService').store(buffer, options); const root = privateRoot(); await fs.mkdir(root, { recursive: true, mode: 0o700 }); const key = crypto.randomUUID(); await fs.writeFile(path.join(root, key), buffer, { flag: 'wx', mode: 0o600 }); return key; }
async function readPrivate(key) { if (String(key).startsWith('cloudinary-cv:')) return require('./managedCvStorageService').read(key); if (!/^[a-f\d-]{36}$/i.test(String(key)))
    throw new DomainError(404, 'NOT_FOUND', 'Source not found.'); try {
    return await fs.readFile(path.join(privateRoot(), key));
}
catch {
    throw new DomainError(404, 'NOT_FOUND', 'Source is no longer available.');
} }
async function deletePrivate(key) { if (String(key).startsWith('cloudinary-cv:')) return require('./managedCvStorageService').remove(key); if (!/^[a-f\d-]{36}$/i.test(String(key)))
    throw new DomainError(404, 'NOT_FOUND', 'Private source not found.'); try {
    await fs.unlink(path.join(privateRoot(), key));
}
catch (error) {
    if (error.code !== 'ENOENT')
        throw new DomainError(503, 'PRIVATE_DELETION_UNAVAILABLE', 'Private source deletion could not complete. Try again.');
} }
module.exports = { MAX_BYTES, inspectFile, inspectAndScan, extractText, storePrivate, readPrivate, deletePrivate };
