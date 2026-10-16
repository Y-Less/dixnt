// Pure game rules for the imposter Dixit game. No networking in here, so it is easy to test.
//
// Round flow:  word -> picking -> voting -> results -> (next round) word ...
//   word        the chooser types a word or phrase
//   picking     everyone except the chooser plays a card; one random player (the imposter) sees "???"
//   voting      all cards and the real word are shown. The group talks, and anyone can vote at any time
//               (changing their vote until the last vote is in). The round ends once everyone has voted.
//   results     the imposter is revealed and points are awarded
//
// Verdict: the group is correct only if the imposter has strictly the most votes. A tie for most votes
// (including the imposter tying with another player) counts as the group being wrong.

export const POINTS_PER_VOTE = 100;
export const MIN_PLAYERS = 3;
export const MIN_HAND_SIZE = 3;
export const MAX_HAND_SIZE = 12;
export const DEFAULT_HAND_SIZE = 8;
export const MAX_NAME_LENGTH = 20;
export const MAX_WORD_LENGTH = 60;

export class GameError extends Error {}
const fail = (message) => {
  throw new GameError(message);
};

export function shuffle(items, rng = Math.random) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

const newPublicId = () => Math.random().toString(36).slice(2, 10);

export class Game {
  /**
   * @param {object} options
   * @param {() => number[]} options.getCardIds returns the ids of every card currently available
   * @param {string[]} options.hints word/phrase suggestions for the chooser
   * @param {() => number} [options.rng]
   * @param {object} [options.saved] a previously saved state (see toJSON)
   */
  constructor({ getCardIds, hints = [], rng = Math.random, saved = null }) {
    this.getCardIds = getCardIds;
    this.hints = hints;
    this.rng = rng;
    this.hintPool = [];
    this.s = saved ?? Game.blankState();
    if (this.s.phase === 'discussion') this.s.phase = 'voting'; // saved by an older version that had a separate step
    delete this.s.ready;
    this.syncCards();
  }

  static blankState() {
    return {
      phase: 'lobby',
      players: [], // { id, token, name, score, hand: number[], waiting: boolean }
      hostId: null,
      handSize: DEFAULT_HAND_SIZE,
      round: 0,
      nextChooserIdx: 0,
      chooserId: null,
      draw: [],
      discard: [],
      word: null,
      imposterId: null,
      picks: {}, // playerId -> cardId
      tableOrder: [], // playerIds, shuffled once all cards are in
      votes: {}, // playerId -> playerId
      results: null,
    };
  }

  toJSON() {
    return this.s;
  }

  // ---------- lookups ----------

  player(id) {
    return this.s.players.find((p) => p.id === id) ?? null;
  }

  findByToken(token) {
    return this.s.players.find((p) => p.token === token) ?? null;
  }

  requirePlayer(id) {
    return this.player(id) ?? fail('You are not in this game.');
  }

  isHost(id) {
    return this.s.hostId === id;
  }

  /** Players taking part in the current round (everyone except late joiners). */
  inRound() {
    return this.s.players.filter((p) => !p.waiting);
  }

  /** Players who play a card this round (everyone in the round except the chooser). */
  cardPlayers() {
    return this.inRound().filter((p) => p.id !== this.s.chooserId);
  }

  // ---------- deck ----------

  /** Keeps the deck in step with the cards on disk: new cards join the draw pile, missing ones vanish. */
  syncCards() {
    const available = new Set(this.getCardIds());
    const s = this.s;
    const known = new Set();
    const keep = (id) => available.has(id) && !known.has(id) && known.add(id);
    s.draw = s.draw.filter(keep);
    s.discard = s.discard.filter(keep);
    for (const p of s.players) p.hand = p.hand.filter(keep);
    const fresh = [...available].filter((id) => !known.has(id));
    if (s.phase !== 'lobby' && fresh.length) {
      s.draw.push(...fresh);
      shuffle(s.draw, this.rng);
    }
  }

  drawUp(player) {
    const s = this.s;
    while (player.hand.length < s.handSize) {
      if (!s.draw.length) {
        if (!s.discard.length) return; // nothing left anywhere
        s.draw = shuffle(s.discard, this.rng);
        s.discard = [];
      }
      player.hand.push(s.draw.pop());
    }
  }

  // ---------- players and lobby ----------

  addPlayer(name, token) {
    const clean = String(name ?? '').trim().replace(/\s+/g, ' ');
    if (!clean) fail('Please enter a name.');
    if (clean.length > MAX_NAME_LENGTH) fail(`Names can be at most ${MAX_NAME_LENGTH} characters.`);
    if (this.s.players.some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
      fail('Someone is already using that name.');
    }
    const player = {
      id: newPublicId(),
      token,
      name: clean,
      score: 0,
      hand: [],
      waiting: this.s.phase !== 'lobby', // late joiners wait for the next round
    };
    this.s.players.push(player);
    this.s.hostId ??= player.id;
    return player;
  }

