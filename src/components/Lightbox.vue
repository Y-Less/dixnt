<script setup>
import { onBeforeUnmount, onMounted } from 'vue';
import { store } from '../store.js';
import CardImg from './CardImg.vue';

const close = () => (store.zoom = null);

async function run(action) {
  close();
  await action.run();
}

function onKey(event) {
  if (event.key === 'Escape') close();
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div v-if="store.zoom" class="backdrop" @click.self="close">
    <div class="viewer" role="dialog" aria-modal="true" aria-label="Card preview">
      <CardImg :card-id="store.zoom.cardId" size="medium" class="big" />
      <div class="actions">
        <button
          v-for="action in store.zoom.actions ?? []"
          :key="action.label"
          :class="{ primary: action.primary }"
          @click="run(action)"
        >
          {{ action.label }}
        </button>
        <button class="quiet" @click="close">Close</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgb(8 16 20 / 0.86);
  display: grid;
  place-items: center;
  padding: 1rem;
}
.viewer {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  align-items: center;
  max-height: 100%;
}
.big {
  height: min(78vh, 760px);
  width: auto;
  max-width: 92vw;
}
.actions {
  display: flex;
  gap: 0.6rem;
}
</style>
