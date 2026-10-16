import test from 'node:test';
import assert from 'node:assert/strict';
import { CHOOSER_CORRECT_POINTS, CHOOSER_FOOLED_POINTS, Game, GameError } from './game.js';

const range = (start, count) => Array.from({ length: count }, (_, i) => start + i);

function seededRng(seed = 1) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const CATEGORIES = [
  { key: 'fantasy', label: 'Fantasy', description: 'Dragons', ids: range(10001, 40) },
  { key: 'food', label: 'Food', description: 'Feasts', ids: range(80001, 40) },
  { key: 'games', label: 'Games', description: 'Dice', ids: range(70001, 10) },
];

function lobby(names = ['Ann', 'Bob', 'Cat', 'Dan', 'Eve']) {
  const game = new Game({ getCategories: () => CATEGORIES, hints: [], rng: seededRng(11) });
  const players = names.map((n) => game.addPlayer(n, `token-${n}`));
  return { game, players, host: players[0] };
}

/** Starts the game and plays every card, leaving it in the voting phase. */
function toVoting(game, host) {
  game.start(host.id);
  game.submitWord(game.s.chooserId, 'borrowed light');
  for (const p of game.cardPlayers()) game.playCard(p.id, p.hand[0]);
  assert.equal(game.s.phase, 'voting');
  const imposter = game.player(game.s.imposterId);
  const chooser = game.player(game.s.chooserId);
  const others = game.cardPlayers().filter((p) => p.id !== imposter.id);
  return { imposter, chooser, others };
}

test('chooser-only judging: spotting the imposter scores the chooser 100 and nobody else', () => {
  const { game, host } = lobby();
  game.setJudging(host.id, 'chooser');
  const { imposter, chooser, others } = toVoting(game, host);

  game.vote(chooser.id, imposter.id);
  assert.equal(game.s.phase, 'results', 'the round ends as soon as the chooser has voted');
  const r = game.s.results;
  assert.equal(r.judging, 'chooser');
  assert.equal(r.groupCorrect, true);
  assert.equal(r.deltas[chooser.id], CHOOSER_CORRECT_POINTS);
  assert.equal(CHOOSER_CORRECT_POINTS, 100);
  assert.equal(r.deltas[imposter.id], 0);
  for (const p of others) assert.equal(r.deltas[p.id], 0);
});

test('chooser-only judging: fooling the chooser scores the imposter 500', () => {
  const { game, host } = lobby();
  game.setJudging(host.id, 'chooser');
  const { imposter, chooser, others } = toVoting(game, host);

  game.vote(chooser.id, others[0].id);
  const r = game.s.results;
  assert.equal(r.groupCorrect, false);
  assert.equal(r.deltas[imposter.id], CHOOSER_FOOLED_POINTS);
  assert.equal(CHOOSER_FOOLED_POINTS, 500);
  assert.equal(game.player(imposter.id).score, 500);
  assert.equal(game.player(chooser.id).score, 0);
});

test('chooser-only judging: nobody else can vote and they are not offered vote targets', () => {
  const { game, host } = lobby();
  game.setJudging(host.id, 'chooser');
  const { imposter, chooser, others } = toVoting(game, host);

  assert.throws(() => game.vote(others[0].id, imposter.id), GameError);
  assert.throws(() => game.vote(imposter.id, others[0].id), GameError);
  assert.equal(game.viewFor(others[0].id).voteTargets.length, 0);
  assert.equal(game.viewFor(chooser.id).voteTargets.length, 4, 'the chooser can pick any of the four card players');
  assert.equal(game.s.phase, 'voting', 'failed votes changed nothing');
});

test('chooser-only judging: the chooser can change their mind until they vote, and the verdict is theirs', () => {
  const { game, host } = lobby();
  game.setJudging(host.id, 'chooser');
  const { imposter, chooser } = toVoting(game, host);
  game.vote(chooser.id, imposter.id);
  assert.equal(game.s.phase, 'results');
  assert.throws(() => game.vote(chooser.id, imposter.id), GameError, 'no voting once the round is over');
});

