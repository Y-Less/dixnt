import test from 'node:test';
import assert from 'node:assert/strict';
import { FAVOURITE_POINTS, Game, GameError } from './game.js';

const range = (start, count) => Array.from({ length: count }, (_, i) => start + i);

function seededRng(seed = 5) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

function setup(names = ['Ann', 'Bob', 'Cat', 'Dan']) {
  const game = new Game({ getCardIds: () => range(1, 200), hints: [], rng: seededRng() });
  const players = names.map((n) => game.addPlayer(n, `token-${n}`));
  const host = players[0];
  game.setJudging(host.id, 'favourite');
  game.start(host.id);
  return { game, players, host };
}

function toVoting(game) {
  const s = game.s;
  const chooser = game.player(s.chooserId);
  game.submitWord(chooser.id, 'borrowed light');
  const cardPlayers = game.cardPlayers();
  for (const p of cardPlayers) game.playCard(p.id, p.hand[0]);
  assert.equal(s.phase, 'voting');
  return { chooser, cardPlayers };
}

test('favourite style: the word is shown to everyone and there is no imposter', () => {
  const { game, players } = setup();
  game.submitWord(game.s.chooserId, 'borrowed light');
  assert.equal(game.s.imposterId, null);
  for (const p of players) {
    const view = game.viewFor(p.id);
    assert.equal(view.word, 'borrowed light', `${p.name} can see the word while picking`);
    assert.equal(view.wordHidden, false);
    assert.equal(view.me.isImposter, false);
  }
});

test('favourite style: the chooser picks a card, the round ends at once and that player scores 200', () => {
  const { game } = setup();
  const { chooser, cardPlayers } = toVoting(game);
  const winner = cardPlayers[1];

  game.vote(chooser.id, winner.id);
  assert.equal(game.s.phase, 'results', 'only the chooser needs to decide');
  const r = game.s.results;
  assert.equal(r.judging, 'favourite');
  assert.equal(r.winnerId, winner.id);
  assert.equal(r.imposterId, null);
  assert.equal(r.deltas[winner.id], FAVOURITE_POINTS);
  assert.equal(FAVOURITE_POINTS, 200);
  for (const p of game.s.players.filter((x) => x.id !== winner.id)) assert.equal(r.deltas[p.id], 0);
  assert.equal(game.player(winner.id).score, 200);
  assert.equal(game.player(chooser.id).score, 0, 'the chooser does not score');
});

test('favourite style: only the chooser can pick, and only from the cards on the table', () => {
  const { game } = setup();
  const { chooser, cardPlayers } = toVoting(game);
  assert.throws(() => game.vote(cardPlayers[0].id, cardPlayers[1].id), GameError);
  assert.throws(() => game.vote(chooser.id, chooser.id), GameError);
  assert.equal(game.viewFor(cardPlayers[0].id).voteTargets.length, 0);
  assert.equal(game.viewFor(chooser.id).voteTargets.length, 3);
  assert.equal(game.s.phase, 'voting', 'refused picks changed nothing');
});

test('favourite style: the first pick settles the round and cannot be changed afterwards', () => {
  const { game } = setup();
  const { chooser, cardPlayers } = toVoting(game);
  game.vote(chooser.id, cardPlayers[0].id);
  assert.equal(game.s.phase, 'results', 'the first pick ends the round, so there is nothing to change after');
  assert.throws(() => game.vote(chooser.id, cardPlayers[1].id), GameError);
  assert.equal(game.s.results.winnerId, cardPlayers[0].id);
});

test('favourite style: no imposter is revealed anywhere in the results view', () => {
  const { game, host } = setup();
  const { chooser, cardPlayers } = toVoting(game);
  game.vote(chooser.id, cardPlayers[0].id);
  const view = game.viewFor(host.id);
  assert.equal(view.results.imposterId, null);
  assert.equal(view.results.groupCorrect, null);
  assert.equal(view.me.isImposter, false);
});

test('favourite style: works with rounds, so everyone is judged in turn and the game finishes', () => {
  const { game, host } = setup(['Ann', 'Bob', 'Cat']);
  const choosers = [];
  while (game.s.phase !== 'finished') {
    const { chooser, cardPlayers } = toVoting(game);
    choosers.push(chooser.id);
    game.vote(chooser.id, cardPlayers[0].id);
    game.nextRound(host.id);
    assert.ok(choosers.length <= 6);
  }
  assert.equal(choosers.length, 6, 'three players, two turns each by default');
  const total = game.s.players.reduce((sum, p) => sum + p.score, 0);
  assert.equal(total, 6 * FAVOURITE_POINTS, 'exactly one 200-point award per round');
});

test('the play style can be switched between all three in the lobby', () => {
  const game = new Game({ getCardIds: () => range(1, 100), hints: [] });
  const players = ['Ann', 'Bob', 'Cat'].map((n) => game.addPlayer(n, `t-${n}`));
  for (const mode of ['chooser', 'favourite', 'everyone']) {
    game.setJudging(players[0].id, mode);
    assert.equal(game.viewFor(players[1].id).judging, mode);
  }
  assert.equal(game.viewFor(players[1].id).pointsFavourite, 200);
  assert.throws(() => game.setJudging(players[0].id, 'tournament'), GameError);
});
