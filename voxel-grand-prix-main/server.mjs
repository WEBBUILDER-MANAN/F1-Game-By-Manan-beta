import { WebSocketServer } from 'ws';

const port = Number(process.env.MULTIPLAYER_PORT || 8787);
const rooms = new Map();
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function code() {
  let value = '';
  do { value = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join(''); }
  while (rooms.has(value));
  return value;
}

function send(socket, message) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

const wss = new WebSocketServer({ port });
wss.on('connection', socket => {
  socket.on('message', raw => {
    let message;
    try { message = JSON.parse(raw); } catch { return; }
    if (message.type === 'create') {
      const room = code();
      rooms.set(room, new Set([socket]));
      socket.room = room;
      send(socket, { type: 'room', code: room, host: true });
      return;
    }
    if (message.type === 'join') {
      const room = rooms.get(String(message.code || '').toUpperCase());
      if (!room || room.size >= 2) { send(socket, { type: 'error', message: 'Room is unavailable.' }); return; }
      room.add(socket); socket.room = String(message.code).toUpperCase();
      send(socket, { type: 'room', code: socket.room, host: false });
      for (const peer of room) if (peer !== socket) send(peer, { type: 'peer-joined' });
      return;
    }
    if (message.type === 'state' && socket.room) {
      const room = rooms.get(socket.room);
      if (room) for (const peer of room) if (peer !== socket) send(peer, { type: 'state', state: message.state });
    }
  });
  socket.on('close', () => {
    if (!socket.room) return;
    const room = rooms.get(socket.room);
    if (!room) return;
    room.delete(socket);
    for (const peer of room) send(peer, { type: 'peer-left' });
    if (!room.size) rooms.delete(socket.room);
  });
});

console.log(`Multiplayer server listening on ws://localhost:${port}`);
