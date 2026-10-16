// End-to-end test: starts the real server on a spare port and plays full rounds with socket clients.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io as connect } from 'socket.io-client';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3123;
const URL = `http://localhost:${PORT}`;

function startServer(dataDir) {
  const child = spawn(process.execPath, [path.join(here, 'index.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => String(chunk).includes('listening') && resolve(child));
    child.on('exit', (code) => reject(new Error(`server exited early (${code})`)));
  });
}

class Bot {
  constructor(name) {
    this.name = name;
    this.token = `${name}-`.padEnd(20, 'x');
    this.state = null;
    this.socket = connect(URL, { forceNew: true });
    this.socket.on('state', (s) => (this.state = s));
  }
  call(event, payload = {}) {
    return new Promise((resolve) => this.socket.emit(event, payload, resolve));
  }
  async connected() {
    if (!this.socket.connected) await new Promise((resolve) => this.socket.once('connect', resolve));
  }
  async join() {
    await this.connected();
    return this.call('join', { token: this.token, name: this.name });
  }
  async settle() {
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
}

test('four players complete two rounds over real sockets', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dixit-e2e-'));
  const server = await startServer(dataDir);
  const bots = ['Ann', 'Bob', 'Cat', 'Dan'].map((n) => new Bot(n));
  t.after(() => {
    bots.forEach((b) => b.socket.close());
    server.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  for (const bot of bots) assert.equal((await bot.join()).ok, true);
  const impostor = new Bot('Ann');
  impostor.token = 'a-different-token-entirely';
  assert.equal((await impostor.join()).ok, false, 'a different person cannot take an existing name');
  impostor.socket.close();
  await bots[0].settle();
  assert.equal(bots[0].state.phase, 'lobby');
  assert.equal(bots[0].state.players.length, 4);

  assert.equal((await bots[1].call('start')).ok, false, 'only the host can start');
  assert.equal((await bots[0].call('setHandSize', { size: 8 })).ok, true);
  const started = await bots[0].call('start');
  assert.equal(started.ok, true, started.error);
  await bots[0].settle();
  assert.equal(bots[0].state.phase, 'word');
  assert.equal(bots[2].state.me.hand.length, 8);

  for (let round = 1; round <= 2; round++) {
    await bots[0].settle();
    const chooser = bots.find((b) => b.state.me.isChooser);
    assert.equal(chooser.name, bots[(round - 1) % 4].name, 'chooser rotates in order');

    const hints = await chooser.call('hints');
    assert.equal(hints.hints.length, 3);
    assert.equal((await chooser.call('submitWord', { word: hints.hints[0] })).ok, true);
    await chooser.settle();

    // Exactly one non-chooser sees ???, and it is not revealed as an id.
    const hidden = bots.filter((b) => b.state.wordHidden);
    assert.equal(hidden.length, 1);
    assert.notEqual(hidden[0], chooser);
    for (const b of bots.filter((x) => !x.state.wordHidden)) assert.equal(b.state.word, hints.hints[0]);

    const players = bots.filter((b) => b !== chooser);
    for (const p of players) {
      const reply = await p.call('playCard', { cardId: p.state.me.hand[0] });
      assert.equal(reply.ok, true, reply.error);
    }
    await chooser.settle();
    assert.equal(chooser.state.phase, 'voting', 'voting opens straight away');
    assert.equal(chooser.state.table.length, 3);
    for (const b of bots) assert.equal(b.state.word, hints.hints[0], 'word revealed to everyone, imposter included');

    // Everyone votes for the first player they are allowed to (so the outcome varies by round).
    for (const b of bots) {
      const targetId = b.state.voteTargets[0];
      assert.ok(targetId);
      assert.equal((await b.call('vote', { targetId })).ok, true);
    }
    await chooser.settle();
    assert.equal(chooser.state.phase, 'results');
    const { results } = chooser.state;
    assert.ok(results.imposterId);
    const total = Object.values(results.deltas).reduce((a, b) => a + b, 0);
    assert.ok(total >= 0 && total % 100 === 0);

    assert.equal((await bots[3].call('nextRound')).ok, true);
    await chooser.settle();
    for (const b of bots) assert.equal(b.state.me.hand.length, 8, 'everyone draws back up');
  }

  // Reconnecting with the same token restores the player and their score.
  const before = bots[1].state.players.find((p) => p.id === bots[1].state.me.id).score;
  const again = new Bot('Bob');
  await again.connected();
  assert.equal((await again.call('resume', { token: bots[1].token })).ok, true);
  await again.settle();
  assert.equal(again.state.me.id, bots[1].state.me.id);
  assert.equal(again.state.players.find((p) => p.id === again.state.me.id).score, before);
  again.socket.close();
});

test('game state survives a server restart', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dixit-e2e-'));
  let server = await startServer(dataDir);
  const bots = ['Ann', 'Bob', 'Cat'].map((n) => new Bot(n));
  t.after(() => {
    bots.forEach((b) => b.socket.close());
    server.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  for (const bot of bots) await bot.join();
  await bots[0].call('start');
  await bots[0].settle();
  const hand = bots[1].state.me.hand;
  await new Promise((resolve) => setTimeout(resolve, 500)); // let the debounced save run
  bots.forEach((b) => b.socket.close());
  server.kill();
  await new Promise((resolve) => setTimeout(resolve, 300));

  server = await startServer(dataDir);
  const bob = new Bot('Bob');
  await bob.connected();
  assert.equal((await bob.call('resume', { token: bots[1].token })).ok, true);
  await bob.settle();
  assert.equal(bob.state.phase, 'word');
  assert.deepEqual(bob.state.me.hand, hand);
  bob.socket.close();
});

test('external bot processes play whole rounds using only the API', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dixit-e2e-'));
  const server = await startServer(dataDir);
  const tokenFile = path.join(dataDir, 'bot-tokens.json');
  const botProcesses = [];
  const botLog = [];
  const human = new Bot('Host');
  t.after(() => {
    human.socket.close();
    botProcesses.forEach((b) => b.kill());
    server.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const until = async (condition, what) => {
    for (let i = 0; i < 100; i++) {
      if (condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.fail(`timed out waiting for: ${what}
phase=${human.state?.phase} round=${human.state?.round} chooser=${human.state?.players.find((p) => p.isChooser)?.name}
bot output:
${botLog.join('')}`);
  };

  assert.equal((await human.join()).ok, true);
  for (const name of ['Robin', 'Sam', 'Tess']) {
    const child = spawn(
      process.execPath,
      [path.join(here, '..', 'bots', 'bot.js'), '--name', name, '--url', URL, '--delay', '0-50', '--token-file', tokenFile],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    child.stdout.on('data', (chunk) => botLog.push(String(chunk)));
    botProcesses.push(child);
  }
  await until(() => human.state?.players.length === 4, 'all bots to join');
  assert.equal((await human.call('start')).ok, true);

  for (let round = 1; round <= 2; round++) {
    await until(() => human.state.round === round, `round ${round} to start`);
    if (human.state.me.isChooser) {
      assert.equal((await human.call('submitWord', { word: 'a human word' })).ok, true);
    }
    await until(() => human.state.phase !== 'word', 'the word to be set (by the human or a bot)');
    if (!human.state.me.isChooser) {
      await until(() => human.state.phase === 'picking' || human.state.phase === 'voting', 'cards to be requested');
      if (human.state.phase === 'picking') {
        assert.equal((await human.call('playCard', { cardId: human.state.me.hand[0] })).ok, true);
      }
    }
    await until(() => human.state.phase === 'voting', 'all cards to be played');
    assert.equal(human.state.table.length, 3, 'every non-chooser played exactly one card');
    assert.equal((await human.call('vote', { targetId: human.state.voteTargets[0] })).ok, true);
    await until(() => human.state.phase === 'results', 'all bots to vote');
    assert.equal(Object.keys(human.state.results.votes).length, 4, 'every player, bots included, voted');
    if (round === 1) assert.equal((await human.call('nextRound')).ok, true);
  }

  const log = botLog.join('');
  assert.match(log, /chose the word "/, 'a bot picked a word from the hint list when it was the chooser');
  assert.match(log, /played card \d+/);
  assert.match(log, /voted for /);
});
