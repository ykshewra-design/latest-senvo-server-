// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

// ✅ Allow all origins for Socket.IO
const io = new Server(server, { cors: { origin: "*" } });

// Queues for random matching
const queues = { video: [], voice: [], text: [] };

// Helper: remove a socket from all queues
function removeFromQueues(socket) {
  for (const mode in queues) {
    const idx = queues[mode].findIndex(s => s.id === socket.id);
    if (idx >= 0) queues[mode].splice(idx, 1);
  }
}

// Matchmaker
function tryMatch(mode) {
  const queue = queues[mode];
  while (queue.length >= 2) {
    const peer1 = queue.shift();
    const peer2 = queue.shift();

    // Prevent self-match just in case
    if (!peer1 || !peer2 || peer1.id === peer2.id) continue;

    const room = `${peer1.id}#${peer2.id}`;
    peer1.join(room);
    peer2.join(room);

    io.to(peer1.id).emit("matched", { peerId: peer2.id, mode, room });
    io.to(peer2.id).emit("matched", { peerId: peer1.id, mode, room });

    // Notify both peers about participants
    const peersInRoom = [peer1.id, peer2.id];
    io.to(peer1.id).emit("peers-in-room", peersInRoom);
    io.to(peer2.id).emit("peers-in-room", peersInRoom);
  }
}

io.on("connection", socket => {
  console.log("🟢 User connected:", socket.id);

  // When client requests to find a match
  socket.on("find", ({ mode }) => {
    if (!["video", "voice", "text"].includes(mode)) return;
    removeFromQueues(socket);
    queues[mode].push(socket);
    tryMatch(mode);
  });

  // Allow joining specific room (global or private)
  socket.on("join-room", room => socket.join(room));

  // WebRTC Signaling
  socket.on("offer", data => {
    io.to(data.to).emit("offer", { from: socket.id, sdp: data.sdp });
  });
  socket.on("answer", data => {
    io.to(data.to).emit("answer", { from: socket.id, sdp: data.sdp });
  });
  socket.on("ice-candidate", data => {
    io.to(data.to).emit("ice-candidate", { from: socket.id, candidate: data.candidate });
  });

  // ✅ Fixed: Public chat messages now go to everyone except sender
  socket.on("message", ({ room, from, text }) => {
    if (!room) return;
    socket.to(room).emit("message", { from, text });
  });

  socket.on("disconnect", () => {
    removeFromQueues(socket);
    console.log("🔴 User disconnected:", socket.id);
  });
});

// Listen on Render's dynamic port or local 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Signaling server running on port ${PORT}`));