  removePlayer(byId, targetId) {
    const s = this.s;
    if (byId !== targetId && !this.isHost(byId)) fail('Only the host can remove other players.');
    const index = s.players.findIndex((p) => p.id === targetId);
    if (index < 0) fail('That player is not in the game.');
    const [removed] = s.players.splice(index, 1);
    s.discard.push(...removed.hand);
    if (index < s.nextChooserIdx) s.nextChooserIdx--;
    if (s.hostId === targetId) s.hostId = s.players[0]?.id ?? null;
    if (!s.players.length) {
      Object.assign(s, Game.blankState(), { handSize: s.handSize });
      return;
    }
    if (s.phase === 'lobby') return;
    if (s.players.length < MIN_PLAYERS) {
      this.returnToLobby();
    } else if (!removed.waiting) {
      this.startRound(); // the round can't continue without them, so move on
    }
  }

  setHandSize(byId, size) {
    if (!this.isHost(byId)) fail('Only the host can change the hand size.');
    if (this.s.phase !== 'lobby') fail('The hand size can only be changed in the lobby.');
    const n = Math.round(Number(size));
    if (!(n >= MIN_HAND_SIZE && n <= MAX_HAND_SIZE)) {
      fail(`Hand size must be between ${MIN_HAND_SIZE} and ${MAX_HAND_SIZE}.`);
    }
    this.s.handSize = n;
  }

  start(byId) {
    const s = this.s;
    if (!this.isHost(byId)) fail('Only the host can start the game.');
    if (s.phase !== 'lobby') fail('The game has already started.');
    if (s.players.length < MIN_PLAYERS) fail(`You need at least ${MIN_PLAYERS} players.`);
    const cardIds = this.getCardIds();
    if (cardIds.length < s.players.length * s.handSize) fail('There are not enough cards for that many players.');
    s.draw = shuffle([...cardIds], this.rng);
    s.discard = [];
    for (const p of s.players) {
      p.hand = [];
      p.score = 0;
    }
    s.round = 0;
    s.nextChooserIdx = 0;
    this.startRound();
  }

  returnToLobby(byId = null) {
    const s = this.s;
    if (byId && !this.isHost(byId)) fail('Only the host can end the game.');
    Object.assign(s, {
      phase: 'lobby',
      round: 0,
      chooserId: null,
      draw: [],
      discard: [],
      word: null,
      imposterId: null,
      picks: {},
      tableOrder: [],
      votes: {},
      results: null,
    });
    for (const p of s.players) {
      p.hand = [];
      p.waiting = false;
    }
  }

  // ---------- round flow ----------

  startRound() {
    const s = this.s;
    this.syncCards();
    for (const p of s.players) p.waiting = false;
    s.round++;
    const idx = s.nextChooserIdx % s.players.length;
    s.chooserId = s.players[idx].id;
    s.nextChooserIdx = idx + 1;
    Object.assign(s, { word: null, imposterId: null, picks: {}, tableOrder: [], votes: {}, results: null });
    for (const p of s.players) this.drawUp(p);
    s.phase = 'word';
  }

  /** Abandons the current round without scoring or discarding, and moves to the next chooser. */
  abortRound(byId) {
    if (!this.isHost(byId)) fail('Only the host can skip a round.');
    if (!['word', 'picking', 'voting'].includes(this.s.phase)) fail('There is no round to skip.');
    this.startRound();
  }

  nextHints(count = 3) {
    if (this.hintPool.length < count) {
      this.hintPool = shuffle([...this.hints], this.rng);
    }
    return this.hintPool.splice(-count, count);
  }

  submitWord(id, word) {
    const s = this.s;
    if (s.phase !== 'word') fail('It is not time to choose a word.');
    if (id !== s.chooserId) fail('Only the chooser can pick the word.');
    const clean = String(word ?? '').trim().replace(/\s+/g, ' ');
    if (!clean) fail('Type a word or phrase first.');
    if (clean.length > MAX_WORD_LENGTH) fail(`Keep it to ${MAX_WORD_LENGTH} characters or fewer.`);
    const candidates = this.cardPlayers();
    s.word = clean;
    s.imposterId = candidates[Math.floor(this.rng() * candidates.length)].id;
    s.phase = 'picking';
  }

