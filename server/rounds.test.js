import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ROUNDS_EACH, Game, GameError } from './game.js';

const range = (start, count) => Array.from({ length: count }, (_, i) => start + i);

function seededRng(seed = 3) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

function setup(names, roundsEach) {
  const game = new Game({ getCardIds: () => range(1, 200), hints: [], rng: seededRng() });
  const players = names.map((n) => game.addPlayer(n, `token-${n}`));
  const host = players[0];
  game.setJudging(host.id, 'chooser'); // only the chooser votes, so a round takes few calls
  if (roundsEach !== undefined) game.setRounds(host.id, roundsEach);
  return { game, players, host };
}

/** Plays one complete round (word, cards, the chooser's verdict). Returns the chooser's id. */
function playRound(game, { guessRight = true } = {}) {
  const s = game.s;
  const chooserId = s.chooserId;
  game.submitWord(chooserId, 'a word');
  for (const p of game.cardPlayers()) game.playCard(p.id, p.hand[0]);
  const targets = game.cardPlayers();
  const target = guessRight ? targets.find((p) => p.id === s.imposterId) : targets.find((p) => p.id !== s.imposterId);
  game.vote(chooserId, target.id);
  assert.equal(s.phase, 'results');
  return chooserId;
}

test('each player chooses twice by default, so four players play eight rounds', () => {
  assert.equal(DEFAULT_ROUNDS_EACH, 2);
  const { game, host } = setup(['Ann', 'Bob', 'Cat', 'Dan']);
  game.start(host.id);
  assert.equal(game.s.roundsEach, 2);
  assert.equal(game.viewFor(host.id).totalRounds, 8);

  const choosers = [];
  while (game.s.phase !== 'finished') {
    choosers.push(playRound(game));
    game.nextRound(host.id);
    assert.ok(choosers.length <= 8, 'the game must stop by itself');
  }
  assert.equal(choosers.length, 8);
  for (const p of game.s.players) assert.equal(choosers.filter((id) => id === p.id).length, 2, `${p.name} chose twice`);
  assert.deepEqual(choosers.slice(0, 4), choosers.slice(4), 'the rotation repeats in the same order');
  assert.equal(game.s.completed, 8);
});

test('the number of rounds is configurable by the host, in the lobby, within limits', () => {
  const { game, players, host } = setup(['Ann', 'Bob', 'Cat']);
  assert.throws(() => game.setRounds(players[1].id, 3), GameError);
  assert.throws(() => game.setRounds(host.id, 0), GameError);
  assert.throws(() => game.setRounds(host.id, 11), GameError);
  assert.throws(() => game.setRounds(host.id, 'lots'), GameError);
  game.setRounds(host.id, 1);
  game.start(host.id);
  assert.equal(game.viewFor(host.id).roundsEach, 1);
  assert.equal(game.viewFor(host.id).totalRounds, 3);
  assert.throws(() => game.setRounds(host.id, 3), GameError, 'not once the game has started');
});

test('with one turn each the game ends after the last player has chosen, and shows the winners', () => {
  const { game, host } = setup(['Ann', 'Bob', 'Cat'], 1);
  game.start(host.id);
  for (let round = 1; round <= 3; round++) {
    assert.equal(game.s.phase, 'word');
    assert.equal(game.viewFor(host.id).completedRounds, round - 1);
    playRound(game);
    game.nextRound(host.id);
  }
  assert.equal(game.s.phase, 'finished');
  const view = game.viewFor(host.id);
  assert.equal(view.phase, 'finished');
  assert.equal(view.me.hand.length, 0);
  assert.equal(view.results, null);
  const best = Math.max(...view.players.map((p) => p.score));
  assert.deepEqual([...view.winners].sort(), view.players.filter((p) => p.score === best).map((p) => p.id).sort());
  assert.throws(() => game.nextRound(host.id), GameError, 'nothing more to play');
});

