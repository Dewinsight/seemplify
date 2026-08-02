#!/bin/bash
# Restore Production Code Changes for Approver App
# Updates server.js, api/index.ts, and vite.config.ts for production deployment

set -e

echo "=========================================="
echo "Restoring Production Code Changes"
echo "=========================================="
echo ""

APPROVER_DIR="approver"
BACKEND_DIR="$APPROVER_DIR/backend"
FRONTEND_DIR="$APPROVER_DIR/frontend"

# Check if directories exist
if [ ! -d "$BACKEND_DIR" ] || [ ! -d "$FRONTEND_DIR" ]; then
  echo "❌ Error: approver/backend or approver/frontend directory not found!"
  exit 1
fi

# Step 1: Update backend/server.js
echo "📝 Updating backend/server.js..."

cat > "$BACKEND_DIR/server.js" << 'SERVER_EOF'
require('dotenv').config({ path: '.env.production' });
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

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, 'frontend/dist')));
    
    // SPA fallback - serve index.html for all non-API routes
    app.get('*', (req, res) => {
        if (!req.path.startsWith('/api')) {
            res.sendFile(path.join(__dirname, 'frontend/dist/index.html'));
        }
    });
} else {
    // Development route
    app.get('/', (req, res) => {
        res.json({ message: 'Approver Backend API is running (Development Mode)' });
    });
}

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
});
SERVER_EOF

echo "✅ backend/server.js updated"

# Step 2: Update frontend/src/api/index.ts
echo "📝 Updating frontend/src/api/index.ts..."

cat > "$FRONTEND_DIR/src/api/index.ts" << 'API_EOF'
import axios from 'axios';

const api = axios.create({
    baseURL: import.meta.env.PROD ? '/api' : 'http://localhost:5000/api',
});

export default api;
API_EOF

echo "✅ frontend/src/api/index.ts updated"

# Step 3: Update frontend/vite.config.ts
echo "📝 Updating frontend/vite.config.ts..."

cat > "$FRONTEND_DIR/vite.config.ts" << 'VITE_EOF'
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  
  return {
    plugins: [react()],
    define: {
      'import.meta.env.PROD': JSON.stringify(mode === 'production'),
    },
  };
});
VITE_EOF

echo "✅ frontend/vite.config.ts updated"

# Step 4: Create .env.production files if they don't exist
echo "📝 Checking .env.production files..."

if [ ! -f "$BACKEND_DIR/.env.production" ]; then
    cat > "$BACKEND_DIR/.env.production" << 'ENV_EOF'
# Production Environment Variables for Approver Backend
NODE_ENV=production
PORT=80
FRONTEND_URL=https://approver.aiinigeria.com
ENV_EOF
    echo "✅ Created backend/.env.production"
else
    echo "⚠️  backend/.env.production already exists (skipped)"
fi

if [ ! -f "$FRONTEND_DIR/.env.production" ]; then
    cat > "$FRONTEND_DIR/.env.production" << 'ENV_EOF'
# Production environment for Approver Frontend
VITE_PROD=true
VITE_API_BASE_URL=/api
ENV_EOF
    echo "✅ Created frontend/.env.production"
else
    echo "⚠️  frontend/.env.production already exists (skipped)"
fi

echo ""
echo "=========================================="
echo "✅ Production Code Changes Restored!"
echo "=========================================="
echo ""
echo "Files updated:"
echo "  ✅ approver/backend/server.js"
echo "  ✅ approver/frontend/src/api/index.ts"
echo "  ✅ approver/frontend/vite.config.ts"
echo ""
echo "Next: Run setup-approver-project.sh to create Dokploy project"
echo ""
