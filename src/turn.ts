/**
 * TURN TRANSLATOR — two buttons, one-way at a time (Vasily, 2026-07-18).
 * The phone lies on the table between two people; EACH side owns a button:
 *
 *  - tap YOUR button → it lights amber, your side is being heard;
 *  - tap it again → stop; or the OTHER taps theirs → your button
 *    goes idle where it was, theirs lights up (the turn is taken);
 *  - always one-way in the moment.
 *
 * LIVE zone (above the buttons): the current turn, segment by
 * segment — original / translation pairs. Pauses split segments;
 * no double tapping. Tap any chunk to hear THAT chunk's translation.
 * On stop the turn empties into the ARCHIVE below (lang colour +
 * abbr, original, translation, ▶ per segment).
 *
 * Speech is NOT spoken in the live zone (visual contact is usually
 * enough); a checkbox turns on auto-speak, otherwise ▶ on demand.
 * The mic is only blocked during a ▶ playback.
 *
 * This is a TEMPLATE: the engine pair is chosen by `data-pair` on the
 * page <body> and resolved through engines.ts (getTurnPair). The online
 * page (Web Speech × Chrome) and the offline page (Whisper × Marian)
 * are the SAME code, different pair.
 */

import {
  SPEECH_LOCALES,
  countToolUse,
  fillLanguageSelect,
  getTurnPair,
  type PrepareProgress,
  type RecognizerActivity,
  type RecognizerHandlers
} from './engines';

// A colour per language for the badges (extend freely).
const LANG_COLORS: Record<string, string> = {
  en: '#72bbff',
  ru: '#7ee2a8',
  es: '#ffd36b',
  de: '#ff9d5c',
  fr: '#c9a0ff',
  it: '#8fe38f',
  pt: '#ffa0c0',
  tr: '#7fd0d0',
  uk: '#ffe08a',
  pl: '#b0c0ff',
  nl: '#ffb060',
  ja: '#ff8a8a',
  ko: '#a0e0ff',
  zh: '#ffcf7a'
};

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const langA = $<HTMLSelectElement>('langA');
const langB = $<HTMLSelectElement>('langB');
const engineStatus = $<HTMLDivElement>('engineStatus');
const live = $<HTMLDivElement>('live');
const btnA = $<HTMLDivElement>('btnA');
const btnB = $<HTMLDivElement>('btnB');
const autoSpeak = $<HTMLInputElement>('autoSpeak');
const archive = $<HTMLDivElement>('archive');

const labelA = btnA.querySelector<HTMLSpanElement>('.ap-turn-side-label')!;
const labelB = btnB.querySelector<HTMLSpanElement>('.ap-turn-side-label')!;

// The predefined pair for THIS page (online is the default template).
const pair = getTurnPair(document.body.dataset.pair);

fillLanguageSelect(langA, pair.defaults.a, pair.langs);
fillLanguageSelect(langB, pair.defaults.b, pair.langs);

function langColor(code: string): string {
  return LANG_COLORS[code] ?? '#94a7cc';
}

// ---- Honest gate + one-time model download ------------------------

let ready = false;
let prepared = false;
let preparing: Promise<void> | null = null;

// A pair that must fetch models (offline) gets an explicit download control
// and a progress bar — built ONLY for such a pair. The online pair never
// shows any of this.
let dlBox: HTMLDivElement | null = null;
let dlLink: HTMLButtonElement | null = null;
let progressWrap: HTMLDivElement | null = null;
let progressBar: HTMLDivElement | null = null;

if (pair.prepare) {
  dlBox = document.createElement('div');
  dlBox.className = 'ap-dl-box';

  dlLink = document.createElement('button');
  dlLink.type = 'button';
  dlLink.className = 'ap-dl-link';
  dlLink.textContent = `⬇ download on-device models (${
    pair.downloadHint ?? 'one time'
  }, one time)`;
  dlLink.addEventListener('click', () => void ensurePrepared());

  progressWrap = document.createElement('div');
  progressWrap.className = 'ap-progress';
  progressWrap.hidden = true;

  progressBar = document.createElement('div');
  progressBar.className = 'ap-progress-bar';
  progressWrap.appendChild(progressBar);

  dlBox.appendChild(dlLink);
  dlBox.appendChild(progressWrap);
  dlBox.hidden = true;
  engineStatus.insertAdjacentElement('afterend', dlBox);
}

