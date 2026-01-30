const axios = require('axios');

async function seed() {
    try {
        const response = await axios.post('http://localhost:5000/api/auth/seed-admin');
        console.log('Seed Response:', response.data);
    } catch (error) {
        console.error('Seed Error:', error.message);
    }
}

seed();
