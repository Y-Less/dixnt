<script setup>
import { computed } from 'vue';
import { isHost, players, send, store, showToast } from '../store.js';

const state = computed(() => store.state);
const enough = computed(() => players.value.length >= state.value.minPlayers);

async function copyLink() {
  try {
    await navigator.clipboard.writeText(window.location.href);
    showToast('Link copied. Send it to your friends.');
  } catch {
    showToast(window.location.href);
  }
}
</script>

<template>
  <section class="panel stack">
    <h2>Waiting for players</h2>
    <p class="muted">
      Share this page with your friends so they can join. You need at least {{ state.minPlayers }} players.
    </p>
    <div class="row">
      <button @click="copyLink">Copy invite link</button>
    </div>

    <div v-if="isHost" class="stack settings">
      <label class="row">
        Cards per hand
        <input
          type="number"
          class="num"
          min="3"
          max="12"
          :value="state.handSize"
          @change="send('setHandSize', { size: $event.target.value })"
        />
      </label>
      <button class="primary" :disabled="!enough" @click="send('start')">
        {{ enough ? 'Start the game' : `Need ${state.minPlayers - players.length} more player${state.minPlayers - players.length === 1 ? '' : 's'}` }}
      </button>
    </div>
    <p v-else class="muted">Waiting for the host to start the game. Hands will be {{ state.handSize }} cards.</p>
  </section>

  <section class="panel rules">
    <h3>How it works</h3>
    <ol>
      <li>Each round one player thinks of a word or phrase and types it in.</li>
      <li>Everyone else sees it, except one random player who just sees ???.</li>
      <li>They all play the card from their hand that best fits the word. The player in the dark has to bluff.</li>
      <li>The cards and the word are revealed. Talk it through and justify your choices.</li>
      <li>Everyone votes for who they think was in the dark. Spot them and you each score 100. If the group is fooled, the imposter scores 100 for every player who missed them.</li>
    </ol>
  </section>
</template>

<style scoped>
.settings {
  border-top: 1px solid var(--line);
  padding-top: 0.9rem;
}
.num {
  width: 5rem;
}
.rules ol {
  margin: 0.6rem 0 0;
  padding-left: 1.2rem;
  display: grid;
  gap: 0.35rem;
  color: var(--muted);
}
</style>
