// Web server: serves the built client and the card images, and runs the game over Socket.IO.
// Any number of games, each with its own invite code. State is saved to data/games.json.
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
const stateFile = path.join(dataDir, 'game-state.json'); // the single game saved before invite codes existed
const gamesFile = path.join(dataDir, 'games.json');
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

const hints = loadHints();

// ---- games: one per invite code (three hint words, e.g. "boss-aware-you") ----
const MAX_GAMES = 500;
const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000; // games nobody has touched for two weeks are forgotten
const CODE_WORDS = hints.filter((h) => /^[a-z]+$/.test(h));
const CODE_SHAPE = /^[a-z]+(-[a-z]+){2}$/;

/** code -> { game, touched } */
const games = new Map();

/** Tidies what a person typed or pasted ("Boss Aware You", "invite?boss-aware-you", a whole link) into a code. */
function normaliseCode(raw) {
  if (typeof raw !== 'string') return '';
  let code = raw.trim().toLowerCase();
  if (code.includes('?')) code = code.slice(code.lastIndexOf('?') + 1);
  code = code.replace(/^code=/, '').replace(/[^a-z]+/g, '-').replace(/^-+|-+$/g, '');
  return CODE_SHAPE.test(code) ? code : '';
}

function newCode() {
  if (CODE_WORDS.length < 3) throw new GameError('The word list is too short to make invite codes.');
  for (let i = 0; i < 1000; i++) {
    const words = [];
    while (words.length < 3) {
      const word = CODE_WORDS[Math.floor(Math.random() * CODE_WORDS.length)];
      if (!words.includes(word)) words.push(word);
    }
    const code = words.join('-');
    if (!games.has(code)) return code;
  }
  throw new GameError('Could not make an invite code. Please try again.');
}

function createGame(saved = null, touched = Date.now(), code = newCode()) {
  const game = new Game({ getCategories, hints, saved });
  games.set(code, { game, touched });
  return { code, game };
}

function loadSavedGames() {
  try {
    const saved = JSON.parse(fs.readFileSync(gamesFile, 'utf8'));
    for (const [code, entry] of Object.entries(saved.games ?? {})) {
      if (CODE_SHAPE.test(code) && Date.now() - entry.touched < STALE_AFTER_MS) createGame(entry.game, entry.touched, code);
    }
    return;
  } catch {
    // no saved games yet
  }
  // Before invite codes there was a single game in game-state.json. Keep it, under a new code.
  try {
    const legacy = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    const { code } = createGame(legacy);
    console.log(`Moved the saved game from before invite codes to the code ${code}.`);
  } catch {
    // nothing to move
  }
}
loadSavedGames();