// ---- The live «pending» row (indicator INSIDE the live zone) ------
// The status lives in the live zone, pinned to the bottom (nearest the
// buttons), NOT as a separate bar (Vasily, 2026-07-20). One pending row
// walks the phases IN PLACE — listening (+mic level) → recording / streaming
// interim → transcribing — then it BECOMES the finished segment, and a fresh
// pending row opens below it for the next utterance.

let pendingRow: HTMLDivElement | null = null;
let pendingText = ''; // streaming interim text (online engines)
let pendingActivity: RecognizerActivity | null = null;

function removePending(): void {
  pendingRow?.remove();
  pendingRow = null;
  pendingText = '';
  pendingActivity = null;
}

function renderPending(): void {
  if (!active) {
    return;
  }

  if (!pendingRow) {
    pendingRow = document.createElement('div');
    live.appendChild(pendingRow);
  }

  // Online recognition streams text as you speak — show it growing.
  if (pendingText) {
    pendingRow.className = 'ap-seg ap-seg-pending ap-seg-interim';
    pendingRow.textContent = pendingText;
    pendingRow.scrollIntoView({ block: 'nearest' });
    return;
  }

  const state = pendingActivity?.state ?? 'listening';
  const level =
    pendingActivity && 'level' in pendingActivity
      ? pendingActivity.level
      : undefined;

  let label = 'listening…';
  let stateClass = 'ap-activity-listening';

  if (state === 'hearing') {
    label = 'recording…';
    stateClass = 'ap-activity-hearing';
  } else if (state === 'transcribing') {
    label = 'transcribing…';
    stateClass = 'ap-activity-working';
  }

  const hasLevel = typeof level === 'number';
  const meterClass = hasLevel
    ? 'ap-activity-meter'
    : 'ap-activity-meter ap-activity-meter-indet';
  const fillStyle = hasLevel
    ? `width:${Math.round(Math.min(1, level ?? 0) * 100)}%`
    : '';

  pendingRow.className = `ap-seg ap-seg-pending ap-seg-status ${stateClass}`;
  pendingRow.innerHTML =
    `<span class="ap-activity-text">${label}</span>` +
    `<span class="${meterClass}"><span class="ap-activity-fill" style="${fillStyle}"></span></span>`;
  pendingRow.scrollIntoView({ block: 'nearest' });
}

function setActivity(a: RecognizerActivity): void {
  if (a.state === 'idle') {
    removePending();
    return;
  }

  pendingActivity = a;
  renderPending();
}

function setReady(): void {
  ready = true;
  engineStatus.className = 'ap-status-ready';
  engineStatus.textContent = `✓ ${pair.name} — tap your button and speak`;

  if (dlBox) {
    dlBox.hidden = true;
  }
}

function showProgress(progress: PrepareProgress): void {
  if (dlLink) {
    dlLink.hidden = true;
  }

  if (progressWrap) {
    progressWrap.hidden = false;
  }

  engineStatus.className = 'ap-status-busy';
  engineStatus.textContent = progress.message;

  if (progressBar) {
    if (progress.fraction == null) {
      progressBar.classList.add('ap-progress-indeterminate');
      progressBar.style.width = '';
    } else {
      progressBar.classList.remove('ap-progress-indeterminate');
      progressBar.style.width = `${Math.round(progress.fraction * 100)}%`;
    }
  }
}

