// A stand-alone bot player. It is a completely separate process that talks to the game server over the
// same Socket.IO API as the browser client, so you can run as many as you like.
//
//   npm run bot -- --name Robin
//   node bots/bot.js --name Robin --url http://192.168.1.20:3000
//
// Behaviour:
//   - when it is the chooser it asks the server for hint words (the game's own word list) and picks one
//   - when cards are being played it plays a random card from its hand
//   - when voting it votes for a random player (if the game's judging method lets it vote at all)
// It does not start the game or move on to the next round: a human (or another client) does that.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { io } from 'socket.io-client';

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: options } = parseArgs({
  options: {
    name: { type: 'string', short: 'n' },
    url: { type: 'string', short: 'u', default: 'http://localhost:3000' },
    delay: { type: 'string', short: 'd', default: '1000-4000' }, // min-max milliseconds to "think" for
    'token-file': { type: 'string', default: path.join(here, '.bot-tokens.json') },
    help: { type: 'boolean', short: 'h' },
  },
});

if (options.help) {
  console.log(`Usage: node bots/bot.js [--name NAME] [--url URL] [--delay MIN-MAX] [--token-file FILE]

  --name        the bot's player name (default: Bot-<random number>)
  --url         the game server (default: http://localhost:3000)
  --delay       how long to "think" before acting, in ms, as MIN-MAX (default: 1000-4000)
  --token-file  where to remember each bot's identity, so a restarted bot rejoins as the same player`);
  process.exit(0);
}

const name = options.name ?? `Bot-${Math.floor(100 + Math.random() * 900)}`;
const [minDelay, maxDelay] = options.delay.split('-').map(Number);
if (!(minDelay >= 0 && maxDelay >= minDelay)) {
  console.error('--delay must look like MIN-MAX, e.g. 1000-4000');
  process.exit(1);
}

const log = (message) => console.log(`[${name}] ${message}`);
const pick = (items) => items[Math.floor(Math.random() * items.length)];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const thinkTime = () => minDelay + Math.random() * (maxDelay - minDelay);

// ---- identity: a secret token per bot name, remembered between runs ----
function loadToken() {
  let tokens = {};
  try {
    tokens = JSON.parse(fs.readFileSync(options['token-file'], 'utf8'));
  } catch {
    // first run
  }
  if (!tokens[name]) {
    tokens[name] = randomBytes(16).toString('hex');
    fs.mkdirSync(path.dirname(options['token-file']), { recursive: true });
    fs.writeFileSync(options['token-file'], JSON.stringify(tokens, null, 2));
  }
  return tokens[name];
}
const token = loadToken();

// ---- talking to the server ----
const socket = io(options.url);
const call = (event, payload = {}) => new Promise((resolve) => socket.emit(event, payload, resolve));

let state = null;
let acting = false; // only one decision at a time
const decided = new Set(); // "round:phase" keys we have already acted on, so a state refresh can't make us act twice

async function connect() {
  let reply = await call('resume', { token });
  if (!reply.ok) reply = await call('join', { token, name });
  if (!reply.ok) {
    log(`could not join: ${reply.error}`);
    process.exit(1);
  }
  log(`in the game (${options.url})`);
}

socket.on('connect', connect);
socket.on('connect_error', (error) => log(`cannot reach the server: ${error.message}`));
socket.on('disconnect', () => log('disconnected, will keep trying to reconnect'));
socket.on('state', (next) => {
  state = next;
  if (state === null) {
    log('removed from the game');
    process.exit(0);
  }
  void act();
});

async function act() {
  if (acting || !state) return;
  const s = state;
  if (s.me.waiting) return;

  let key = null;
  let action = null;
  if (s.phase === 'word' && s.me.isChooser) {
    key = `${s.round}:word`;
    action = chooseWord;
  } else if (s.phase === 'picking' && !s.me.isChooser && s.me.myPick === null) {
    key = `${s.round}:picking`;
    action = playRandomCard;
  } else if (s.phase === 'voting' && s.me.myVote === null && s.voteTargets.length > 0) {
    key = `${s.round}:voting`;
    action = voteRandomly;
  }
  if (!action || decided.has(key)) return;

  acting = true;
  decided.add(key);
  try {
    await sleep(thinkTime());
    await action();
  } finally {
    acting = false;
    void act(); // the state may have moved on while we were thinking
  }
}

async function chooseWord() {
  const reply = await call('hints');
  if (!reply.ok || !reply.hints?.length) return log(`could not get hints: ${reply.error ?? 'none returned'}`);
  const word = pick(reply.hints);
  const result = await call('submitWord', { word });
  log(result.ok ? `chose the word "${word}"` : `could not submit a word: ${result.error}`);
}

async function playRandomCard() {
  const cardId = pick(state.me.hand);
  const result = await call('playCard', { cardId });
  log(result.ok ? `played card ${cardId}` : `could not play a card: ${result.error}`);
}

async function voteRandomly() {
  const targetId = pick(state.voteTargets);
  const target = state.players.find((p) => p.id === targetId);
  const result = await call('vote', { targetId });
  log(result.ok ? `voted for ${target?.name}` : `could not vote: ${result.error}`);
}

process.on('SIGINT', () => {
  log('stopping (the player stays in the game, shown as offline)');
  socket.close();
  process.exit(0);
});
