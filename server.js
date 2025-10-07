// server.js
const express = require("express");
const http = require("http");
const compression = require("compression");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
app.use(compression());

// Optional: serve static frontend if you put index.html in /public
// app.use(express.static(path.join(__dirname, "public")));

app.get("/", (_, res) => res.send("✅ Senvo signaling server active"));

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
  transports: ["websocket"],
});

// Queues and locks
const queues = { video: [], voice: [], text: [] };
const matchingLock = { video: false, voice: false, text: false };

// Helper remove socket from all queues
function removeFromQueues(socket) {
  for (const mode in queues) {
    const idx = queues[mode].findIndex(s => s.id === socket.id);
    if (idx >= 0) queues[mode].splice(idx, 1);
  }
}

// Matchmaker (safe with lock)
function tryMatch(mode) {
  if (matchingLock[mode]) return;
  matchingLock[mode] = true;

  const queue = queues[mode];
  while (queue.length >= 2) {
    const [peer1, peer2] = queue.splice(0, 2);
    if (!peer1 || !peer2 || peer1.id === peer2.id) continue;

    // Ensure removed from other queues
    removeFromQueues(peer1);
    removeFromQueues(peer2);

    const room = `${peer1.id}#${peer2.id}`;
    peer1.join(room);
    peer2.join(room);

    // Notify match
    io.to(peer1.id).emit("matched", { peerId: peer2.id, mode, room });
    io.to(peer2.id).emit("matched", { peerId: peer1.id, mode, room });

    // Provide peers-in-room list
    const participants = [peer1.id, peer2.id];
    io.to(peer1.id).emit("peers-in-room", participants);
    io.to(peer2.id).emit("peers-in-room", participants);
  }

  matchingLock[mode] = false;
}

io.on("connection", socket => {
  console.log("🟢 User connected:", socket.id);

  socket.on("find", ({ mode }) => {
    if (!["video", "voice", "text"].includes(mode)) return;
    removeFromQueues(socket);
    queues[mode].push(socket);
    tryMatch(mode);
  });

  socket.on("join-room", room => {
    if (!room || typeof room !== "string") return;
    socket.join(room);
  });

  socket.on("leave-room", ({ room }) => {
    if (!room || typeof room !== "string") return;
    try {
      socket.leave(room);
      io.to(room).emit("peer-left", { peerId: socket.id });
      console.log(`👋 ${socket.id} left room ${room}`);
    } catch (e) { /* ignore */ }
  });

  // Signaling (guard self)
  socket.on("offer", data => {
    if (!data || data.to === socket.id) return;
    io.to(data.to).emit("offer", { from: socket.id, sdp: data.sdp });
  });

  socket.on("answer", data => {
    if (!data || data.to === socket.id) return;
    io.to(data.to).emit("answer", { from: socket.id, sdp: data.sdp });
  });

  socket.on("ice-candidate", data => {
    if (!data || data.to === socket.id) return;
    io.to(data.to).emit("ice-candidate", { from: socket.id, candidate: data.candidate });
  });

  // Room messaging with basic checks
  socket.on("message", ({ room, from, text }) => {
    if (!room || typeof room !== "string" || !text) return;
    if (room.length > 300) return;
    socket.to(room).emit("message", { from, text });
  });

  socket.on("disconnect", reason => {
    removeFromQueues(socket);
    console.log("🔴 User disconnected:", socket.id, reason);
    try {
      for (const roomName of socket.rooms) {
        if (roomName !== socket.id) {
          io.to(roomName).emit("peer-left", { peerId: socket.id });
        }
      }
    } catch (e) { /* defensive */ }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Signaling server running on port ${PORT}`));