test('shared top scores produce several winners', () => {
  const { game, host } = setup(['Ann', 'Bob', 'Cat'], 1);
  game.start(host.id);
  for (let i = 0; i < 3; i++) {
    playRound(game, { guessRight: true }); // the chooser scores 100 each time
    game.nextRound(host.id);
  }
  const view = game.viewFor(host.id);
  assert.equal(view.winners.length, 3, 'everyone scored 100 once');
});

test('a skipped round does not count as anyone\'s turn', () => {
  const { game, host } = setup(['Ann', 'Bob', 'Cat'], 1);
  game.start(host.id);
  const skipped = game.s.chooserId;
  game.abortRound(host.id);
  assert.equal(game.player(skipped).turns, 0);
  assert.equal(game.s.completed, 0);

  const choosers = [];
  while (game.s.phase !== 'finished') {
    choosers.push(playRound(game));
    game.nextRound(host.id);
    assert.ok(choosers.length <= 4);
  }
  assert.equal(new Set(choosers).size, 3, 'everyone still got their turn, including the skipped chooser');
  assert.equal(choosers.length, 3, 'nobody had to choose twice');
});

test('someone who joins late still gets their turns, which extends the game', () => {
  const { game, host } = setup(['Ann', 'Bob', 'Cat'], 1);
  game.start(host.id);
  const late = game.addPlayer('Late', 'token-late');
  assert.equal(game.viewFor(host.id).totalRounds, 4);

  const choosers = [];
  while (game.s.phase !== 'finished') {
    choosers.push(playRound(game));
    game.nextRound(host.id);
    assert.ok(choosers.length <= 4);
  }
  assert.equal(choosers.length, 4);
  assert.ok(choosers.includes(late.id));
  assert.equal(late.turns, 1);
});

test('removing the only player who still owes a turn finishes the game', () => {
  const { game, host } = setup(['Ann', 'Bob', 'Cat', 'Dan'], 1);
  game.start(host.id);
  for (let i = 0; i < 3; i++) {
    playRound(game);
    game.nextRound(host.id);
  }
  assert.equal(game.s.phase, 'word');
  const lastToChoose = game.player(game.s.chooserId);
  assert.equal(lastToChoose.turns, 0);
  game.removePlayer(host.id, lastToChoose.id);
  assert.equal(game.s.phase, 'finished');
});

test('after the game the host can return to the lobby and start a fresh game with fresh turn counts', () => {
  const { game, players, host } = setup(['Ann', 'Bob', 'Cat'], 1);
  game.start(host.id);
  for (let i = 0; i < 3; i++) {
    playRound(game);
    game.nextRound(host.id);
  }
  assert.equal(game.s.phase, 'finished');
  assert.throws(() => game.returnToLobby(players[1].id), GameError, 'only the host');
  game.returnToLobby(host.id);
  assert.equal(game.s.phase, 'lobby');
  assert.ok(game.s.players.every((p) => p.turns === 0));
  assert.equal(game.s.roundsEach, 1, 'the setting is remembered');

  game.start(host.id);
  assert.ok(game.s.players.every((p) => p.score === 0 && p.turns === 0));
  assert.equal(game.s.completed, 0);
  assert.equal(game.s.phase, 'word');
});

test('saved games from before rounds existed still load, defaulting to two turns each', () => {
  const { game, host } = setup(['Ann', 'Bob', 'Cat']);
  game.start(host.id);
  const saved = JSON.parse(JSON.stringify(game.toJSON()));
  delete saved.roundsEach;
  delete saved.completed;
  for (const p of saved.players) delete p.turns;
  const reloaded = new Game({ getCardIds: () => range(1, 200), hints: [], saved });
  assert.equal(reloaded.s.roundsEach, 2);
  assert.equal(reloaded.viewFor(host.id).totalRounds, 6);
  assert.doesNotThrow(() => reloaded.viewFor(host.id));
});
