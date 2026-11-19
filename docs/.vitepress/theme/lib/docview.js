// Per-browser preference: show block lists flagged `list: { document: true }`
// as one flowing document (default) or as the classic list of collapsible
// sections. Kept out of the schema/config: it is a viewing choice, not content.
import { ref } from 'vue';

const KEY = 'pe.docView';

function read() {
  try {
    return localStorage.getItem(KEY) !== 'list';
  } catch {
    return true;
  }
}

export const docView = ref(read());

export function toggleDocView() {
  docView.value = !docView.value;
  try {
    localStorage.setItem(KEY, docView.value ? 'doc' : 'list');
  } catch {
    /* private mode / storage disabled: keep the choice for this session only */
  }
}