function pruneGames() {
  let changed = false;
  for (const [code, entry] of games) {
    if (Date.now() - entry.touched > STALE_AFTER_MS || entry.game.s.players.length === 0) {
      games.delete(code);
      changed = true;
    }
  }
  if (changed) scheduleSave();
}
setInterval(pruneGames, 60 * 60 * 1000).unref();

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(dataDir, { recursive: true });
    const saved = { version: 2, games: {} };
    for (const [code, { game, touched }] of games) saved.games[code] = { touched, game: game.toJSON() };
    const tmp = `${gamesFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(saved));
    fs.renameSync(tmp, gamesFile);
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

// socket.id -> { code, token }: which game a connection is in and which player it is. A player can have several
// sockets (e.g. a phone and a laptop).
const sessions = new Map();

function connectedPlayerIds(code) {
  const { game } = games.get(code);
  const ids = new Set();
  for (const session of sessions.values()) {
    if (session.code !== code) continue;
    const player = game.findByToken(session.token);
    if (player) ids.add(player.id);
  }
  return ids;
}

/** Sends every connection in the game its own personalised view (or null if it is no longer in the game). */
function broadcast(code) {
  const entry = games.get(code);
  const connected = entry ? connectedPlayerIds(code) : null;
  for (const [socketId, session] of [...sessions]) {
    if (session.code !== code) continue;
    const socket = io.sockets.sockets.get(socketId);
    const player = entry?.game.findByToken(session.token);
    if (!player) sessions.delete(socketId);
    socket?.emit('state', player ? { ...entry.game.viewFor(player.id, connected), code } : null);
  }
}

function playerOf(socket) {
  const session = sessions.get(socket.id);
  const entry = session && games.get(session.code);
  return entry ? entry.game.findByToken(session.token) : null;
}

const gameOf = (socket) => games.get(sessions.get(socket.id)?.code)?.game;

function respond(socket, ack, fn) {
  const reply = typeof ack === 'function' ? ack : () => {};
  const before = sessions.get(socket.id)?.code;
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
  for (const code of new Set([before, sessions.get(socket.id)?.code])) {
    if (!code) continue;
    const entry = games.get(code);
    if (entry) {
      entry.touched = Date.now();
      if (entry.game.s.players.length === 0) games.delete(code); // the last player left
    }
    broadcast(code);
  }
  scheduleSave();
}

/** Registers an action that needs a joined player. `run(player, payload, game)` may return extra ack fields. */
function action(socket, event, run) {
  socket.on(event, (payload, ack) =>
    respond(socket, ack, () => {
      const player = playerOf(socket);
      if (!player) throw new GameError('You are not in this game.');
      return run(player, payload ?? {}, gameOf(socket));
    }),
  );
}

const validToken = (token) => typeof token === 'string' && token.length >= 16 && token.length <= 100;

const requireGame = (rawCode) => {
  const code = normaliseCode(rawCode);
  const entry = code && games.get(code);
  if (!entry) throw new GameError('There is no game with that code.');
  return { code, game: entry.game };
};

io.on('connection', (socket) => {
  // Does a game with this code exist? (The invite page asks before showing the join form.)
  socket.on('lookup', (payload, ack) => {
    const code = normaliseCode(payload?.code);
    if (typeof ack === 'function') ack({ ok: true, code, exists: Boolean(code && games.has(code)) });
  });

  // Reconnect: succeeds only if the token belongs to a player who is still in that game.
  socket.on('resume', (payload, ack) =>
    respond(socket, ack, () => {
      const token = payload?.token;
      const code = normaliseCode(payload?.code);
      if (!validToken(token) || !code || !games.get(code)?.game.findByToken(token)) throw new GameError('Please join the game.');
      sessions.set(socket.id, { code, token });
      return { code };
    }),
  );

  socket.on('create', (payload, ack) =>
    respond(socket, ack, () => {
      const token = payload?.token;
      if (!validToken(token)) throw new GameError('Missing player token.');
      if (games.size >= MAX_GAMES) throw new GameError('There are too many games running. Please try again later.');
      const { code, game } = createGame();
      try {
        game.addPlayer(payload?.name, token);
      } catch (error) {
        games.delete(code);
        throw error;
      }
      sessions.set(socket.id, { code, token });
      return { code };
    }),
  );

  socket.on('join', (payload, ack) =>
    respond(socket, ack, () => {
      const token = payload?.token;
      if (!validToken(token)) throw new GameError('Missing player token.');
      const { code, game } = requireGame(payload?.code);
      if (!game.findByToken(token)) game.addPlayer(payload?.name, token);
      sessions.set(socket.id, { code, token });
      return { code };
    }),
  );

  socket.on('disconnect', () => {
    const code = sessions.get(socket.id)?.code;
    sessions.delete(socket.id);
    if (code) broadcast(code);
  });

  action(socket, 'leave', (player, _payload, game) => {
    game.removePlayer(player.id, player.id);
    sessions.delete(socket.id);
    socket.emit('state', null);
  });
  action(socket, 'setHandSize', (player, { size }, game) => game.setHandSize(player.id, size));
  action(socket, 'setRounds', (player, { count }, game) => game.setRounds(player.id, count));
  action(socket, 'setJudging', (player, { mode }, game) => game.setJudging(player.id, mode));
  action(socket, 'setCategories', (player, { keys }, game) => game.setCategories(player.id, keys));
  action(socket, 'start', (player, _payload, game) => game.start(player.id));
  action(socket, 'endGame', (player, _payload, game) => game.returnToLobby(player.id));
  action(socket, 'hints', (_player, _payload, game) => ({ hints: game.nextHints(3) }));
  action(socket, 'submitWord', (player, { word }, game) => game.submitWord(player.id, word));
  action(socket, 'playCard', (player, { cardId }, game) => game.playCard(player.id, Number(cardId)));
  action(socket, 'vote', (player, { targetId }, game) => game.vote(player.id, targetId));
  action(socket, 'nextRound', (player, _payload, game) => game.nextRound(player.id));
  action(socket, 'abortRound', (player, _payload, game) => game.abortRound(player.id));
  action(socket, 'removePlayer', (player, { targetId }, game) => game.removePlayer(player.id, targetId));
});

server.listen(PORT, () => {
  console.log(`Dixnt listening on http://localhost:${PORT}`);
  const categories = getCategories();
  console.log(`${getCardIds().length} cards in ${categories.length} categories, ${hints.length} hints, ${games.size} saved games.`);
  if (!fs.existsSync(distDir)) console.log('No client build found. Run "npm run build", or use "npm run dev".');
});
