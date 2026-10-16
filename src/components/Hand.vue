<script setup>
import { computed } from 'vue';
import { send, store } from '../store.js';
import CardImg from './CardImg.vue';

const state = computed(() => store.state);
const canPlay = computed(() => state.value.phase === 'picking' && !state.value.me.isChooser && !state.value.me.waiting);

function open(cardId) {
  const actions = [];
  if (canPlay.value) {
    const chosen = state.value.me.myPick === cardId;
    actions.push({
      label: chosen ? 'Already played' : state.value.me.myPick === null ? 'Play this card' : 'Play this one instead',
      primary: true,
      run: () => !chosen && send('playCard', { cardId }),
    });
  }
  store.zoom = { cardId, actions };
}
</script>

<template>
  <section v-if="state.me.hand.length" class="hand" aria-label="Your hand">
    <h2 class="label">Your hand</h2>
    <div class="cards">
      <button
        v-for="cardId in state.me.hand"
        :key="cardId"
        class="slot"
        :class="{ played: state.me.myPick === cardId, dim: state.me.myPick !== null && state.me.myPick !== cardId }"
        :aria-label="`Card ${cardId}${state.me.myPick === cardId ? ', played' : ''}`"
        @click="open(cardId)"
      >
        <CardImg :card-id="cardId" size="small" />
        <span v-if="state.me.myPick === cardId" class="badge">Played</span>
      </button>
    </div>
    <p v-if="canPlay && state.me.myPick === null" class="muted hint">Tap a card to look closer and play it.</p>
  </section>
</template>

<style scoped>
.label {
  font-size: 1rem;
  color: var(--muted);
  font-family: var(--body);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 0.6rem;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: 0.7rem;
}
.slot {
  position: relative;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 12px;
  background: none;
  transition: transform 0.15s, opacity 0.15s, border-color 0.15s;
}
.slot:hover:not(:disabled) {
  background: none;
  transform: translateY(-4px);
}
.slot.played {
  border-color: var(--amber);
}
.slot.dim {
  opacity: 0.55;
}
.badge {
  position: absolute;
  left: 50%;
  bottom: 8px;
  transform: translateX(-50%);
  background: var(--amber);
  color: var(--amber-ink);
  font-size: 0.75rem;
  font-weight: 700;
  padding: 0.1rem 0.55rem;
  border-radius: 999px;
}
.hint {
  margin: 0.6rem 0 0;
  font-size: 0.9rem;
}
</style>