// The gate checks support and, for an offline pair, whether the models are
// ALREADY on the device. Heavy work (downloading + compiling ~120 MB of
// Whisper/Marian WASM) is never done on page-open — it froze a Mac once
// (2026-07-20). If the models are missing, we offer an explicit download; if
// they are present, the download sentence never appears at all.
async function initPair(): Promise<void> {
  const support = pair.check();

  if (!support.ok) {
    engineStatus.className = 'ap-status-bad';
    engineStatus.textContent =
      support.reason ?? 'this translator is unavailable here';
    btnA.classList.add('ap-turn-side-off');
    btnB.classList.add('ap-turn-side-off');
    return;
  }

  if (pair.prepare) {
    const cached = pair.isReady ? await pair.isReady() : false;

    if (cached) {
      prepared = true;
      setReady(); // everything's here — say nothing about downloads
      return;
    }

    // Missing: buttons still work (a tap also downloads), but offer the
    // explicit control up front.
    ready = true;
    engineStatus.className = 'ap-status-muted';
    engineStatus.textContent = `${pair.name} — one-time setup:`;

    if (dlBox) {
      dlBox.hidden = false;
    }

    return;
  }

  setReady();
}

/** Lazy, once. Downloads/compiles the offline models. Drives the progress
 *  bar; returns false if it failed (status/retry already shown). */
async function ensurePrepared(): Promise<boolean> {
  if (!pair.prepare || prepared) {
    return true;
  }

  preparing ??= pair
    .prepare(showProgress, langA.value, langB.value)
    .then(() => {
      prepared = true;
    })
    .finally(() => {
      preparing = null;
    });

  try {
    await preparing;
    setReady();
    return true;
  } catch (error) {
    if (progressWrap) {
      progressWrap.hidden = true;
    }

    if (dlLink) {
      dlLink.hidden = false;
      dlLink.textContent = '↻ retry download';
    }

    engineStatus.className = 'ap-status-bad';
    engineStatus.textContent = `couldn't load ${pair.name}: ${
      error instanceof Error ? error.message : String(error)
    }`;

    return false;
  }
}

// ---- The turn machine ---------------------------------------------

type Side = 'a' | 'b' | null;

let active: Side = null;

function sourceLang(side: 'a' | 'b'): string {
  return side === 'a' ? langA.value : langB.value;
}

function targetLang(side: 'a' | 'b'): string {
  return side === 'a' ? langB.value : langA.value;
}

function refreshButtons(): void {
  for (const [side, button, label] of [
    ['a', btnA, labelA],
    ['b', btnB, labelB]
  ] as const) {
    if (active === side) {
      label.textContent = 'Speaking';
      button.classList.add('ap-turn-side-live');
    } else {
      label.textContent = 'Speak';
      button.classList.remove('ap-turn-side-live');
    }
  }
}

function handlersFor(side: 'a' | 'b'): RecognizerHandlers {
  return {
    onInterim: (text) => showInterim(text),
    onFinal: (text) => {
      if (text) {
        void addSegment(text, side);
      }
    },
    onError: (message) => {
      engineStatus.className = 'ap-status-bad';
      engineStatus.textContent = message;
      stopTurn();
    },
    onActivity: (a) => setActivity(a)
  };
}

// A live segment on screen: { original, translation } pair.
interface Segment {
  original: string;
  translation: string;
  from: string;
  to: string;
  row: HTMLDivElement;
}

let liveSegments: Segment[] = [];

async function startTurn(side: 'a' | 'b'): Promise<void> {
  if (!ready) {
    return;
  }

  // Cleanly end any previous listening (e.g. the OTHER side taking the turn)
  // so a late result from it can't leak into this turn.
  pair.recognizer.stop();

  active = side;
  // BUGFIX (2026-07-20): seal the previous turn into the archive FIRST,
  // then clear the live zone — never the reverse. Clearing before sealing
  // would drop the tail into the wrong place.
  flushLiveToArchive();
  clearLive();
  refreshButtons(); // amber immediately, even while models load

  // First tap on an offline page may download/compile models here.
  const ok = await ensurePrepared();

  // The user may have tapped stop (or the other side) while we loaded.
  if (!ok || active !== side) {
    if (!ok && active === side) {
      active = null;
      refreshButtons();
    }
    return;
  }

  pair.recognizer.start(sourceLang(side), handlersFor(side));
}

function stopTurn(): void {
  active = null;
  pair.recognizer.stop();
  flushLiveToArchive();
  refreshButtons();
}

// ---- Live zone (pairs, tappable chunks) ---------------------------

function clearLive(): void {
  live.innerHTML = '';
  pendingRow = null;
  pendingText = '';
  pendingActivity = null;
}

