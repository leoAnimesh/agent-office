/** Which menu item a key moves focus to, or null when the key isn't a menu navigation key. */
export function menuNav(key: string, current: number, count: number): number | null {
  switch (key) {
    case 'ArrowDown': return (current + 1) % count;
    case 'ArrowUp': return (current - 1 + count) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
}
