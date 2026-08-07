<script setup>
// Shared full-view shell for the session/account screens (login, admin).
// Provides the full-height app background; each screen keeps control of its
// own alignment (login centers its card, admin is top-aligned).
</script>

<template>
  <div class="session-screen">
    <slot />
  </div>
</template>

<style scoped>
.session-screen {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--pe-bg);
  box-sizing: border-box;
}
</style>
