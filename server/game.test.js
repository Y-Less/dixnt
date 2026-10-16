import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, GameError, POINTS_PER_VOTE } from './game.js';

const cards = (n) => Array.from({ length: n }, (_, i) => i + 1);

function seededRng(seed = 1) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

function makeGame(names, { cardCount = 100, handSize = 8 } = {}) {
  const game = new Game({ getCardIds: () => cards(cardCount), hints: cards(30).map((n) => `hint ${n}`), rng: seededRng(7) });
  const players = names.map((name) => game.addPlayer(name, `token-${name}`));
  game.setHandSize(players[0].id, handSize);
  game.start(players[0].id);
  return { game, players };
}

/** Plays a round up to the voting phase and returns who is who. */
function toVoting(game) {
  const s = game.s;
  game.submitWord(s.chooserId, 'lighthouse');
  for (const p of game.cardPlayers()) game.playCard(p.id, p.hand[0]);
  assert.equal(s.phase, 'voting', 'voting opens as soon as the last card is played');
  const imposter = game.player(s.imposterId);
  const others = game.cardPlayers().filter((p) => p.id !== imposter.id);
  const chooser = game.player(s.chooserId);
  return { imposter, others, chooser };
}

test('start deals a full hand to everyone and picks the first chooser', () => {
  const { game, players } = makeGame(['Ann', 'Bob', 'Cat', 'Dan']);
  assert.equal(game.s.phase, 'word');
  assert.equal(game.s.chooserId, players[0].id);
  for (const p of game.s.players) assert.equal(p.hand.length, 8);
  assert.equal(game.s.draw.length, 100 - 4 * 8);
});

test('the imposter sees ??? and nobody else is told who they are', () => {
  const { game } = makeGame(['Ann', 'Bob', 'Cat', 'Dan']);
  game.submitWord(game.s.chooserId, 'lighthouse');
  for (const p of game.s.players) {
    const view = game.viewFor(p.id);
    if (p.id === game.s.imposterId) {
      assert.equal(view.word, null);
      assert.equal(view.wordHidden, true);
    } else {
      assert.equal(view.word, 'lighthouse');
      assert.equal(view.wordHidden, false);
    }
    // Nothing in the view may reveal who the imposter is before the results.
    assert.equal(view.results, null);
    assert.equal(view.me.isImposter, false);
    assert.ok(!JSON.stringify(view).includes('imposter'.concat('Id')), 'no imposterId field in any view');
  }
  assert.notEqual(game.s.imposterId, game.s.chooserId);
});

test('players cannot see each other\'s hands or the secret tokens', () => {
  const { game, players } = makeGame(['Ann', 'Bob', 'Cat']);
  const json = JSON.stringify(game.viewFor(players[1].id));
  assert.ok(!json.includes('token-'));
  assert.deepEqual(game.viewFor(players[1].id).me.hand, players[1].hand);
});

test('the chooser cannot play a card and only the chooser can set the word', () => {
  const { game, players } = makeGame(['Ann', 'Bob', 'Cat']);
  assert.throws(() => game.submitWord(players[1].id, 'x'), GameError);
  game.submitWord(players[0].id, 'x');
  assert.throws(() => game.playCard(players[0].id, players[0].hand[0]), GameError);
  assert.throws(() => game.playCard(players[1].id, 9999), GameError);
});

test('cards are revealed only once everyone has played', () => {
  const { game, players } = makeGame(['Ann', 'Bob', 'Cat', 'Dan']);
  game.submitWord(players[0].id, 'x');
  game.playCard(players[1].id, players[1].hand[0]);
  game.playCard(players[2].id, players[2].hand[0]);
  assert.equal(game.viewFor(players[1].id).table.length, 0);
  game.playCard(players[3].id, players[3].hand[0]);
  const view = game.viewFor(players[1].id);
  assert.equal(game.s.phase, 'voting');
  assert.equal(view.table.length, 3);
  assert.equal(view.word, 'x', 'the word is revealed to everyone, including the imposter');
  assert.equal(game.viewFor(game.s.imposterId).word, 'x');
});

test('the round only ends once everyone has voted, and votes can be changed until then', () => {
  const { game } = makeGame(['Ann', 'Bob', 'Cat', 'Dan']);
  const { imposter, others, chooser } = toVoting(game);
  game.vote(chooser.id, others[0].id);
  game.vote(others[0].id, imposter.id);
  game.vote(others[0].id, others[1].id); // changed their mind
  game.vote(others[1].id, imposter.id);
  assert.equal(game.s.phase, 'voting', 'one vote still missing');
  assert.equal(game.viewFor(chooser.id).players.filter((p) => p.hasVoted).length, 3);
  game.vote(imposter.id, others[0].id);
  assert.equal(game.s.phase, 'results');
  assert.equal(game.s.results.votes[others[0].id], others[1].id, 'the changed vote is the one that counted');
});

