// Byte-for-byte parity test: the editor's patch.js MUST be identical to
// config-api/src/patch.js (the "apply" half). Any divergence silently corrupts
// concurrent saves (id addressing, op ordering, or value shape would no longer
// agree between the editor that produces the patch and the server that applies it).
//
// Currently expected to FAIL: isKeyedArray([]) diverges (editor returns true,
// config-api returns false). This test catches that and any future drift.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const EDITOR_PATCH = resolve('docs/.vitepress/theme/lib/patch.js');
const CONFIG_API_PATCH = resolve('../../../../config-api/src/patch.js');

function stripHeaderComment(code) {
  // Both files have a header comment block that describes the inter-repo
  // mirroring contract. The comment text may differ slightly (e.g. the
  // isKeyedArray explanation changed between versions), so we compare only
  // the executable code: everything from the first `export` onward.
  // Comments after that point are kept (they're part of the logic).
  const lines = code.split('\n');
  const firstExport = lines.findIndex((l) => l.startsWith('export'));
  if (firstExport === -1) return code;
  return lines.slice(firstExport).join('\n');
}

function lineDiff(a, b) {
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const max = Math.max(aLines.length, bLines.length);
  const diffs = [];
  for (let i = 0; i < max; i++) {
    if (aLines[i] !== bLines[i]) {
      diffs.push({
        line: i + 1,
        editor: aLines[i] ?? '<missing>',
        configApi: bLines[i] ?? '<missing>',
      });
    }
  }
  return diffs;
}

describe('patch.js byte-for-byte parity with config-api', () => {
  // Skip the whole suite if config-api is not present (e.g. shallow clone
  // without the sibling repo).
  const configApiExists = existsSync(CONFIG_API_PATCH);

  const maybe = configApiExists ? describe : describe.skip;

  maybe('when config-api is available', () => {
    const editorCode = readFileSync(EDITOR_PATCH, 'utf-8');
    const configApiCode = readFileSync(CONFIG_API_PATCH, 'utf-8');

    it('editor patch.js and config-api patch.js are byte-for-byte identical (minus header)', () => {
      const editorCodeStripped = stripHeaderComment(editorCode);
      const configApiCodeStripped = stripHeaderComment(configApiCode);

      if (editorCodeStripped !== configApiCodeStripped) {
        const diffs = lineDiff(editorCodeStripped, configApiCodeStripped);
        const preview = diffs
          .slice(0, 15)
          .map((d) => `  L${d.line}: editor="${d.editor.trim()}" | config-api="${d.configApi.trim()}"`)
          .join('\n');
        const shown = diffs.length > 15 ? `\n  ...and ${diffs.length - 15} more` : '';
        throw new Error(
          `patch.js diverges between editor and config-api (${diffs.length} differing lines):\n${preview}${shown}\n\n` +
            `Full files: ${EDITOR_PATCH} vs ${CONFIG_API_PATCH}`,
        );
      }

      expect(editorCodeStripped).toBe(configApiCodeStripped);
    });

    it('both files export the same function names', () => {
      const editorExports = editorCode.match(/(?:export\s+(?:function|const|async\s+function)\s+\w+)/g) || [];
      const configApiExports = configApiCode.match(/(?:export\s+(?:function|const|async\s+function)\s+\w+)/g) || [];
      expect(editorExports.sort()).toEqual(configApiExports.sort());
    });
  });
});
