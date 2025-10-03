// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

// Socket.IO setup with CORS for public access
const io = new Server(server, { cors: { origin: "*" } });

// Queues for random matching
const queues = { video: [], voice: [], text: [] };

// Utility function to match peers
function tryMatch(mode) {
  const queue = queues[mode];
  while (queue.length >= 2) {
    const peer1 = queue.shift();
    const peer2 = queue.shift();
    const room = `${peer1.id}#${peer2.id}`;

    // Join room
    peer1.join(room);
    peer2.join(room);

    // Emit matched to both peers
    io.to(peer1.id).emit("matched", { peerId: peer2.id, mode, room });
    io.to(peer2.id).emit("matched", { peerId: peer1.id, mode, room });
  }
}

io.on("connection", socket => {
  console.log("New user connected:", socket.id);

  // Handle find requests
  socket.on("find", ({ mode }) => {
    if (!["video", "voice", "text"].includes(mode)) return;
    queues[mode].push(socket);
    tryMatch(mode); // attempt to match whenever a new user joins
  });

  // Handle join-room for text mode or reconnection
  socket.on("join-room", room => socket.join(room));

  // WebRTC signaling
  socket.on("offer", data => io.to(data.to).emit("offer", { from: socket.id, sdp: data.sdp }));
  socket.on("answer", data => io.to(data.to).emit("answer", { from: socket.id, sdp: data.sdp }));
  socket.on("ice-candidate", data => io.to(data.to).emit("ice-candidate", { from: socket.id, candidate: data.candidate }));

  // Handle text messages
  socket.on("message", ({ room, from, text }) => {
    if (!room) return;
    io.to(room).emit("message", { from, text });
  });

  // Clean up on disconnect
  socket.on("disconnect", () => {
    for (const mode in queues) {
      const idx = queues[mode].findIndex(s => s.id === socket.id);
      if (idx >= 0) queues[mode].splice(idx, 1);
    }
    console.log("User disconnected:", socket.id);
  });
});

// Listen on Render-provided PORT or fallback 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Signaling server running on port ${PORT}`));