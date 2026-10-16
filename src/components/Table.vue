<script setup>
import { computed } from 'vue';
import { nameOf, send, store } from '../store.js';
import CardImg from './CardImg.vue';

// The cards played this round. In the voting phase each card has a vote button; in the results phase
// the cards show who voted for whom and the points gained.
const state = computed(() => store.state);
const voting = computed(() => state.value.phase === 'voting');
const results = computed(() => state.value.results);

const votersFor = (playerId) =>
  Object.entries(results.value?.votes ?? {})
    .filter(([, target]) => target === playerId)
    .map(([voter]) => nameOf(voter));

function voteSummary(playerId) {
  if (results.value.judging === 'favourite') return '';
  const count = results.value.tally[playerId];
  const names = votersFor(playerId);
  return `${count} vote${count === 1 ? '' : 's'}${names.length ? `: ${names.join(', ')}` : ''}`;
}

/** Votes in the 'everyone' style can be changed, but a chooser's decision ends the round, so ask first. */
function castVote(playerId) {
  if (state.value.judging !== 'everyone') {
    const question =
      state.value.judging === 'favourite'
        ? `Pick ${nameOf(playerId)}’s card as your favourite? This ends the round.`
        : `Decide that ${nameOf(playerId)} was in the dark? This ends the round.`;
    if (!window.confirm(question)) return;
  }
  send('vote', { targetId: playerId });
}

function zoom(cardId) {
  store.zoom = { cardId, actions: [] };
}

const canVoteFor = (playerId) => voting.value && state.value.voteTargets.includes(playerId);
</script>

<template>
  <div class="table">
    <figure
      v-for="entry in state.table"
      :key="entry.playerId"
      class="played"
      :class="{
        mine: entry.playerId === state.me.id,
        chosen: voting && state.me.myVote === entry.playerId,
        imposter: results && results.imposterId === entry.playerId,
        winner: results && results.winnerId === entry.playerId,
      }"
    >
      <button class="art" :aria-label="`Look closer at ${nameOf(entry.playerId)}'s card`" @click="zoom(entry.cardId)">
        <CardImg :card-id="entry.cardId" />
        <span v-if="results && results.imposterId === entry.playerId" class="stamp">Imposter</span>
        <span v-else-if="results && results.winnerId === entry.playerId" class="stamp favourite">Favourite</span>
      </button>
      <figcaption>
        <strong>{{ nameOf(entry.playerId) }}<span v-if="entry.playerId === state.me.id" class="muted"> (you)</span></strong>

        <template v-if="voting">
          <button
            v-if="canVoteFor(entry.playerId)"
            :class="{ primary: state.me.myVote === entry.playerId }"
            @click="castVote(entry.playerId)"
          >
            {{ state.me.myVote === entry.playerId ? 'Your pick' : state.judging === 'favourite' ? 'Pick this one' : 'Vote' }}
          </button>
        </template>

        <template v-if="results">
          <span class="muted votes">{{ voteSummary(entry.playerId) }}</span>
        </template>
      </figcaption>
    </figure>
  </div>
</template>

<style scoped>
.table {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1rem;
  align-items: start;
}
@media (min-width: 900px) {
  .table {
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  }
}
.played {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.art {
  position: relative;
  padding: 0;
  border: 3px solid transparent;
  border-radius: 14px;
  background: none;
}
.art:hover:not(:disabled) {
  background: none;
  border-color: var(--line);
}
.chosen .art {
  border-color: var(--amber);
}
.imposter .art {
  border-color: var(--rust);
}
.winner .art {
  border-color: var(--moss);
}
.stamp.favourite {
  background: var(--moss);
  color: #10200f;
}
.stamp {
  position: absolute;
  top: 10px;
  right: -6px;
  transform: rotate(6deg);
  background: var(--rust);
  color: #fff;
  font-weight: 700;
  font-size: 0.85rem;
  padding: 0.15rem 0.7rem;
  border-radius: 6px;
  box-shadow: 0 3px 8px rgb(0 0 0 / 0.5);
}
figcaption {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  text-align: center;
}
.votes {
  font-size: 0.9rem;
}
</style>
