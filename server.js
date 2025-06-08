const http = require('node:http');
const express = require('express');
const { Server } = require('socket.io');
const path = require('node:path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Allow all origins for development; restrict in production
    methods: ['GET', 'POST']
  }
});

// Serve static files from the current directory
app.use(express.static(path.join(__dirname)));

// Store player states
const players = {};
const scores = {};
let lastHolder = null;

// Ball state
let ball = {
  x: 0,
  y: 1,
  z: 0,
  vx: 0.08,
  vy: 0,
  vz: 0.07,
  heldBy: null // socket.id if held, null if free
};

// Emit ball state to all clients
function emitBall() {
  io.emit('ball-update', ball);
}

// Handle new socket connections
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('new-player', (data) => {
    // Assign a unique jersey color for the first two players
    let color;
    if (assignedColors.length < 2) {
      // Pick a random color not already assigned
      const available = jerseyColors.filter(c => !assignedColors.includes(c));
      color = available[Math.floor(Math.random() * available.length)];
      assignedColors.push(color);
    } else {
      // For additional players, just pick randomly
      color = jerseyColors[Math.floor(Math.random() * jerseyColors.length)];
    }

    players[socket.id] = {
      color,
      skinTone: getRandomSkinTone(),
      x: 0,
      z: 0
    };
    scores[socket.id] = 0;
    io.emit('players-update', players);
    io.emit('scores-update', { players, scores });
  });

  // Player moves
  socket.on('move', ({ x, z, y, yaw }) => {
    if (players[socket.id]) {
      players[socket.id].x = x;
      players[socket.id].z = z;
      players[socket.id].y = y;      // Add this line
      players[socket.id].yaw = yaw;
      io.emit('players-update', players);
    }
  });

  // Update score
  socket.on('score', ({ color }) => {
    scores[socket.id] = (scores[socket.id] || 0) + 1;
    io.emit('scores-update', { players, scores });
  });

  // Send current ball state to new client
  socket.emit('ball-update', ball);

  // Ball pickup
  socket.on('pickup-ball', () => {
    if (ball.heldBy === null && players[socket.id]) {
      // Check proximity (simple 2D check)
      const dx = players[socket.id].x - ball.x;
      const dz = players[socket.id].z - ball.z;
      if (Math.sqrt(dx*dx + dz*dz) < 0.5) {
        ball.heldBy = socket.id;
        emitBall();
      }
    }
  });

  // Ball drop (optional, e.g. on jump or key)
  socket.on('drop-ball', () => {
    if (ball.heldBy === socket.id) {
      lastHolder = socket.id;
      ball.heldBy = null;
      // Give the ball a little toss
      ball.vx = (Math.random() - 0.5) * 0.2;
      ball.vy = 0.15;
      ball.vz = (Math.random() - 0.5) * 0.2;
      emitBall();
    }
  });

  // Shooting (left click)
  socket.on('shoot-ball', ({ dir, power }) => {
    if (ball.heldBy === socket.id) {
      lastHolder = socket.id;
      ball.heldBy = null;
      // Clamp power between 0.5 and 1.5 for reasonable shots
      const p = Math.max(0.5, Math.min(power, 1.5));
      ball.vx = dir.x * 0.22 * p;
      ball.vy = dir.y * 0.22 * p;
      ball.vz = dir.z * 0.22 * p;
      emitBall();
    }
  });

  // On disconnect, drop the ball if held
  socket.on('disconnect', () => {
    if (ball.heldBy === socket.id) {
      ball.heldBy = null;
      emitBall();
    }
    // Free up their color if they were one of the first two
    if (players[socket.id]) {
      const idx = assignedColors.indexOf(players[socket.id].color);
      if (idx !== -1) assignedColors.splice(idx, 1);
    }
    delete players[socket.id];
    delete scores[socket.id];
    io.emit('players-update', players);
    io.emit('scores-update', { players, scores });
  });

  // Charging state
  socket.on('charging', (state) => {
    if (players[socket.id]) {
      players[socket.id].charging = state;
      io.emit('players-update', players); // or your usual update event
    }
  });
});

