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

// Static files for uploaded logos
const uploadsPath = path.join(__dirname, 'uploads');
app.use('/api/uploads', express.static(uploadsPath));
const organizationController = require('./controllers/organizationController');

// Fallback logo serving from MongoDB when filesystem uploads are unavailable after redeploy.
app.get('/api/uploads/logos/:filename', organizationController.serveLogo);

// Middleware
const configuredOrigins = (process.env.FRONTEND_URLS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

const devDefaultOrigins = [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    'http://localhost:5174'
];

const allowedOrigins = new Set([
    ...configuredOrigins,
    ...(process.env.NODE_ENV === 'production' ? [] : devDefaultOrigins)
]);

app.use(cors({
    origin: (origin, callback) => {
        // Allow non-browser requests (no Origin header).
        if (!origin) return callback(null, true);

        if (process.env.NODE_ENV === 'production') {
            if (allowedOrigins.size === 0 || allowedOrigins.has(origin)) {
                return callback(null, true);
            }
            return callback(new Error('Not allowed by CORS'));
        }

        if (allowedOrigins.has(origin)) {
            return callback(null, true);
        }

        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Organization-Id']
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
