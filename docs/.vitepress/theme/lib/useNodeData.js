// Two-way binding between a Tiptap node's `attrs.data` (a block item, stored as
// plain JSON) and a reactive object the generic form (FieldsGroup) can mutate.
// Edits push a fresh clone back with updateAttributes (one undo step per change);
// changes that come from the editor (undo/redo, id patches, reload) flow into the
// reactive copy without echoing back.
import { reactive, watch, nextTick } from 'vue';

const clone = (v) => JSON.parse(JSON.stringify(v ?? {}));

export function useNodeData(props) {
  const local = reactive(clone(props.node.attrs.data));
  let syncing = false;

  watch(
    local,
    () => {
      if (!syncing) props.updateAttributes({ data: clone(local) });
    },
    { deep: true },
  );

  watch(
    () => props.node.attrs.data,
    (incoming) => {
      if (JSON.stringify(incoming ?? {}) === JSON.stringify(local)) return;
      syncing = true;
      for (const k of Object.keys(local)) delete local[k];
      Object.assign(local, clone(incoming));
      nextTick(() => {
        syncing = false;
      });
    },
  );

  return local;
}
