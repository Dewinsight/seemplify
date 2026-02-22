import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import session from 'express-session';
import { connectDatabase } from './config/database.js';
import authRoutes from './routes/auth.js';
import nylasRoutes from './routes/nylas.js';
import emailRoutes from './routes/emails.js';
import aiRoutes from './routes/ai.js';
import campaignRoutes from './routes/campaign.js';
import EmailPollingService from './services/emailPollingService.js';

// Load environment variables
dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.NODE_ENV === 'production'
      ? ['https://yourdomain.com']
      : ['http://localhost:5173', 'http://localhost:3000'],
    credentials: true,
  },
});

const PORT = process.env.PORT || 5001;

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS configuration
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://yourdomain.com'] // Replace with your production domain
    : ['http://localhost:5173', 'http://localhost:3000'], // Development origins
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Session middleware (for OAuth state)
app.use(session({
  secret: process.env.SECRET_KEY || 'your-secret-key-here',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production' },
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging middleware
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Auto Mailer API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/nylas', nylasRoutes);
app.use('/api/interviews', nylasRoutes); // Legacy route for Nylas callback
app.use('/api/emails', emailRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/campaigns', campaignRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Welcome to Auto Mailer API',
    version: '1.0.0',
    documentation: '/api/docs',
    endpoints: {
      health: '/health',
      auth: '/api/auth',
      nylas: '/api/nylas',
      emails: '/api/emails',
      ai: '/api/ai',
    }
  });
});

// 404 handler - catches all unmatched routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    path: req.originalUrl,
    method: req.method
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Global error handler:', error);
  
  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  res.status(error.status || 500).json({
    success: false,
    message: error.message || 'Internal Server Error',
    ...(isDevelopment && { 
      stack: error.stack,
      error: error 
    })
  });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  // Join user-specific room
  socket.on('join', (userId) => {
    socket.join(userId);
    console.log(`👤 User ${userId} joined their room`);
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
  });
});

// Start server
const startServer = async () => {
  try {
    // Connect to database
    await connectDatabase();
    
    // Start HTTP server (with Socket.io)
    httpServer.listen(PORT, () => {
      console.log(`🚀 Auto Mailer API server running on port ${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`📖 Health check: http://localhost:${PORT}/health`);
      console.log(`🔐 Auth endpoints: http://localhost:${PORT}/api/auth`);
      console.log(`📧 Email endpoints: http://localhost:${PORT}/api/emails`);
      console.log(`🔗 Nylas endpoints: http://localhost:${PORT}/api/nylas`);
      console.log(`⚡ Socket.io enabled for real-time updates`);
    });

    // Start email polling service
    const emailPolling = new EmailPollingService(io);
    emailPolling.start();

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('⏹️  SIGTERM received, shutting down gracefully');
      emailPolling.stop();
      httpServer.close(() => {
        console.log('👋 Server closed');
        process.exit(0);
      });
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

startServer();

export default app;
