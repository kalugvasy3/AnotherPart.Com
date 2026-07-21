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
  // Optional dropdown-only text (the corner brand keeps `label`). For
  // the globe the Earth symbol replaces the word «Globus» in the menu.
  menuLabel?: string;
}> = [
  { id: 'home', label: 'AnotherPart', href: '/' },
  { id: 'translators', label: 'Translators', href: '/translate/' },
  { id: 'transcriber', label: 'Transcriber', href: '/transcribe/' },
  { id: 'calls', label: 'VideoCall', href: '#', soon: true },
  {
    id: 'sky',
    label: 'Wiki on the Globus',
    href: '/sky/',
    menuLabel: 'Wiki on the 🌍'
  }
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
  // The corner brand is the NEON name (Vasily, 2026-07-20: «верни
  // неоновую надпись»); the Earth symbol lives in the dropdown item.
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

    const shown = item.menuLabel ?? item.label;

    if (item.soon) {
      link.classList.add('ap-cat-soon');
      link.textContent = `${shown} · soon`;
    } else {
      link.textContent = shown;
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

// The centre no longer gets its own «AnotherPart» mark (Vasily, 2026-07-20:
// «и отсюда тоже») — on every page it only duplicated the left menu, whose
// first item «AnotherPart» already leads home. One brand mark, top-left.

export {};
