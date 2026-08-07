<script setup>
import { reactive, ref } from 'vue';
import { state, requestMagicLink, DEFAULTS } from '../../lib/store.js';
import SessionScreen from './SessionScreen.vue';

const form = reactive({ email: '' });

// True once a link has been requested: show the "revisa tu correo" panel.
const sent = ref(false);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function submit() {
  const email = form.email.trim();
  if (!EMAIL_RE.test(email)) {
    state.error = 'Introduce un correo válido.';
    return;
  }
  state.error = '';
  try {
    await requestMagicLink({ apiBase: DEFAULTS.apiBase, email });
    sent.value = true;
  } catch {
    // error already set in the store
  }
}
</script>

<template>
  <SessionScreen>
    <form v-if="!sent" class="login-card" @submit.prevent="submit">
      <h1>Editor de contenidos</h1>
      <p class="hint">
        Introduce tu correo y te enviaremos un enlace de acceso. Cada enlace es
        de un solo uso y caduca en unos minutos.
      </p>

      <label>
        Tu correo
        <input
          v-model="form.email"
          type="email"
          autocomplete="email"
          placeholder="editor@ejemplo.com"
          required
        />
      </label>

      <button type="submit" :disabled="state.loading">
        {{ state.loading ? 'Enviando…' : 'Enviarme el enlace de acceso' }}
      </button>

      <p v-if="state.error" class="error">{{ state.error }}</p>
    </form>

    <div v-else class="login-card">
      <h1>Revisa tu correo</h1>
      <p class="hint">
        Te hemos enviado un enlace de acceso a <strong>{{ form.email.trim() }}</strong>.
        Ábrelo y pulsa el enlace para entrar. Si tu correo tiene acceso a algún
        sitio, recibirás un mensaje con el enlace.
      </p>
      <button type="button" @click="sent = false">Volver</button>
    </div>
  </SessionScreen>
</template>

<style scoped>
.login-card {
  width: 100%;
  max-width: 420px;
  margin: auto; /* center the card in the SessionScreen flex column */
  background: var(--pe-panel);
  border: 1px solid var(--pe-border);
  border-radius: var(--pe-radius-lg);
  padding: 32px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-shadow: var(--pe-shadow-lg);
}
.login-card h1 {
  font-size: 22px;
  margin: 0;
  font-weight: 700;
}
.hint {
  font-size: 13px;
  color: var(--pe-muted);
  margin: 0 0 4px;
  line-height: 1.5;
}
label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--pe-text);
}
input {
  font: inherit;
  font-weight: 400;
  font-size: 14px;
  padding: 10px 12px;
  border-radius: var(--pe-radius);
  border: 1px solid var(--pe-border);
  background: var(--pe-input-bg);
  color: var(--pe-text);
  transition: border-color var(--pe-transition), box-shadow var(--pe-transition);
}
input:focus,
input:focus-visible {
  outline: none;
  border-color: var(--pe-accent);
  box-shadow: var(--pe-ring);
}
button {
  margin-top: 8px;
  padding: 11px 14px;
  border-radius: var(--pe-radius);
  border: none;
  background: var(--pe-accent);
  color: white;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: background var(--pe-transition), box-shadow var(--pe-transition), transform var(--pe-transition);
}
button:hover:not(:disabled) {
  background: var(--pe-accent-hover);
  box-shadow: var(--pe-shadow-sm);
}
button:active:not(:disabled) {
  transform: translateY(1px);
}
button:disabled {
  opacity: 0.6;
  cursor: default;
}
.error {
  color: var(--pe-danger);
  background: var(--pe-danger-soft);
  border: 1px solid var(--pe-danger-soft);
  border-radius: var(--pe-radius);
  font-size: 13px;
  margin: 0;
  padding: 9px 12px;
}
</style>
