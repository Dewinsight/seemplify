require('dotenv').config();

const connectDatabase = require('../config/database');
const { seedDefaultAttendancePolicies } = require('../services/defaultPolicySeedService');

async function run() {
    await connectDatabase();
    const result = await seedDefaultAttendancePolicies();
    console.log(JSON.stringify(result));
    process.exit(0);
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
