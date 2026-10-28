const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });
const PORT = process.env.PORT || 3000;
const MAX_ROOM_SIZE = 8;

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true, app: "Magnatto Studio" }));

io.on("connection", socket => {
  socket.on("room:join", ({ roomId, nickname, color } = {}, callback = () => {}) => {
    roomId = String(roomId || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 24);
    nickname = String(nickname || "Convidado").trim().slice(0, 24) || "Convidado";
    color = /^#[0-9A-F]{6}$/i.test(color || "") ? color : "#D9FF45";
    if (!roomId) return callback({ ok: false, error: "Informe um nome ou código de sala." });

    const room = io.sockets.adapter.rooms.get(roomId);
    if (room && room.size >= MAX_ROOM_SIZE) return callback({ ok: false, error: `Esta sala atingiu o limite de ${MAX_ROOM_SIZE} participantes.` });

    const existing = room ? [...room] : [];
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.nickname = nickname;
    socket.data.color = color;
    callback({ ok: true, roomId, peers: existing.map(id => {
      const s = io.sockets.sockets.get(id);
      return { id, nickname: s?.data.nickname || "Participante", color: s?.data.color || "#D9FF45" };
    }) });
    socket.to(roomId).emit("room:peer-joined", { id: socket.id, nickname, color });
    io.to(roomId).emit("room:count", io.sockets.adapter.rooms.get(roomId)?.size || 1);
  });

  socket.on("chat:message", ({ message } = {}) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    message = String(message || "").trim().slice(0, 500);
    if (!message) return;
    io.to(roomId).emit("chat:message", {
      id: socket.id,
      nickname: socket.data.nickname || "Convidado",
      color: socket.data.color || "#D9FF45",
      message,
      at: new Date().toISOString()
    });
  });

  socket.on("room:reaction", ({ emoji } = {}) => {
    const roomId = socket.data.roomId;
    const allowed = ["🔥", "💚", "😂", "👏", "👀", "💜"];
    if (!roomId || !allowed.includes(emoji)) return;
    io.to(roomId).emit("room:reaction", {
      id: socket.id,
      nickname: socket.data.nickname || "Convidado",
      emoji
    });
  });

  socket.on("webrtc:signal", ({ to, data } = {}) => {
    if (!to || !data || !socket.data.roomId) return;
    const target = io.sockets.sockets.get(to);
    if (target && target.data.roomId === socket.data.roomId) {
      io.to(to).emit("webrtc:signal", { from: socket.id, data });
    }
  });

  socket.on("room:leave", () => leaveRoom(socket));
  socket.on("disconnect", () => leaveRoom(socket));
});

function leaveRoom(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) return;
  socket.to(roomId).emit("room:peer-left", { id: socket.id });
  socket.leave(roomId);
  const remaining = io.sockets.adapter.rooms.get(roomId);
  if (remaining) io.to(roomId).emit("room:count", remaining.size);
  socket.data.roomId = null;
}

server.listen(PORT, () => console.log(`Magnatto Studio rodando em http://localhost:${PORT}`));
