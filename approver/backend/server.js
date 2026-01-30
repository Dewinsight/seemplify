// Load base .env file first
require('dotenv').config();

// Load environment-specific .env file if it exists
const env = process.env.NODE_ENV || 'development';
require('dotenv').config({ path: `.env.${env}` });
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 80;

// Middleware
app.use(cors({
    origin: process.env.NODE_ENV === 'production' ? true : (process.env.FRONTEND_URL || 'http://localhost:5173'),
    credentials: true
}));
app.use(express.json());

// Database Connection
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('Connected to MongoDB (Approver DB)'))
    .catch(err => console.error('MongoDB connection error:', err));

// Routes
const apiRoutes = require('./routes/api');
app.use('/api', apiRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// API-only backend (frontend is deployed separately)
app.get('/', (req, res) => {
    res.json({ 
        message: 'Approver Backend API',
        version: '1.0.0',
        endpoints: {
            health: '/api/health',
            api: '/api/*'
        }
    });
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
});
