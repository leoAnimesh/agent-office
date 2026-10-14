import { useEffect, useRef, useState } from 'react';
import { menuNav } from './menuNav';

export interface MenuItem { label: string; onSelect: () => void; danger?: boolean }

/** A ⋯ button that opens a small popover menu. Keyboard: arrows/Home/End move, Esc closes and returns focus. */
export function MenuButton({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    const outside = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);

  const close = (refocus: boolean) => { setOpen(false); if (refocus) trigger.current?.focus(); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(true); return; }
    if (e.key === 'Tab') { close(false); return; }
    const at = itemRefs.current.findIndex((el) => el === document.activeElement);
    const next = menuNav(e.key, Math.max(at, 0), items.length);
    if (next !== null) { e.preventDefault(); itemRefs.current[next]?.focus(); }
  };

  return (
    <div className="menu-wrap" ref={wrap}>
      <button ref={trigger} type="button" className="btn small icon-btn" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor"><rect x="2" y="7" width="2.5" height="2.5" /><rect x="6.75" y="7" width="2.5" height="2.5" /><rect x="11.5" y="7" width="2.5" height="2.5" /></svg>
      </button>
      {open && (
        <div className="menu-pop" role="menu" aria-label={label} onKeyDown={onKeyDown}>
          {items.map((it, i) => (
            <button key={it.label} ref={(el) => { itemRefs.current[i] = el; }} type="button" role="menuitem" tabIndex={-1} className={it.danger ? 'menu-item danger' : 'menu-item'} onClick={() => { close(true); it.onSelect(); }}>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