// Define a route for the root URL
app.get('/', (req, res) => {
  res.send('Socket.IO server is running!');
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Socket.IO server running on port ${PORT}`);
});

// Ball physics loop (runs on server)
setInterval(() => {
  if (!ball.heldBy) {
    // Gravity
    ball.vy += -0.025;
    ball.x += ball.vx;
    ball.y += ball.vy;
    ball.z += ball.vz;

    // Bounce off ground
    if (ball.y - 0.18 < 0) {
      ball.y = 0.18;
      ball.vy *= -0.7;
      ball.vx *= 0.96;
      ball.vz *= 0.96;
      if (Math.abs(ball.vy) < 0.01) ball.vy = 0;
    }
    // Bounce off walls
    if (ball.x - 0.18 < -4) { ball.x = -4 + 0.18; ball.vx *= -0.7; }
    if (ball.x + 0.18 > 4)  { ball.x = 4 - 0.18;  ball.vx *= -0.7; }
    if (ball.z - 0.18 < -7.5) { ball.z = -7.5 + 0.18; ball.vz *= -0.7; }
    if (ball.z + 0.18 > 7.5)  { ball.z = 7.5 - 0.18;  ball.vz *= -0.7; }

    // --- Backboard collision and bounce ---
    // Backboard 1 (behind hoop1)
    if (
      Math.abs(ball.x - hoop1.x) < 0.6 && // within backboard width
      ball.y > 2 && ball.y < 3.2 && // within backboard height
      ball.z < backboardZ1 + 0.1 && ball.z > backboardZ1 - 0.2
    ) {
      if (ball.vz < 0) {
        ball.z = backboardZ1 + 0.11;
        ball.vz *= -0.6;
        ball.vx *= 0.85;
        ball.vy *= 0.85;
      }
    }
    // Backboard 2 (behind hoop2)
    if (
      Math.abs(ball.x - hoop2.x) < 0.6 &&
      ball.y > 2 && ball.y < 3.2 &&
      ball.z > backboardZ2 - 0.1 && ball.z < backboardZ2 + 0.2
    ) {
      if (ball.vz > 0) {
        ball.z = backboardZ2 - 0.11;
        ball.vz *= -0.6;
        ball.vx *= 0.85;
        ball.vy *= 0.85;
      }
    }

    // Rim collision/bounce for both hoops
    function handleRimCollision(rim) {
      const rimRadius = 0.4;
      const rimThickness = 0.04;
      const ballRadius = 0.18;

      // Only check if ball is near rim height
      if (ball.y > rim.y - 0.25 && ball.y < rim.y + 0.25) {
        const dx = ball.x - rim.x;
        const dz = ball.z - rim.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        // Only bounce if ball is actually intersecting the rim tube
        if (dist > rimRadius - rimThickness - ballRadius && dist < rimRadius + rimThickness + ballRadius) {
          const nx = dx / dist;
          const nz = dz / dist;
          const targetDist = rimRadius + rimThickness + ballRadius + 0.001;
          ball.x = rim.x + nx * targetDist;
          ball.z = rim.z + nz * targetDist;
          const vDotN = ball.vx * nx + ball.vz * nz;
          ball.vx -= 2 * vDotN * nx;
          ball.vz -= 2 * vDotN * nz;
          ball.vx *= 0.6;
          ball.vz *= 0.6;
          ball.vy *= 0.92;
        }
      }
    }

    handleRimCollision({ x: 0, y: 2.5, z: -7.2 }); // hoop1
    handleRimCollision({ x: 0, y: 2.5, z: 7.2 });  // hoop2

    // Track who last shot/touched the ball


    checkScore(hoop1, lastHolder);
    checkScore(hoop2, lastHolder);
  } else if (players[ball.heldBy]) {
    // Follow the player holding the ball
    ball.x = players[ball.heldBy].x;
    ball.y = (players[ball.heldBy].y || 0) + 1.0;
    ball.z = players[ball.heldBy].z;
    ball.vx = 0; ball.vy = 0; ball.vz = 0;
  }
  emitBall();
}, 30);

// Hoops and backboards
const hoop1 = { x: 0, y: 2.5, z: -7.2 };
const hoop2 = { x: 0, y: 2.5, z: 7.2 };
const backboardZ1 = -7.5 + 0.05; // just behind hoop1
const backboardZ2 = 7.5 - 0.05;  // just behind hoop2

// Helper: check if ball scored through a hoop
function checkScore(hoop, lastHolder) {
  const rimRadius = 0.4;
  const dx = ball.x - hoop.x;
  const dz = ball.z - hoop.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (
    dist < rimRadius - 0.03 && // allow a little margin inside rim
    ball.y > hoop.y - 0.22 && ball.y < hoop.y + 0.22 &&
    ball.vy < 0
  ) {
    // Award point to last holder (the shooter)
    if (lastHolder && scores[lastHolder] !== undefined) {
      scores[lastHolder]++;
      io.emit('scores-update', { players, scores });

      // Check for win
      if (scores[lastHolder] >= 10) {
        io.emit('game-winner', { winner: lastHolder, color: players[lastHolder].color });
        // Optionally reset scores/ball here
        Object.keys(scores).forEach(id => scores[id] = 0);
        io.emit('scores-update', { players, scores });
      }
    }
    // Reset ball to center
    ball.x = 0;
    ball.y = 1;
    ball.z = 0;
    ball.vx = (Math.random() > 0.5 ? 1 : -1) * 0.08;
    ball.vy = 0;
    ball.vz = (Math.random() > 0.5 ? 1 : -1) * 0.07;
    ball.heldBy = null;
    emitBall();
  }
}

// Preset skin tones and random picker
const skinTones = [
  0xffe0bd, // light
  0xffcd94,
  // 0xeac086,
  0xffad60,
  0x8d5524, // dark
  0xc68642,
  0xe0ac69,
  0xf1c27d
];
function getRandomSkinTone() {
  return skinTones[Math.floor(Math.random() * skinTones.length)];
}

// Preset jersey colors
const jerseyColors = [
  0xffa500, 0x00aaff, 0xff00aa, 0x00ffaa, 0xffff00, 0xff4444, 0x8888ff
];

// Track assigned jersey colors for first two players
let assignedColors = [];