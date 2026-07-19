/**
 * The shared navigation (Vasily, 2026-07-18): ONE neon button in the
 * corner — the name of the CURRENT place («AnotherPart» on home, the
 * category name inside one). Clicking it opens the menu; «AnotherPart»
 * is simply the first item of that menu — it IS home. No separate
 * «Home», no separate «menu».
 *
 * Usage: <nav class="ap-nav" data-active="translators"></nav>
 */

const ITEMS: Array<{
  id: string;
  label: string;
  href: string;
  soon?: boolean;
}> = [
  { id: 'home', label: 'AnotherPart', href: '/' },
  { id: 'translators', label: 'Translators', href: '/translate/' },
  { id: 'calls', label: 'Video Calls', href: '#', soon: true },
  { id: 'sky', label: 'Sky', href: '#', soon: true },
  { id: 'transcriber', label: 'Transcriber', href: '#', soon: true }
];

const nav = document.querySelector<HTMLElement>('.ap-nav');

if (nav) {
  const activeId = nav.dataset['active'] ?? 'home';
  const active = ITEMS.find((c) => c.id === activeId) ?? ITEMS[0];

  const menuWrap = document.createElement('div');

  menuWrap.className = 'ap-menu-wrap';

  // The corner button = the current place, neon, opens the menu.
  const trigger = document.createElement('button');

  trigger.type = 'button';
  trigger.className = 'ap-brand-neon';
  trigger.textContent = `${active.label} ▾`;
  menuWrap.appendChild(trigger);

  const menu = document.createElement('div');

  menu.className = 'ap-menu';
  menu.hidden = true;

  for (const item of ITEMS) {
    const link = document.createElement('a');

    link.className = 'ap-cat';

    if (item.id === activeId) {
      link.classList.add('ap-cat-active');
    }

    if (item.soon) {
      link.classList.add('ap-cat-soon');
      link.textContent = `${item.label} · soon`;
    } else {
      link.textContent = item.label;
      link.href = item.href;
    }

    menu.appendChild(link);
  }

  menuWrap.appendChild(menu);
  nav.appendChild(menuWrap);

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    menu.hidden = !menu.hidden;
  });

  // A click PAST the menu folds it shut — the .Me habit.
  document.addEventListener('click', () => {
    menu.hidden = true;
  });
}

// The neon mark at the top of the CENTER — every screen; click = home.
const main = document.querySelector<HTMLElement>('.ap-main');

if (main) {
  const mark = document.createElement('a');

  mark.className = 'ap-brand-neon ap-main-mark';
  mark.href = '/';
  mark.textContent = 'AnotherPart';
  main.prepend(mark);
}

export {};
