import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import mongoose from 'mongoose';
import http from 'http';
import { Server as SocketIO } from 'socket.io';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/user.js';
import adminRoutes from './routes/admin.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import Session from './models/Session.js';
import { APP_NAME, MONGODB_URI, PORT, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS } from '../config/constants.js';

dotenv.config();

const app = express();
const server = http.createServer(app);

const io = new SocketIO(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST']
  }
});

app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

app.use(requestLogger);

const authLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX_REQUESTS,
  message: { error: 'Too many requests, please try again later.' }
});

app.use('/api/', authLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use(errorHandler);

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

async function startServer() {
  try {
    await mongoose.connect(MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000
    });
    console.log('Connected to MongoDB');

    server.listen(PORT, () => {
      console.log(`${APP_NAME} server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);
  
  socket.on('authenticate', async (data) => {
    try {
      const session = await Session.findOne({ token: data.token });
      if (session && new Date(session.expiresAt) > new Date()) {
        socket.userId = session.userId;
        socket.join(`user:${session.userId}`);
        socket.emit('authenticated', { success: true });
      } else {
        socket.emit('authenticated', { success: false });
      }
    } catch (error) {
      socket.emit('authenticated', { success: false });
    }
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
  });
});

export { app, io, startServer };

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}