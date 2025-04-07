import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import cors from 'cors';
import config from './config';
import { setupRoutes } from './routes';

// Log configuration if verbose mode is enabled
if (config.verbose) {
  console.log('Starting server with configuration:', {
    port: config.port,
    ffmpegPath: config.ffmpegPath,
    verbose: config.verbose,
    debug: config.debug,
    nodeEnv: process.env.NODE_ENV
  });
}

// Create Express app
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../../dist/client')));

// Set up routes
setupRoutes(app, io);

// Socket.IO connection
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  if (config.verbose) {
    console.log('Client connection details:', {
      id: socket.id,
      address: socket.handshake.address,
      time: new Date().toISOString()
    });
  }
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
  
  // Log all events if debug mode is enabled
  if (config.debug) {
    socket.onAny((event, ...args) => {
      console.log(`[Socket Event] ${event}:`, args);
    });
  }
});

// Start server
const PORT = config.port;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  
  if (config.verbose) {
    console.log('Server environment:', {
      nodeEnv: process.env.NODE_ENV,
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version
    });
    
    // Log available routes if in debug mode
    if (config.debug) {
      console.log('Available routes:');
      app._router.stack.forEach((middleware: any) => {
        if (middleware.route) {
          console.log(`${Object.keys(middleware.route.methods).join(', ').toUpperCase()}\t${middleware.route.path}`);
        }
      });
    }
  }
});
