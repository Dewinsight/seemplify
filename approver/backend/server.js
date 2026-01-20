require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
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

// Basic Route
app.get('/', (req, res) => {
    res.json({ message: 'Approver Backend API is running' });
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
