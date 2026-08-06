/**
 * Backfill existing disk logo files into MongoDB LogoAsset collection.
 * Useful before infrastructure changes or storage migrations.
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

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

const resolveFilename = (value) => {
    if (!value) return null;
    const filename = path.basename(String(value));
    return filename && filename !== '.' ? filename : null;
};

const resolveMimeType = (filename) => {
    const ext = path.extname(filename || '').toLowerCase();
    return MIME_BY_EXT[ext] || 'application/octet-stream';
};

async function run() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const orgs = await Organization.find({}, 'logo logoDark logoLight');
    const uploadsDir = path.join(__dirname, '..', 'uploads', 'logos');

    let scanned = 0;
    let inserted = 0;
    let updated = 0;
    let missingFiles = 0;

    for (const org of orgs) {
        for (const field of logoFields) {
            const filename = resolveFilename(org[field]);
            if (!filename) continue;

            scanned += 1;
            const diskPath = path.join(uploadsDir, filename);
            if (!fs.existsSync(diskPath)) {
                missingFiles += 1;
                continue;
            }

            const buffer = fs.readFileSync(diskPath);
            const existing = await LogoAsset.findOne({ filename }).select('_id');

            await LogoAsset.findOneAndUpdate(
                { filename },
                {
                    $set: {
                        organization: org._id,
                        mimeType: resolveMimeType(filename),
                        size: buffer.length,
                        data: buffer
                    }
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );

            if (existing) updated += 1;
            else inserted += 1;
        }
    }

    console.log(`Scanned ${scanned} logo reference(s).`);
    console.log(`Inserted ${inserted}, updated ${updated}, missing files ${missingFiles}.`);

    await mongoose.disconnect();
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
