// ✅ server.js — Senvo Signaling Server (stable version)

const express = require("express");
const http = require("http");
const compression = require("compression");
const { Server } = require("socket.io");

// ---------------------------
// App setup
// ---------------------------
const app = express();
app.use(compression());

// Optional: serve frontend (if you add index.html later)
// const path = require("path");
// app.use(express.static(path.join(__dirname, "public")));

app.get("/", (_, res) => {
  res.send("✅ Senvo signaling server active and healthy");
});

// ---------------------------
// HTTP + Socket.IO server
// ---------------------------
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ["websocket", "polling"],
});

// ---------------------------
// Matchmaking Queues
// ---------------------------
const queues = { video: [], voice: [], text: [] };
const lock = { video: false, voice: false, text: false };

// Helper: remove socket from all queues
function removeFromQueues(socket) {
  for (const mode in queues) {
    queues[mode] = queues[mode].filter(s => s.id !== socket.id);
  }
}

// Safe matchmaker
function tryMatch(mode) {
  if (lock[mode]) return;
  lock[mode] = true;

  const queue = queues[mode];
  while (queue.length >= 2) {
    const peer1 = queue.shift();
    const peer2 = queue.shift();

    if (!peer1 || !peer2 || peer1.id === peer2.id) continue;

    removeFromQueues(peer1);
    removeFromQueues(peer2);

    const room = `${peer1.id}#${peer2.id}`;

    peer1.join(room);
    peer2.join(room);

    const participants = [peer1.id, peer2.id];

    io.to(peer1.id).emit("matched", { peerId: peer2.id, mode, room });
    io.to(peer2.id).emit("matched", { peerId: peer1.id, mode, room });

    io.to(peer1.id).emit("peers-in-room", participants);
    io.to(peer2.id).emit("peers-in-room", participants);

    console.log(`🤝 Matched ${peer1.id} ↔ ${peer2.id} (${mode})`);
  }

  lock[mode] = false;
}

// ---------------------------
// Socket.IO handlers
// ---------------------------
io.on("connection", socket => {
  console.log("🟢 Connected:", socket.id);

  // 🔸 Find match
  socket.on("find", ({ mode }) => {
    if (!["video", "voice", "text"].includes(mode)) return;
    removeFromQueues(socket);
    queues[mode].push(socket);
    tryMatch(mode);
  });

  // 🔸 Join specific room
  socket.on("join-room", room => {
    if (typeof room === "string" && room.length < 200) {
      socket.join(room);
    }
  });

  // 🔸 Leave room
  socket.on("leave-room", ({ room }) => {
    if (typeof room === "string") {
      socket.leave(room);
      io.to(room).emit("peer-left", { peerId: socket.id });
    }
  });

  // 🔸 WebRTC signaling
  socket.on("offer", ({ to, sdp }) => {
    if (to && sdp) io.to(to).emit("offer", { from: socket.id, sdp });
  });

  socket.on("answer", ({ to, sdp }) => {
    if (to && sdp) io.to(to).emit("answer", { from: socket.id, sdp });
  });

  socket.on("ice-candidate", ({ to, candidate }) => {
    if (to && candidate) io.to(to).emit("ice-candidate", { from: socket.id, candidate });
  });

  // 🔸 Chat messages (only inside room)
  socket.on("message", ({ room, from, text }) => {
    if (room && typeof text === "string" && text.trim() !== "") {
      socket.to(room).emit("message", { from, text });
    }
  });

  // 🔸 Disconnect handler
  socket.on("disconnect", reason => {
    removeFromQueues(socket);
    console.log(`🔴 Disconnected: ${socket.id} (${reason})`);

    // Notify peers in all rooms this user was part of
    for (const roomName of socket.rooms) {
      if (roomName !== socket.id) {
        io.to(roomName).emit("peer-left", { peerId: socket.id });
      }
    }
  });
});

// ---------------------------
// Start server
// ---------------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Senvo signaling server running on port ${PORT}`);
});
