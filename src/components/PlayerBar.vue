<script setup>
import { computed } from 'vue';
import { isHost, players, send, store } from '../store.js';

const state = computed(() => store.state);

function status(p) {
  const phase = state.value.phase;
  if (p.waiting) return { text: 'joins next round', tone: 'muted' };
  if (phase === 'word' && p.isChooser) return { text: 'choosing a word', tone: 'busy' };
  if (phase === 'picking') {
    if (p.isChooser) return { text: 'chooser', tone: 'muted' };
    return p.hasPlayed ? { text: 'played', tone: 'done' } : { text: 'choosing a card', tone: 'busy' };
  }
  if (phase === 'voting' && state.value.judging === 'chooser') {
    if (!p.isChooser) return { text: 'making their case', tone: 'busy' };
    return p.hasVoted ? { text: 'decided', tone: 'done' } : { text: 'deciding', tone: 'busy' };
  }
  if (phase === 'voting') return p.hasVoted ? { text: 'voted', tone: 'done' } : { text: 'not voted yet', tone: 'busy' };
  if (!['lobby', 'finished'].includes(phase) && p.isChooser) return { text: 'chooser', tone: 'muted' };
  return null;
}

async function remove(p) {
  if (window.confirm(`Remove ${p.name} from the game?`)) await send('removePlayer', { targetId: p.id });
}
</script>

<template>
  <ul class="bar" aria-label="Players">
    <li
      v-for="p in players"
      :key="p.id"
      class="player"
      :class="{ offline: !p.connected, me: p.id === state.me.id, chooser: p.isChooser && state.phase !== 'lobby' }"
    >
      <div class="top">
        <span class="name">{{ p.name }}</span>
        <span v-if="p.id === state.hostId" class="tag" title="Host">host</span>
        <button
          v-if="isHost && p.id !== state.me.id"
          class="remove quiet"
          :aria-label="`Remove ${p.name}`"
          title="Remove from game"
          @click="remove(p)"
        >
          ×
        </button>
      </div>
      <div class="score">{{ p.score }}</div>
      <div v-if="!p.connected" class="status muted">offline</div>
      <div v-else-if="status(p)" class="status" :class="status(p).tone">{{ status(p).text }}</div>
    </li>
  </ul>
</template>

<style scoped>
.bar {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  gap: 0.6rem;
  overflow-x: auto;
  padding-bottom: 0.3rem;
}
.player {
  flex: 1 0 118px;
  max-width: 220px;
  background: var(--bg-raised);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 0.5rem 0.7rem;
  display: grid;
  gap: 0.1rem;
}
.player.me {
  border-color: #5c8596;
}
.player.chooser {
  border-color: var(--amber);
}
.player.offline {
  opacity: 0.55;
}
.top {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
}
.name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tag {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--amber);
  border: 1px solid var(--amber);
  border-radius: 999px;
  padding: 0 0.4rem;
}
.remove {
  margin-left: auto;
  padding: 0 0.45rem;
  line-height: 1.3;
  border-radius: 8px;
  color: var(--muted);
}
.score {
  font-family: var(--display);
  font-size: 1.3rem;
  color: var(--amber);
}
.status {
  font-size: 0.8rem;
}
.status.done {
  color: var(--moss);
}
.status.busy {
  color: var(--amber);
}
</style>
