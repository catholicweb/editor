<script setup>
import { guard, guardStay, guardDiscard, guardSave } from '../lib/guard.js';
</script>

<template>
  <transition name="fade">
    <div v-if="guard.open" class="overlay" @click.self="guardStay">
      <div class="modal" role="dialog" aria-modal="true">
        <h2>{{ guard.title }}</h2>
        <p class="msg">{{ guard.message }}</p>
        <p v-if="guard.error" class="error">{{ guard.error }}</p>
        <div class="actions">
          <button class="btn stay" @click="guardStay">{{ guard.stayLabel }}</button>
          <button class="btn discard" @click="guardDiscard">{{ guard.discardLabel }}</button>
          <button class="btn save" :disabled="guard.saving" @click="guardSave">
            {{ guard.saving ? 'Guardando…' : guard.saveLabel }}
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 17, 21, 0.5);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
  padding: 24px;
}
.modal {
  background: var(--pe-panel);
  border: 1px solid var(--pe-border);
  border-radius: var(--pe-radius-lg);
  box-shadow: var(--pe-shadow-lg);
  width: 100%;
  max-width: 420px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
}
.msg {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--pe-muted);
}
.error {
  margin: 0;
  font-size: 13px;
  color: var(--pe-danger);
  background: var(--pe-danger-soft);
  border: 1px solid var(--pe-danger-soft);
  border-radius: var(--pe-radius);
  padding: 8px 12px;
}
.actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.btn {
  padding: 9px 14px;
  border-radius: var(--pe-radius);
  border: 1px solid var(--pe-border);
  background: var(--pe-panel);
  color: var(--pe-text);
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  transition: background var(--pe-transition), border-color var(--pe-transition), box-shadow var(--pe-transition), transform var(--pe-transition);
}
.btn:hover:not(:disabled) {
  background: var(--pe-hover);
  border-color: var(--pe-border-strong);
}
.btn:active:not(:disabled) {
  transform: translateY(1px);
}
.btn.save {
  background: var(--pe-accent);
  border-color: var(--pe-accent);
  color: white;
  order: 3;
}
.btn.save:hover:not(:disabled) {
  background: var(--pe-accent-hover);
  border-color: var(--pe-accent-hover);
  box-shadow: var(--pe-shadow-sm);
}
.btn.discard {
  color: var(--pe-danger);
  border-color: var(--pe-border);
  order: 2;
}
.btn.discard:hover:not(:disabled) {
  background: var(--pe-danger-soft);
  border-color: var(--pe-danger);
}
.btn.stay {
  order: 1;
}
.btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--pe-transition);
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