  playCard(id, cardId) {
    const s = this.s;
    if (s.phase !== 'picking') fail('It is not time to play a card.');
    const player = this.requirePlayer(id);
    if (player.waiting || id === s.chooserId) fail('You do not play a card this round.');
    if (!player.hand.includes(cardId)) fail('That card is not in your hand.');
    s.picks[id] = cardId;
    if (this.cardPlayers().every((p) => p.id in s.picks)) {
      s.tableOrder = shuffle(this.cardPlayers().map((p) => p.id), this.rng);
      s.votes = {};
      s.phase = 'voting';
    }
  }

  vote(id, targetId) {
    const s = this.s;
    if (s.phase !== 'voting') fail('It is not time to vote.');
    const voter = this.requirePlayer(id);
    if (voter.waiting) fail('You are waiting for the next round.');
    if (id === targetId) fail('You cannot vote for yourself.');
    if (!this.cardPlayers().some((p) => p.id === targetId)) fail('You can only vote for someone who played a card.');
    s.votes[id] = targetId;
    if (this.inRound().every((p) => p.id in s.votes)) this.resolveVotes();
  }

  resolveVotes() {
    const s = this.s;
    const tally = Object.fromEntries(this.cardPlayers().map((p) => [p.id, 0]));
    for (const target of Object.values(s.votes)) tally[target]++;

    const imposterVotes = tally[s.imposterId];
    const bestOther = Math.max(0, ...Object.entries(tally).filter(([id]) => id !== s.imposterId).map(([, n]) => n));
    const groupCorrect = imposterVotes > bestOther;

    const deltas = Object.fromEntries(this.inRound().map((p) => [p.id, 0]));
    const voters = this.inRound().filter((p) => p.id !== s.imposterId);
    if (groupCorrect) {
      for (const voter of voters) {
        if (s.votes[voter.id] === s.imposterId) deltas[voter.id] = POINTS_PER_VOTE;
      }
    } else {
      const fooled = voters.filter((v) => s.votes[v.id] !== s.imposterId).length;
      deltas[s.imposterId] = fooled * POINTS_PER_VOTE;
    }
    for (const p of this.inRound()) p.score += deltas[p.id];

    s.results = { imposterId: s.imposterId, groupCorrect, tally, deltas, votes: { ...s.votes } };
    s.phase = 'results';
  }

  nextRound(id) {
    const s = this.s;
    if (s.phase !== 'results') fail('The round is not over yet.');
    this.requirePlayer(id);
    // Played cards go to the discard pile; startRound() then tops everyone's hand back up.
    for (const p of this.inRound()) {
      const cardId = s.picks[p.id];
      if (cardId === undefined) continue;
      p.hand = p.hand.filter((c) => c !== cardId);
      s.discard.push(cardId);
    }
    this.startRound();
  }

  // ---------- what each player is allowed to see ----------

  viewFor(id, connectedIds = new Set()) {
    const s = this.s;
    const me = this.player(id);
    if (!me) return null;
    const inPlay = ['picking', 'voting', 'results'].includes(s.phase);
    const iAmImposter = id === s.imposterId;
    const wordRevealed = ['voting', 'results'].includes(s.phase);

    let word = null;
    if (s.word !== null && (wordRevealed || (s.phase === 'picking' && !iAmImposter))) word = s.word;

    const cardsOnTable = s.phase === 'picking' ? [] : s.tableOrder.map((pid) => ({ playerId: pid, cardId: s.picks[pid] }));

    return {
      phase: s.phase,
      round: s.round,
      handSize: s.handSize,
      chooserId: s.chooserId,
      hostId: s.hostId,
      minPlayers: MIN_PLAYERS,
      pointsPerVote: POINTS_PER_VOTE,
      drawCount: s.draw.length,
      discardCount: s.discard.length,
      word,
      wordHidden: s.phase === 'picking' && iAmImposter,
      me: {
        id: me.id,
        waiting: me.waiting,
        isChooser: id === s.chooserId,
        hand: me.waiting || s.phase === 'lobby' ? [] : me.hand,
        myPick: s.picks[id] ?? null,
        myVote: s.votes[id] ?? null,
        isImposter: s.phase === 'results' && iAmImposter,
      },
      players: s.players.map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        waiting: p.waiting,
        connected: connectedIds.has(p.id),
        isChooser: p.id === s.chooserId,
        hasPlayed: inPlay && p.id in s.picks,
        hasVoted: s.phase === 'voting' ? p.id in s.votes : false,
      })),
      table: cardsOnTable,
      voteTargets: s.phase === 'voting' ? this.cardPlayers().filter((p) => p.id !== id).map((p) => p.id) : [],
      results: s.phase === 'results' ? s.results : null,
    };
  }
}