test('everyone judging is still the default and works as before', () => {
  const { game, host } = lobby();
  assert.equal(game.s.judging, 'everyone');
  const { imposter, chooser, others } = toVoting(game, host);
  game.vote(chooser.id, imposter.id);
  assert.equal(game.s.phase, 'voting', 'still waiting for the other players');
  game.vote(others[0].id, imposter.id);
  game.vote(others[1].id, imposter.id);
  game.vote(others[2].id, others[0].id);
  game.vote(imposter.id, others[0].id);
  assert.equal(game.s.results.judging, 'everyone');
  assert.equal(game.s.results.groupCorrect, true);
});

test('only the host can change the judging method, and only in the lobby', () => {
  const { game, players, host } = lobby();
  assert.throws(() => game.setJudging(players[1].id, 'chooser'), GameError);
  assert.throws(() => game.setJudging(host.id, 'telepathy'), GameError);
  game.setJudging(host.id, 'chooser');
  game.start(host.id);
  assert.throws(() => game.setJudging(host.id, 'everyone'), GameError);
  assert.equal(game.viewFor(host.id).judging, 'chooser');
});

test('categories: only cards from the selected categories are ever dealt', () => {
  const { game, host } = lobby();
  game.setCategories(host.id, ['food']);
  game.start(host.id);
  const everything = [...game.s.draw, ...game.s.discard, ...game.s.players.flatMap((p) => p.hand)];
  assert.equal(everything.length, 40);
  assert.ok(everything.every((id) => id >= 80001 && id < 80041), 'every card is a food card');
});

test('categories: several selected categories are combined, in a stable order', () => {
  const { game, host } = lobby();
  game.setCategories(host.id, ['games', 'fantasy']);
  assert.deepEqual(game.s.categories, ['fantasy', 'games']);
  game.start(host.id);
  assert.equal(game.s.draw.length + game.s.players.reduce((n, p) => n + p.hand.length, 0), 50);
});

test('categories: the lobby view lists every category with counts and what is selected', () => {
  const { game, host } = lobby();
  game.setCategories(host.id, ['fantasy']);
  const view = game.viewFor(host.id);
  assert.deepEqual(
    view.categories.map((c) => [c.key, c.count, c.selected]),
    [['fantasy', 40, true], ['food', 40, false], ['games', 10, false]],
  );
  assert.equal(view.availableCards, 40);
});

test('categories: bad selections are refused, and only the host may choose', () => {
  const { game, players, host } = lobby();
  assert.throws(() => game.setCategories(host.id, []), GameError, 'at least one');
  assert.throws(() => game.setCategories(host.id, ['cooking']), GameError, 'unknown');
  assert.throws(() => game.setCategories(players[1].id, ['food']), GameError, 'not the host');
  assert.deepEqual(game.s.categories, ['fantasy', 'food', 'games'], 'a refused change leaves the selection alone');
});

test('categories: starting needs enough cards in the chosen categories', () => {
  const { game, host } = lobby(['A', 'B', 'C', 'D', 'E', 'F']); // 6 players x 8 cards = 48
  game.setCategories(host.id, ['games']); // only 10 cards
  assert.throws(() => game.start(host.id), /not enough cards/);
  game.setCategories(host.id, ['fantasy', 'food']);
  game.start(host.id);
  assert.equal(game.s.phase, 'word');
});

test('categories: settings survive a save and reload, and a vanished category is dropped', () => {
  const { game, host } = lobby();
  game.setCategories(host.id, ['food', 'games']);
  game.setJudging(host.id, 'chooser');
  const saved = JSON.parse(JSON.stringify(game.toJSON()));

  const reloaded = new Game({ getCategories: () => CATEGORIES, hints: [], saved });
  assert.deepEqual(reloaded.s.categories, ['food', 'games']);
  assert.equal(reloaded.s.judging, 'chooser');

  const withoutFood = new Game({ getCategories: () => CATEGORIES.filter((c) => c.key !== 'food'), hints: [], saved });
  assert.deepEqual(withoutFood.s.categories, ['games'], 'the missing category is dropped');
  const onlyNew = new Game({ getCategories: () => [CATEGORIES[0]], hints: [], saved });
  assert.deepEqual(onlyNew.s.categories, ['fantasy'], 'if nothing selected still exists, fall back to everything');
});
