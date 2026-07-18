import { reactive } from 'vue';
import { isDirty, saveCurrent } from './store.js';

// Shared "you have unsaved changes" guard. Triggered before leaving the
// current file (switching to another file, logging out, …). The caller
// awaits confirmDirty(); the mounted DirtyGuardModal resolves it with one
// of: 'save' | 'discard' | 'stay'.
//
//   const choice = await confirmDirty({ message: 'Cambiar de fichero' });
//   if (choice === 'stay') return;          // user cancelled
//   if (choice === 'discard') { … }         // proceed, drop changes
//   if (choice === 'save')   { … }          // already saved, proceed

export const guard = reactive({
  open: false,
  title: 'Hay cambios sin guardar',
  message: '',
  saveLabel: 'Guardar y salir',
  discardLabel: 'Salir sin guardar',
  stayLabel: 'Cancelar',
  saving: false,
  error: '',
  resolve: null,
});

export function confirmDirty(opts = {}) {
  return new Promise((resolve) => {
    guard.title = opts.title || 'Hay cambios sin guardar';
    guard.message = opts.message || '¿Qué quieres hacer con los cambios de este fichero?';
    guard.saveLabel = opts.saveLabel || 'Guardar y salir';
    guard.discardLabel = opts.discardLabel || 'Salir sin guardar';
    guard.stayLabel = opts.stayLabel || 'Cancelar';
    guard.error = '';
    guard.saving = false;
    guard.open = true;
    guard.resolve = resolve;
  });
}

function settle(choice) {
  if (guard.resolve) guard.resolve(choice);
  guard.open = false;
  guard.resolve = null;
  guard.saving = false;
  guard.error = '';
}

export function guardStay() {
  settle('stay');
}

export function guardDiscard() {
  settle('discard');
}

// Save first; only proceed if the save actually succeeded. On error we
// keep the modal open and surface the message so the user can retry or cancel.
export async function guardSave() {
  if (guard.saving) return;
  guard.saving = true;
  guard.error = '';
  try {
    await saveCurrent();
    settle('save');
  } catch (err) {
    guard.error = err.message || String(err);
    guard.saving = false;
  }
}

export { isDirty };
