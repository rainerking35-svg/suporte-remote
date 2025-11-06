const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
app.use(express.json());
const cors = require('cors');
app.use(cors());


const links = {};    // token -> { roomId, expiresAt }
const rooms = {};    // roomId -> { ownerSocketId, clientSocketId }

function genToken(len=7){
  return crypto.randomBytes(len).toString('base64url').slice(0, len).toUpperCase();
}

function cleanupExpired(){
  const now = Date.now();
  for(const t of Object.keys(links)){
    if(links[t].expiresAt <= now) delete links[t];
  }
}
setInterval(cleanupExpired, 30_000);

app.post('/create-link', (req, res) => {
  const minutes = Number(req.body.minutes) || 15;
  const roomId = req.body.roomId || genToken(6);
  const token = genToken(7);
  const ttl = minutes * 60 * 1000;
  links[token] = { roomId, expiresAt: Date.now() + ttl };
  return res.json({
    ok: true,
    token,
    url: `${req.protocol}://${req.get('host')}/join/${token}`,
    roomId,
    expiresAt: links[token].expiresAt
  });
});

app.get('/links', (req, res) => res.json(links)); // debug opcional

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

io.on('connection', socket => {
  socket.on('auth-token', (token) => {
    const entry = links[token];
    if(!entry || entry.expiresAt < Date.now()){
      socket.emit('auth-failed', { msg: 'token invalid or expired' });
      socket.disconnect(true);
      return;
    }
    const room = entry.roomId;
    socket.data.roomId = room;
    if(!rooms[room]) {
      rooms[room] = { owner: socket.id };
      socket.data.role = 'owner';
    } else {
      rooms[room].client = socket.id;
      socket.data.role = 'client';
      if(rooms[room].owner) io.to(rooms[room].owner).emit('peer-joined');
    }
    socket.join(room);
    socket.emit('auth-ok', { room });
  });

  socket.on('signal', ({ data }) => {
    const room = socket.data.roomId;
    if(!room) return;
    socket.to(room).emit('signal', data);
  });

  socket.on('disconnect', () => {
    const room = socket.data.roomId;
    if(!room) return;
    io.in(room).emit('peer-left');
    delete rooms[room];
    for(const t of Object.keys(links)){
      if(links[t].roomId === room) delete links[t];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=> console.log('Servidor rodando na porta', PORT));
