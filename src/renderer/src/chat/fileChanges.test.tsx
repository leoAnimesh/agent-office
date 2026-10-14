import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FileChanges, legacyFinishedText, splitPath } from './fileChanges';

describe('splitPath', () => {
  it('separates the file name from its folder', () => {
    expect(splitPath('Apps/OpenClean/Sources/Components.swift')).toEqual({ name: 'Components.swift', dir: 'Apps/OpenClean/Sources/' });
    expect(splitPath('AGENTS.md')).toEqual({ name: 'AGENTS.md', dir: '' });
    expect(splitPath('src\\win\\a.ts')).toEqual({ name: 'a.ts', dir: 'src\\win\\' });
  });
});

describe('legacyFinishedText', () => {
  const old = 'T-101 by Forge finished successfully. Summary: The PR is open.\n\n- **Checks:** passed Files: AGENTS.md (+1 −1), Apps/x/Components.swift (+0 −12). Read it with get_task, then request_merge or message_agent.';
  it('turns a saved old-style notice into the new markdown without the file list or boss instructions', () => {
    expect(legacyFinishedText(old)).toEqual({
      text: '**T-101 by Forge finished successfully.**\n\nThe PR is open.\n\n- **Checks:** passed',
      files: [{ path: 'AGENTS.md', add: 1, del: 1 }, { path: 'Apps/x/Components.swift', add: 0, del: 12 }],
    });
    expect(legacyFinishedText('T-7 by Pixel finished with problems. Summary:  Files: none. Read it with get_task, then request_merge or message_agent.')).toEqual({ text: '**T-7 by Pixel finished with problems.**', files: [] });
  });
  it('leaves other event text alone', () => {
    expect(legacyFinishedText('The user declined to merge T-3.')).toEqual({ text: 'The user declined to merge T-3.' });
  });
});

describe('FileChanges', () => {
  const files = [
    { path: 'AGENTS.md', add: 1, del: 1 },
    { path: 'Apps/OpenClean/Sources/OpenCleanApp/Resources/de.lproj/Localizable.strings', add: 0, del: 4 },
  ];
  it('summarises the totals and lists each file with its name, folder and counts', () => {
    const out = renderToStaticMarkup(<FileChanges files={files} />);
    expect(out).toContain('<summary');
    expect(out).toContain('2 files changed');
    expect(out).toMatch(/class="add">\+1</);
    expect(out).toMatch(/class="del">−5</);
    expect(out).toContain('<span class="fc-name">Localizable.strings</span>');
    expect(out).toContain('title="Apps/OpenClean/Sources/OpenCleanApp/Resources/de.lproj/Localizable.strings"');
    expect(out).toContain('Apps/OpenClean/Sources/OpenCleanApp/Resources/de.lproj/');
  });
  it('says one file in the singular and renders nothing for no files', () => {
    expect(renderToStaticMarkup(<FileChanges files={[files[0]]} />)).toContain('1 file changed');
    expect(renderToStaticMarkup(<FileChanges files={[]} />)).toBe('');
  });
});

describe('FileChanges open state', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ path: `src/f${i}.ts`, add: 1, del: 0 }));
  it('starts collapsed for long lists unless asked to start open', () => {
    expect(renderToStaticMarkup(<FileChanges files={many} />)).not.toContain('open=""');
    expect(renderToStaticMarkup(<FileChanges files={many} open />)).toContain('open=""');
  });
});
