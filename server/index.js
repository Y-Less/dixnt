// Web server: serves the built client and the card images, and runs the game over Socket.IO.
// One game only, shared by everyone who connects. State is saved to data/game-state.json.
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { Game, GameError } from './game.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const cardsDir = process.env.CARDS_DIR ? path.resolve(process.env.CARDS_DIR) : path.join(root, 'cards');
const distDir = path.join(root, 'dist');
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, 'data');
const stateFile = path.join(dataDir, 'game-state.json');
const hintsFile = path.resolve(root, '..', 'hints.txt');

/** Ids of every card that has a web-sized image on disk. */
function getCardIds() {
  const dir = path.join(cardsDir, 'medium');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((name) => /^card_(\d+)\.jpg$/.exec(name))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
}

/**
 * The cards grouped into categories. cards/categories.json (written by tools/optimise_cards.py) lists the
 * categories; only cards whose image exists are offered. Without that file every card is one "All cards" category.
 */
let categoryCache = { at: 0, value: [] };
function getCategories() {
  if (Date.now() - categoryCache.at < 5000) return categoryCache.value;
  const present = new Set(getCardIds());
  let defined = null;
  try {
    defined = JSON.parse(fs.readFileSync(path.join(cardsDir, 'categories.json'), 'utf8')).categories;
  } catch {
    // no categories file
  }
  let value;
  if (!Array.isArray(defined)) {
    value = present.size ? [{ key: 'all', label: 'All cards', description: '', ids: [...present] }] : [];
  } else {
    value = defined
      .map((c) => ({ key: c.key, label: c.label, description: c.description ?? '', ids: c.ids.filter((id) => present.has(id)) }))
      .filter((c) => c.ids.length);
  }
  categoryCache = { at: Date.now(), value };
  return value;
}

function loadHints() {
  if (!fs.existsSync(hintsFile)) return [];
  return fs
    .readFileSync(hintsFile, 'utf8')
    .replace(/^﻿/, '') // tolerate a byte-order mark from Windows editors
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function loadSavedState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return null;
  }
}

const game = new Game({ getCategories, hints: loadHints(), saved: loadSavedState() });

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = `${stateFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(game.toJSON()));
    fs.renameSync(tmp, stateFile);
  }, 300);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use('/cards', express.static(cardsDir, { maxAge: '7d', immutable: true }));
app.use(express.static(distDir));
app.get('/{*splat}', (req, res, next) => {
  const index = path.join(distDir, 'index.html');
  if (fs.existsSync(index)) res.sendFile(index);
  else next();
});

// socket.id -> player token. A player can have several sockets (e.g. a phone and a laptop).
const tokenBySocket = new Map();

function connectedPlayerIds() {
  const ids = new Set();
  for (const token of tokenBySocket.values()) {
    const player = game.findByToken(token);
    if (player) ids.add(player.id);
  }
  return ids;
}

function broadcast() {
  const connected = connectedPlayerIds();
  for (const [socketId, token] of tokenBySocket) {
    const player = game.findByToken(token);
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) continue;
    socket.emit('state', player ? game.viewFor(player.id, connected) : null);
  }
}

function playerOf(socket) {
  const token = tokenBySocket.get(socket.id);
  return (token && game.findByToken(token)) ?? null;
}

function respond(ack, fn) {
  const reply = typeof ack === 'function' ? ack : () => {};
  try {
    reply({ ok: true, ...(fn() ?? {}) });
  } catch (error) {
    if (error instanceof GameError) {
      reply({ ok: false, error: error.message });
    } else {
      console.error(error);
      reply({ ok: false, error: 'Something went wrong on the server.' });
    }
  }
  scheduleSave();
  broadcast();
}

/** Registers an action that needs a joined player. `run(player, payload)` may return extra ack fields. */
function action(socket, event, run) {
  socket.on(event, (payload, ack) =>
    respond(ack, () => {
      const player = playerOf(socket);
      if (!player) throw new GameError('You are not in this game.');
      return run(player, payload ?? {});
    }),
  );
}

const validToken = (token) => typeof token === 'string' && token.length >= 16 && token.length <= 100;

io.on('connection', (socket) => {
  // Reconnect: succeeds only if the token belongs to a player who is still in the game.
  socket.on('resume', (payload, ack) =>
    respond(ack, () => {
      const token = payload?.token;
      if (!validToken(token) || !game.findByToken(token)) throw new GameError('Please join the game.');
      tokenBySocket.set(socket.id, token);
    }),
  );

  socket.on('join', (payload, ack) =>
    respond(ack, () => {
      const token = payload?.token;
      if (!validToken(token)) throw new GameError('Missing player token.');
      if (!game.findByToken(token)) game.addPlayer(payload?.name, token);
      tokenBySocket.set(socket.id, token);
    }),
  );

  socket.on('disconnect', () => {
    tokenBySocket.delete(socket.id);
    broadcast();
  });

  action(socket, 'leave', (player) => {
    game.removePlayer(player.id, player.id);
    tokenBySocket.delete(socket.id);
    socket.emit('state', null);
  });
  action(socket, 'setHandSize', (player, { size }) => game.setHandSize(player.id, size));
  action(socket, 'setJudging', (player, { mode }) => game.setJudging(player.id, mode));
  action(socket, 'setCategories', (player, { keys }) => game.setCategories(player.id, keys));
  action(socket, 'start', (player) => game.start(player.id));
  action(socket, 'endGame', (player) => game.returnToLobby(player.id));
  action(socket, 'hints', () => ({ hints: game.nextHints(3) }));
  action(socket, 'submitWord', (player, { word }) => game.submitWord(player.id, word));
  action(socket, 'playCard', (player, { cardId }) => game.playCard(player.id, Number(cardId)));
  action(socket, 'vote', (player, { targetId }) => game.vote(player.id, targetId));
  action(socket, 'nextRound', (player) => game.nextRound(player.id));
  action(socket, 'abortRound', (player) => game.abortRound(player.id));
  action(socket, 'removePlayer', (player, { targetId }) => game.removePlayer(player.id, targetId));
});

server.listen(PORT, () => {
  console.log(`Imposter Dixit listening on http://localhost:${PORT}`);
  const categories = getCategories();
  console.log(`${getCardIds().length} cards in ${categories.length} categories, ${game.hints.length} hints.`);
  if (!fs.existsSync(distDir)) console.log('No client build found. Run "npm run build", or use "npm run dev".');
});
