const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Improved nearby-frequencies endpoint with better error handling
app.get('/nearby-frequencies', (req, res) => {
  try {
    const base = parseFloat(req.query.freq);

    if (isNaN(base)) {
      return res.status(400).json({ 
        error: 'Invalid frequency parameter. Please provide a valid number.' 
      });
    }

    const nearby = Array.from({ length: 5 }, (_, i) =>
      (base + (i - 2) * 0.025).toFixed(3)
    );

    res.json({ nearby });
  } catch (error) {
    console.error('Error in nearby-frequencies endpoint:', error);
    res.status(500).json({ error: 'Server error processing frequency request' });
  }
});

const server = http.createServer(app);
const io = new Server(server, { 
  cors: { origin: '*' },
  pingTimeout: 30000, // Add timeout configuration
  pingInterval: 10000
});

// Map to track users by callsign
const userMap = new Map();

io.on('connection', socket => {
  console.log(`Client connected: ${socket.id}`);

  socket.on('join', ({ callsign, frequency }) => {
    if (!callsign || !frequency) {
      socket.emit('error', 'Both callsign and frequency are required');
      return;
    }

    // Store user info
    socket.callsign = callsign;
    socket.frequency = frequency;
    userMap.set(callsign, socket.id);

    // Join the frequency room
    socket.join(frequency);

    // Notify others
    socket.to(frequency).emit('system', `${callsign} joined ${frequency}`);

    // Send list of users on this frequency to the new joiner
    const usersOnFrequency = [];
    for (const [socketId, socketObj] of io.of('/').sockets) {
      if (socketObj.frequency === frequency && socketObj.id !== socket.id) {
        usersOnFrequency.push(socketObj.callsign);
      }
    }

    if (usersOnFrequency.length > 0) {
      socket.emit('system', `Current users on ${frequency}: ${usersOnFrequency.join(', ')}`);
    }
  });

  socket.on('message', text => {
    if (!socket.frequency || !socket.callsign) {
      socket.emit('error', 'You need to join a frequency first');
      return;
    }

    io.to(socket.frequency).emit('message', {
      from: socket.callsign,
      text,
      ts: Date.now()
    });
  });

  socket.on('tx', isOn => {
    if (!socket.frequency || !socket.callsign) {
      socket.emit('error', 'You need to join a frequency first');
      return;
    }

    io.to(socket.frequency).emit('tx', {
      from: socket.callsign,
      on: isOn
    });
  });

  // WebRTC Signaling - Fixed to properly handle direct communication
  socket.on('ice-candidate', ({ to, candidate }) => {
    if (!socket.frequency || !socket.callsign) {
      socket.emit('error', 'You need to join a frequency first');
      return;
    }

    const targetSocketId = userMap.get(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('ice-candidate', {
        from: socket.callsign,
        candidate
      });
    }
  });

  socket.on('offer', ({ to, offer }) => {
    if (!socket.frequency || !socket.callsign) {
      socket.emit('error', 'You need to join a frequency first');
      return;
    }

    const targetSocketId = userMap.get(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('offer', {
        from: socket.callsign,
        offer
      });
    }
  });

  socket.on('answer', ({ to, answer }) => {
    if (!socket.frequency || !socket.callsign) {
      socket.emit('error', 'You need to join a frequency first');
      return;
    }

    const targetSocketId = userMap.get(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('answer', {
        from: socket.callsign,
        answer
      });
    }
  });

  socket.on('disconnect', () => {
    if (socket.callsign && socket.frequency) {
      socket.to(socket.frequency).emit('system', `${socket.callsign} left ${socket.frequency}`);
      userMap.delete(socket.callsign);
    }
    console.log(`Client disconnected: ${socket.id}`);
  });

  // Handle errors
  socket.on('error', (error) => {
    console.error(`Socket error for ${socket.id}:`, error);
  });
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down server...');
  io.close();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`rPilot API listening on port ${PORT}`);
});
