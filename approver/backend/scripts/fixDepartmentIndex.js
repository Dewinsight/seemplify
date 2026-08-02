/**
 * One-time fix: Drop incorrect unique index on departments.name
 * The index name_1 (unique on name only) blocks multiple "General" departments.
 * We only need name_1_organization_1 (unique per org).
 * Run: node scripts/fixDepartmentIndex.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    const coll = mongoose.connection.db.collection('departments');

    try {
        await coll.dropIndex('name_1');
        console.log('Dropped incorrect index: name_1');
    } catch (e) {
        if (e.code === 27 || e.message?.includes('index not found')) {
            console.log('Index name_1 already removed');
        } else throw e;
    }
    await mongoose.disconnect();
    process.exit(0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