function showInterim(text: string): void {
  pendingText = text;
  renderPending();
}

async function addSegment(text: string, side: 'a' | 'b'): Promise<void> {
  const from = sourceLang(side);
  const to = targetLang(side);

  // The pending row (the live indicator) BECOMES this finished segment, in
  // place; then a fresh pending row opens below for the next utterance.
  const row = pendingRow ?? document.createElement('div');

  if (!row.parentElement) {
    live.appendChild(row);
  }

  pendingRow = null;
  pendingText = '';
  pendingActivity = null;

  row.className = 'ap-seg';
  row.style.borderLeftColor = langColor(from);
  row.innerHTML = `<div class="ap-seg-orig">${escapeHtml(text)}</div>
    <div class="ap-seg-trans">translating…</div>`;
  row.scrollIntoView({ block: 'nearest' });

  countToolUse(pair.id);

  const segment: Segment = { original: text, translation: '', from, to, row };

  liveSegments.push(segment);

  try {
    const translated = await pair.translator.translate(text, from, to);

    segment.translation = translated;

    const trans = row.querySelector('.ap-seg-trans');

    if (trans) {
      trans.textContent = translated;
    }

    // Tap the chunk → hear THIS chunk's translation.
    row.addEventListener('click', () => playText(segment.translation, to));

    if (autoSpeak.checked) {
      playText(translated, to);
    }
  } catch (error) {
    console.error('[turn] translate failed:', error);

    const trans = row.querySelector('.ap-seg-trans');

    if (trans) {
      trans.textContent = '⚠ translation failed';
    }
  }
}

// ---- Archive ------------------------------------------------------

function flushLiveToArchive(): void {
  if (liveSegments.length === 0) {
    return;
  }

  const block = document.createElement('div');

  block.className = 'ap-arch-block';

  for (const segment of liveSegments) {
    const row = document.createElement('div');

    row.className = 'ap-arch-row';
    row.style.borderLeftColor = langColor(segment.from);

    const badge = `<span class="ap-lang-badge"
      style="color:${langColor(segment.from)};border-color:${langColor(
        segment.from
      )}">${segment.from.toUpperCase()}</span>`;

    row.innerHTML = `<div class="ap-arch-orig">${badge}${escapeHtml(
      segment.original
    )}</div><div class="ap-arch-trans">${escapeHtml(
      segment.translation
    )} <button class="ap-arch-play" title="Play the translation">▶</button></div>`;

    const play = row.querySelector<HTMLButtonElement>('.ap-arch-play');

    play?.addEventListener('click', () =>
      playText(segment.translation, segment.to)
    );

    block.appendChild(row);
  }

  archive.prepend(block);
  liveSegments = [];
  clearLive();
}

// ---- Playback (blocks the mic only while speaking) ----------------

function playText(text: string, to: string): void {
  if (!text) {
    return;
  }

  pair.recognizer.setPaused(true); // half-duplex: don't hear our own TTS

  const utterance = new SpeechSynthesisUtterance(text);

  utterance.lang = SPEECH_LOCALES[to] ?? to;
  utterance.onend = () => {
    // If a button is still lit, resume listening for that side.
    if (active) {
      pair.recognizer.setPaused(false);
    }
  };

  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

// ---- Wiring -------------------------------------------------------

function escapeHtml(text: string): string {
  const div = document.createElement('div');

  div.textContent = text;

  return div.innerHTML;
}

btnA.addEventListener('click', () => {
  if (active === 'a') {
    stopTurn();
  } else {
    void startTurn('a');
  }
});

btnB.addEventListener('click', () => {
  if (active === 'b') {
    stopTurn();
  } else {
    void startTurn('b');
  }
});

for (const select of [langA, langB]) {
  // The in-button ▾ must NOT toggle the turn.
  select.addEventListener('click', (event) => event.stopPropagation());
  select.addEventListener('pointerdown', (event) => event.stopPropagation());

  select.addEventListener('change', () => {
    if (active) {
      pair.recognizer.stop();
      pair.recognizer.start(sourceLang(active), handlersFor(active));
    }

    refreshButtons();
  });
}

refreshButtons();
void initPair();
