<script setup>
import { computed } from 'vue';
import { store } from '../store.js';

const state = computed(() => store.state);

const banner = computed(() => {
  const s = state.value;
  if (s.phase === 'picking') {
    if (s.wordHidden) {
      return { big: '???', note: 'You didn’t get to see the word. Play a card that could fit, and blend in.', dark: true };
    }
    if (s.me.isChooser) return { big: s.word, note: 'This is your word. Waiting for everyone to play a card.' };
    if (s.judging === 'favourite') {
      return { big: s.word, note: 'Play the card that fits it best. The chooser will pick their favourite.' };
    }
    return { big: s.word, note: 'One player can’t see this word. Play the card that fits it best.' };
  }
  if (['voting', 'results'].includes(s.phase)) {
    return { label: 'The word was', big: s.word };
  }
  return null;
});
</script>

<template>
  <div v-if="banner" class="banner" :class="{ dark: banner.dark }">
    <span v-if="banner.label" class="label">{{ banner.label }}</span>
    <span class="word">{{ banner.big }}</span>
    <span v-if="banner.note" class="note">{{ banner.note }}</span>
  </div>
</template>

<style scoped>
.banner {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.25rem;
  padding: 1.1rem 1rem;
  border-radius: var(--radius);
  border: 1px solid var(--amber);
  background: linear-gradient(180deg, #2c4350, #21363f);
}
.banner.dark {
  border-color: var(--rust);
  background: linear-gradient(180deg, #3b2a2a, #2a2020);
}
.label {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--muted);
}
.word {
  font-family: var(--display);
  font-size: clamp(2rem, 7vw, 3.2rem);
  line-height: 1.1;
  color: var(--amber);
  overflow-wrap: anywhere;
}
.dark .word {
  color: var(--danger);
  letter-spacing: 0.2em;
}
.note {
  color: var(--muted);
  max-width: 34rem;
}
</style>