test('cannot vote for yourself, the chooser, or when it is not voting time', () => {
  const { game, players } = makeGame(['Ann', 'Bob', 'Cat', 'Dan']);
  assert.throws(() => game.vote(players[1].id, players[2].id), GameError);
  const { chooser, others } = toVoting(game);
  assert.throws(() => game.vote(others[0].id, others[0].id), GameError);
  assert.throws(() => game.vote(others[0].id, chooser.id), GameError);
});

test('group correct: only those who found the imposter score 100', () => {
  const { game } = makeGame(['Ann', 'Bob', 'Cat', 'Dan', 'Eve']);
  const { imposter, others, chooser } = toVoting(game);
  game.vote(chooser.id, imposter.id);
  game.vote(others[0].id, imposter.id);
  game.vote(others[1].id, others[2].id); // wrong guess
  game.vote(others[2].id, others[1].id); // wrong guess
  game.vote(imposter.id, others[0].id);
  const r = game.s.results;
  assert.equal(r.groupCorrect, true);
  assert.equal(r.deltas[chooser.id], POINTS_PER_VOTE);
  assert.equal(r.deltas[others[0].id], POINTS_PER_VOTE);
  assert.equal(r.deltas[others[1].id], 0);
  assert.equal(r.deltas[others[2].id], 0);
  assert.equal(r.deltas[imposter.id], 0);
  assert.equal(game.s.phase, 'results');
  assert.equal(game.viewFor(imposter.id).results.imposterId, imposter.id);
});

test('group wrong: the imposter scores 100 per voter who missed them', () => {
  const { game } = makeGame(['Ann', 'Bob', 'Cat', 'Dan', 'Eve']);
  const { imposter, others, chooser } = toVoting(game);
  game.vote(chooser.id, others[0].id);
  game.vote(others[0].id, others[1].id);
  game.vote(others[1].id, others[0].id);
  game.vote(others[2].id, others[0].id);
  game.vote(imposter.id, others[0].id);
  const r = game.s.results;
  assert.equal(r.groupCorrect, false);
  // 4 non-imposter voters, none chose the imposter
  assert.equal(r.deltas[imposter.id], 4 * POINTS_PER_VOTE);
  assert.equal(game.player(imposter.id).score, 400);
});

test('a tie for most votes counts as the group being wrong', () => {
  const { game } = makeGame(['Ann', 'Bob', 'Cat', 'Dan', 'Eve']);
  const { imposter, others, chooser } = toVoting(game);
  // imposter 2 (chooser, o0), o1 2 (o2, imposter), o0 1 (o1): the imposter ties for most votes
  game.vote(chooser.id, imposter.id);
  game.vote(others[0].id, imposter.id);
  game.vote(others[1].id, others[0].id);
  game.vote(others[2].id, others[1].id);
  game.vote(imposter.id, others[1].id);
  const r = game.s.results;
  assert.deepEqual([r.tally[imposter.id], r.tally[others[1].id]], [2, 2]);
  assert.equal(r.groupCorrect, false, 'the chooser has no casting vote');
  // 4 non-imposter voters; two found the imposter, two were fooled
  assert.equal(r.deltas[imposter.id], 2 * POINTS_PER_VOTE);
  assert.equal(r.deltas[chooser.id], 0, 'finding the imposter earns nothing when the group is wrong');
});

test('the imposter with strictly the most votes means the group is correct', () => {
  const { game } = makeGame(['Ann', 'Bob', 'Cat', 'Dan']);
  const { imposter, others, chooser } = toVoting(game);
  // imposter 2 (chooser, o1), o1 1 (o0), o0 1 (imposter)
  game.vote(chooser.id, imposter.id);
  game.vote(others[0].id, others[1].id);
  game.vote(others[1].id, imposter.id);
  game.vote(imposter.id, others[0].id);
  const r = game.s.results;
  assert.equal(r.groupCorrect, true);
  assert.equal(r.deltas[chooser.id], POINTS_PER_VOTE);
  assert.equal(r.deltas[others[1].id], POINTS_PER_VOTE);
  assert.equal(r.deltas[others[0].id], 0);
});

test('next round: next player chooses, played cards are discarded, everyone draws back up', () => {
  const { game, players } = makeGame(['Ann', 'Bob', 'Cat', 'Dan']);
  const { imposter, others, chooser } = toVoting(game);
  const played = Object.values(game.s.picks);
  for (const p of [chooser, ...others, imposter]) {
    if (p.id !== game.s.imposterId) game.vote(p.id, imposter.id);
  }
  game.vote(imposter.id, others[0].id);
  assert.equal(game.s.phase, 'results');
  game.nextRound(players[3].id);
  assert.equal(game.s.phase, 'word');
  assert.equal(game.s.round, 2);
  assert.equal(game.s.chooserId, players[1].id, 'chooser rotates in order');
  for (const p of game.s.players) assert.equal(p.hand.length, 8);
  for (const c of played) {
    assert.ok(game.s.discard.includes(c));
    assert.ok(game.s.players.every((p) => !p.hand.includes(c)));
  }
  assert.equal(game.s.discard.length, 3);
});

