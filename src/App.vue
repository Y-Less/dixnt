<script setup>
import { computed } from 'vue';
import { goHome, inviteUrl, isHost, send, showToast, store } from './store.js';
import Hand from './components/Hand.vue';
import HomeScreen from './components/HomeScreen.vue';
import FinishedPanel from './components/FinishedPanel.vue';
import Lightbox from './components/Lightbox.vue';
import LobbyView from './components/LobbyView.vue';
import PhasePanel from './components/PhasePanel.vue';
import PlayerBar from './components/PlayerBar.vue';
import ResultsPanel from './components/ResultsPanel.vue';

const state = computed(() => store.state);
const showHand = computed(() => ['word', 'picking'].includes(state.value?.phase));

async function leave() {
  if (!window.confirm('Leave the game? Your score will be lost.')) return;
  await send('leave');
  goHome();
}
async function copyInvite() {
  const link = inviteUrl(state.value.code);
  try {
    await navigator.clipboard.writeText(link);
    showToast('Invite link copied. Send it to your friends.');
  } catch {
    showToast(link);
  }
}
async function endGame() {
  if (window.confirm('End the game and return everyone to the lobby? Scores are reset.')) await send('endGame');
}
async function skipRound() {
  if (window.confirm('Abandon this round (no points) and move on to the next word-chooser?')) await send('abortRound');
}
</script>

<template>
  <div v-if="!store.checkedSession" class="splash muted">Connecting…</div>
  <HomeScreen v-else-if="!state" />

  <div v-else class="game">
    <header>
      <h1>Imposter Dixit</h1>
      <button class="quiet code" title="Copy the invite link" @click="copyInvite">{{ state.code }}</button>
      <span v-if="state.phase === 'finished'" class="muted round">Game over</span>
      <span v-else-if="state.phase !== 'lobby'" class="muted round">
        Round {{ state.round }} of {{ state.totalRounds }} · deck {{ state.drawCount }} / discard {{ state.discardCount }}
      </span>
      <div class="menu">
        <button v-if="isHost && ['word', 'picking', 'voting'].includes(state.phase)" class="quiet" @click="skipRound">
          Skip round
        </button>
        <button v-if="isHost && !['lobby', 'finished'].includes(state.phase)" class="quiet" @click="endGame">End game</button>
        <button class="quiet" @click="leave">Leave</button>
      </div>
    </header>

    <PlayerBar />

    <main class="stack">
      <LobbyView v-if="state.phase === 'lobby'" />
      <ResultsPanel v-else-if="state.phase === 'results'" />
      <FinishedPanel v-else-if="state.phase === 'finished'" />
      <PhasePanel v-else />
      <Hand v-if="showHand" />
    </main>

    <div v-if="!store.connected" class="offline" role="status">Connection lost. Trying to reconnect…</div>
    <div v-if="store.toast" class="toast" role="status">{{ store.toast }}</div>
  </div>

  <Lightbox />
</template>

<style scoped>
.splash {
  display: grid;
  place-items: center;
  min-height: 60vh;
}
.game {
  max-width: 1100px;
  margin: 0 auto;
  padding: 14px 16px 5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
header {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.3rem 1rem;
}
h1 {
  font-size: 1.5rem;
  color: var(--amber);
}
.round {
  font-size: 0.9rem;
}
.code {
  font-size: 0.85rem;
}
.menu {
  margin-left: auto;
  display: flex;
  gap: 0.3rem;
}
.toast,
.offline {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  z-index: 60;
  padding: 0.6rem 1.1rem;
  border-radius: 999px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.5);
  max-width: 92vw;
  text-align: center;
}
.toast {
  bottom: 1.2rem;
  background: var(--parchment);
  color: #2a2418;
}
.offline {
  top: 0.8rem;
  background: var(--rust);
  color: #fff;
}
</style>
