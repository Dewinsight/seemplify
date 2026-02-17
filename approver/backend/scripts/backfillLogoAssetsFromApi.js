/**
 * Backfill logo assets into MongoDB by downloading currently served logo URLs.
 * Use this before deploying logo-storage changes to preserve existing logos.
 */

require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');
const axios = require('axios');

const Organization = require('../models/Organization');
const LogoAsset = require('../models/LogoAsset');

const MIME_BY_EXT = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp'
};

const logoFields = ['logo', 'logoDark', 'logoLight'];
const baseUrl = (process.env.LOGO_BACKFILL_BASE_URL || 'https://api.approver.seemplifyai.com').replace(/\/$/, '');

const resolveFilename = (value) => {
    if (!value) return null;
    const filename = path.basename(String(value));
    return filename && filename !== '.' ? filename : null;
};

const resolveMimeType = (filename, headerValue) => {
    if (headerValue) return String(headerValue).split(';')[0].trim();
    const ext = path.extname(filename || '').toLowerCase();
    return MIME_BY_EXT[ext] || 'application/octet-stream';
};

async function fetchLogoBuffer(filename) {
    const url = `${baseUrl}/api/uploads/logos/${encodeURIComponent(filename)}`;
    const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 20000,
        validateStatus: () => true
    });

    if (response.status !== 200 || !response.data) {
        return { ok: false, status: response.status, url };
    }

    const buffer = Buffer.from(response.data);
    return {
        ok: true,
        buffer,
        mimeType: resolveMimeType(filename, response.headers?.['content-type']),
        size: buffer.length,
        url
    };
}

async function run() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');
    console.log(`Using source API: ${baseUrl}`);

    const orgs = await Organization.find({}, 'logo logoDark logoLight');
    let scanned = 0;
    let alreadyPresent = 0;
    let inserted = 0;
    let failed = 0;

    for (const org of orgs) {
        for (const field of logoFields) {
            const filename = resolveFilename(org[field]);
            if (!filename) continue;
            scanned += 1;

            const exists = await LogoAsset.exists({ filename });
            if (exists) {
                alreadyPresent += 1;
                continue;
            }

            try {
                const fetched = await fetchLogoBuffer(filename);
                if (!fetched.ok) {
                    failed += 1;
                    console.warn(`Failed (${fetched.status}) ${fetched.url}`);
                    continue;
                }

                await LogoAsset.create({
                    organization: org._id,
                    filename,
                    mimeType: fetched.mimeType,
                    size: fetched.size,
                    data: fetched.buffer
                });
                inserted += 1;
            } catch (error) {
                failed += 1;
                console.warn(`Failed ${filename}: ${error.message}`);
            }
        }
    }

    console.log(`Scanned ${scanned} logo reference(s).`);
    console.log(`Inserted ${inserted}, already present ${alreadyPresent}, failed ${failed}.`);

    await mongoose.disconnect();
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