test('chooser wraps around after the last player', () => {
  const { game, players } = makeGame(['Ann', 'Bob', 'Cat']);
  const chosen = [];
  for (let round = 0; round < 4; round++) {
    chosen.push(game.s.chooserId);
    const { imposter, others, chooser } = toVoting(game);
    for (const v of [chooser, ...others]) game.vote(v.id, imposter.id);
    game.vote(imposter.id, others[0].id);
    game.nextRound(players[0].id);
  }
  assert.deepEqual(chosen, [players[0].id, players[1].id, players[2].id, players[0].id]);
});

test('discard pile is reshuffled when the draw pile runs out and no card is duplicated or lost', () => {
  // 3 players x 8 = 24 cards in hand; only 30 cards, so the draw pile empties quickly.
  const { game, players } = makeGame(['Ann', 'Bob', 'Cat'], { cardCount: 30 });
  for (let round = 0; round < 12; round++) {
    const { imposter, others, chooser } = toVoting(game);
    for (const v of [chooser, ...others]) game.vote(v.id, imposter.id);
    game.vote(imposter.id, others[0].id);
    game.nextRound(players[0].id);
    const all = [...game.s.draw, ...game.s.discard, ...game.s.players.flatMap((p) => p.hand)];
    assert.equal(all.length, 30);
    assert.equal(new Set(all).size, 30);
    for (const p of game.s.players) assert.equal(p.hand.length, 8);
  }
});

test('late joiners wait for the next round, then are dealt in', () => {
  const { game, players } = makeGame(['Ann', 'Bob', 'Cat']);
  const late = game.addPlayer('Late', 'token-late');
  assert.equal(late.waiting, true);
  assert.equal(game.viewFor(late.id).me.hand.length, 0);

  const { imposter, others, chooser } = toVoting(game);
  assert.ok(!game.cardPlayers().some((p) => p.id === late.id), 'late joiner does not play this round');
  for (const v of [chooser, ...others]) game.vote(v.id, imposter.id);
  assert.equal(game.s.phase, 'voting', 'the late joiner is not needed to finish voting');
  game.vote(imposter.id, others[0].id);
  assert.equal(game.s.phase, 'results');
  assert.ok(!(late.id in game.s.results.deltas));

  game.nextRound(players[0].id);
  assert.equal(late.waiting, false);
  assert.equal(late.hand.length, 8);
});

test('removing a player mid-round abandons the round; dropping below three returns to the lobby', () => {
  const { game, players } = makeGame(['Ann', 'Bob', 'Cat', 'Dan']);
  game.submitWord(players[0].id, 'x');
  game.removePlayer(players[0].id, players[3].id);
  assert.equal(game.s.phase, 'word');
  assert.equal(game.s.players.length, 3);
  game.removePlayer(players[0].id, players[2].id);
  assert.equal(game.s.phase, 'lobby');
  assert.equal(game.s.players.length, 2);
});

test('only the host can remove others, start and change settings', () => {
  const game = new Game({ getCardIds: () => cards(50), hints: [] });
  const a = game.addPlayer('A', 't1');
  const b = game.addPlayer('B', 't2');
  game.addPlayer('C', 't3');
  assert.throws(() => game.start(b.id), GameError);
  assert.throws(() => game.setHandSize(b.id, 5), GameError);
  assert.throws(() => game.removePlayer(b.id, a.id), GameError);
  game.setHandSize(a.id, 5);
  assert.equal(game.s.handSize, 5);
  assert.throws(() => game.setHandSize(a.id, 1), GameError);
});

test('duplicate and empty names are rejected', () => {
  const game = new Game({ getCardIds: () => cards(50), hints: [] });
  game.addPlayer('Alex', 't1');
  assert.throws(() => game.addPlayer(' alex ', 't2'), GameError);
  assert.throws(() => game.addPlayer('   ', 't3'), GameError);
});

test('hints give three different suggestions and cycle through the whole list', () => {
  const game = new Game({ getCardIds: () => cards(10), hints: cards(9).map(String) });
  const seen = new Set();
  for (let i = 0; i < 3; i++) {
    const three = game.nextHints();
    assert.equal(new Set(three).size, 3);
    three.forEach((h) => seen.add(h));
  }
  assert.equal(seen.size, 9);
});

test('state survives a save and reload, and newly created cards join the deck', () => {
  const { game, players } = makeGame(['Ann', 'Bob', 'Cat'], { cardCount: 60 });
  game.submitWord(players[0].id, 'x');
  const saved = JSON.parse(JSON.stringify(game.toJSON()));
  const reloaded = new Game({ getCardIds: () => cards(70), hints: [], saved });
  assert.equal(reloaded.s.phase, 'picking');
  assert.equal(reloaded.s.draw.length, game.s.draw.length + 10);
  assert.equal(reloaded.s.word, 'x');
});
