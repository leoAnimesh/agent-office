import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from './Markdown';

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe('Markdown', () => {
  it('renders the usual formatting', () => {
    const out = html('**Plan**\n\n- one\n- two\n\n`npm test`\n\n```ts\nconst a = 1;\n```');
    expect(out).toContain('<strong>Plan</strong>');
    expect(out.match(/<li>/g)).toHaveLength(2);
    expect(out).toContain('<code>npm test</code>');
    expect(out).toContain('<pre><code class="language-ts">const a = 1;');
  });

  it('supports GitHub tables and task lists', () => {
    const out = html('| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done');
    expect(out).toContain('<table>');
    expect(out).toContain('type="checkbox"');
  });

  it('shows raw HTML as literal text instead of rendering it', () => {
    const out = html('Hello <b>team</b> <img src=x onerror=alert(1)>');
    expect(out).not.toContain('<b>');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;b&gt;team&lt;/b&gt;');
  });

  it('renders links that open externally', () => {
    const out = html('See [PR 3](https://github.com/leoAnimesh/agent-office/pull/3)');
    expect(out).toContain('href="https://github.com/leoAnimesh/agent-office/pull/3"');
    expect(out).toContain('PR 3');
  });
});
