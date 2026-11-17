// Share bounded, top-to-bottom entrance motion for pages, panels, and dialogs.
const entrances = new WeakMap();

// Cancel only entrance effects owned by this module, preserving ambient animations.
export function stopEntrance(element) {
  for (const animation of entrances.get(element) ?? []) animation.cancel();
  entrances.delete(element);
}

// Reveal visible content in reading order without delaying navigation or data updates.
export function animatePage(element) {
  if (!element) return;
  stopEntrance(element);
  if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  let candidates = Array.from(element.querySelectorAll?.('[data-reveal]') ?? []);
  candidates = candidates.filter(item => {
    const parent = item.parentElement?.closest('[data-reveal]');
    return !parent || parent === element || !element.contains(parent);
  });
  if (!candidates.length) candidates = Array.from(element.children ?? []).filter(item => item.tagName !== 'SUMMARY');
  const visible = candidates.map((item, index) => ({ item, index, rect: item.getBoundingClientRect?.() }))
    .filter(({ item, rect }) => rect?.height && rect.width && !item.hidden && rect.bottom > 0 && rect.top < (globalThis.innerHeight ?? Infinity))
    .sort((a, b) => Math.abs(a.rect.top - b.rect.top) < 4 ? a.index - b.index : a.rect.top - b.rect.top);
  const effects = new Set();
  const stagger = Math.min(65, 360 / Math.max(1, visible.length - 1));
  entrances.set(element, effects);
  for (const { item } of visible) {
    const animation = item.animate?.([
      { opacity: 0, transform: 'translateY(12px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], { duration: 340, delay: effects.size * stagger, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' });
    if (!animation) continue;
    effects.add(animation);
    animation.onfinish = animation.oncancel = () => {
      effects.delete(animation);
      if (!effects.size && entrances.get(element) === effects) entrances.delete(element);
    };
  }
}

// Report whether this panel or an owning page is still entering.
export function hasEntrance(element) {
  for (let current = element; current; current = current.parentElement) {
    if (entrances.get(current)?.size) return true;
  }
  return false;
}

// Open a native modal with staggered content while retaining native focus behavior.
export function openDialog(dialog) {
  if (dialog.open) return;
  dialog.showModal();
  animatePage(dialog);
}
