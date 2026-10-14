import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MdNode { type: string; value?: string; children?: MdNode[] }

/** Raw HTML in model output is shown as literal text, never rendered. */
function remarkHtmlAsText() {
  const walk = (node: MdNode): void => {
    if (node.type === 'html') node.type = 'text';
    node.children?.forEach(walk);
  };
  return (tree: MdNode) => walk(tree);
}

function Link({ href, children }: { href?: string; children?: ReactNode }) {
  return (
    <a
      href={href}
      title={href}
      onClick={(e) => {
        e.preventDefault();
        if (href) window.agentOffice.openExternal(href).catch(() => undefined);
      }}
    >
      {children}
    </a>
  );
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkHtmlAsText]} components={{ a: Link }}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
