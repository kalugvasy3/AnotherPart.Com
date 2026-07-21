/**
 * DUPLEX TRANSLATOR — a voice «messenger»: both people just talk, no side
 * buttons. Whisper transcribes whoever speaks (no forced language), the
 * direction is auto-detected from the text, Marian translates to the other
 * side. One conversation stream (newest at the bottom); the controls sit in
 * a bar pinned below it.
 *
 * Control cycle (Vasily, 2026-07-20): Start → Pause → Resume — pausing keeps
 * the whole conversation and context; 🗑 ends and clears for a fresh one.
 * Headphones recommended; while a translation is spoken the mic pauses.
 *
 * A TEMPLATE: the combination (Whisper base/small × Marian) is chosen by
 * `data-pair` on <body> and resolved via getDuplexEngine().
 */

import {
  OFFLINE_LANGS,
  SPEECH_LOCALES,
  countToolUse,
  fillLanguageSelect,
  getDuplexEngine,
  type DuplexHandlers,
  type PrepareProgress,
  type RecognizerActivity
} from './engines';

const LANG_COLORS: Record<string, string> = {
  en: '#72bbff',
  ru: '#7ee2a8',
  es: '#ffd36b',
  de: '#ff9d5c',
  fr: '#c9a0ff',
  it: '#8fe38f',
  tr: '#7fd0d0',
  uk: '#ffe08a'
};

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const langA = $<HTMLSelectElement>('langA');
const langB = $<HTMLSelectElement>('langB');
const engineStatus = $<HTMLDivElement>('engineStatus');
const stream = $<HTMLDivElement>('stream');
const startPause = $<HTMLButtonElement>('startPause');
const clearBtn = $<HTMLButtonElement>('clearBtn');
const autoSpeak = $<HTMLInputElement>('autoSpeak');

const pair = getDuplexEngine(document.body.dataset.pair ?? 'duplex-base');

fillLanguageSelect(langA, pair.defaults.a, OFFLINE_LANGS);
fillLanguageSelect(langB, pair.defaults.b, OFFLINE_LANGS);

function langColor(code: string): string {
  return LANG_COLORS[code] ?? '#94a7cc';
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ---- Empty-state hint (instead of an empty void) ------------------

const emptyHint = document.createElement('div');
emptyHint.className = 'ap-duplex-empty';
emptyHint.textContent =
  'press start, then both of you just talk — it detects the language and translates to the other side.';
stream.appendChild(emptyHint);

// Add/REMOVE from the DOM (not just hide): a hidden first child would still
// break the `> :first-child { margin-top:auto }` bottom-pin trick.
function showEmptyHint(show: boolean): void {
  if (show) {
    if (!emptyHint.parentElement) {
      stream.prepend(emptyHint);
    }
  } else {
    emptyHint.remove();
  }
}

// ---- One-time model download (same UX as the turn pages) ----------

let prepared = false;
let preparing: Promise<void> | null = null;

const dlBox = document.createElement('div');
dlBox.className = 'ap-dl-box';
dlBox.hidden = true;

const dlLink = document.createElement('button');
dlLink.type = 'button';
dlLink.className = 'ap-dl-link';
dlLink.textContent = `⬇ download on-device models (${pair.downloadHint}, one time)`;
dlLink.addEventListener('click', () => void startConversation());

const progressWrap = document.createElement('div');
progressWrap.className = 'ap-progress';
progressWrap.hidden = true;

const progressBar = document.createElement('div');
progressBar.className = 'ap-progress-bar';
progressWrap.appendChild(progressBar);

dlBox.append(dlLink, progressWrap);
engineStatus.insertAdjacentElement('afterend', dlBox);

function showProgress(progress: PrepareProgress): void {
  dlLink.hidden = true;
  progressWrap.hidden = false;
  engineStatus.className = 'ap-status-busy ap-duplex-status';
  engineStatus.textContent = progress.message;

  if (progress.fraction == null) {
    progressBar.classList.add('ap-progress-indeterminate');
    progressBar.style.width = '';
  } else {
    progressBar.classList.remove('ap-progress-indeterminate');
    progressBar.style.width = `${Math.round(progress.fraction * 100)}%`;
  }
}

async function ensurePrepared(): Promise<boolean> {
  if (prepared) {
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
    dlBox.hidden = true;
    return true;
  } catch (error) {
    progressWrap.hidden = true;
    dlLink.hidden = false;
    dlLink.textContent = '↻ retry download';
    engineStatus.className = 'ap-status-bad ap-duplex-status';
    engineStatus.textContent = `couldn't load ${pair.name}: ${
      error instanceof Error ? error.message : String(error)
    }`;
    return false;
  }
}

// ---- The conversation stream --------------------------------------

interface Segment {
  translation: string;
  to: string;
  btn: HTMLButtonElement | null;
}

let segmentCount = 0;
let pendingRow: HTMLDivElement | null = null;

function removePending(): void {
  pendingRow?.remove();
  pendingRow = null;
}

function setActivity(a: RecognizerActivity): void {
  if (a.state === 'idle') {
    removePending();
    return;
  }

  if (!pendingRow) {
    pendingRow = document.createElement('div');
    stream.appendChild(pendingRow);
  }

  const level = 'level' in a ? a.level : undefined;

  let label = 'listening…';
  let stateClass = 'ap-activity-listening';

  if (a.state === 'hearing') {
    label = 'recording…';
    stateClass = 'ap-activity-hearing';
  } else if (a.state === 'transcribing') {
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

const handlers: DuplexHandlers = {
  onActivity: (a) => setActivity(a),
  onSegment: (original, from, to) => {
    showEmptyHint(false);
    removePending();

    const row = document.createElement('div');
    row.className = 'ap-seg';
    row.style.borderLeftColor = langColor(from);

    const badge = `<span class="ap-lang-badge" style="color:${langColor(
      from
    )};border-color:${langColor(from)}">${from.toUpperCase()}</span>`;

    row.innerHTML = `<div class="ap-seg-orig">${badge}${escapeHtml(
      original
    )}</div><div class="ap-seg-trans">translating…</div>`;
    stream.appendChild(row);
    row.scrollIntoView({ block: 'nearest' });

    segmentCount++;
    updateControls();
    countToolUse(pair.id);

    const segment: Segment = { translation: '', to, btn: null };

    return (translation: string) => {
      segment.translation = translation;
      const trans = row.querySelector('.ap-seg-trans');

      if (!trans) {
        return;
      }

      trans.innerHTML = `${escapeHtml(
        translation
      )} <button class="ap-arch-play" title="Play the translation">▶</button>`;

      const btn = trans.querySelector<HTMLButtonElement>('.ap-arch-play');
      segment.btn = btn;

      btn?.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleSpeak(segment.translation, segment.to, btn);
      });

      if (autoSpeak.checked && state === 'running') {
        speak(translation, to, btn);
      }
    };
  },
  onError: (message) => {
    engineStatus.className = 'ap-status-bad ap-duplex-status';
    engineStatus.textContent = message;
    setIdle();
  }
};

// ---- Playback (half-duplex, interruptible per phrase) -------------

let speakingUtterance: SpeechSynthesisUtterance | null = null;
let speakingBtn: HTMLButtonElement | null = null;

function markButton(btn: HTMLButtonElement | null, playing: boolean): void {
  if (btn) {
    btn.textContent = playing ? '⏹' : '▶';
    btn.title = playing ? 'Stop speaking' : 'Play the translation';
  }
}

function resumeMicIfListening(): void {
  if (state === 'running') {
    pair.setPaused(false);
  }
}

function stopSpeaking(): void {
  speakingUtterance = null;
  markButton(speakingBtn, false);
  speakingBtn = null;
  speechSynthesis.cancel();
  resumeMicIfListening();
}

function speak(text: string, to: string, btn: HTMLButtonElement | null): void {
  if (!text || text.startsWith('⚠')) {
    return;
  }

  markButton(speakingBtn, false);
  speakingBtn = btn;
  markButton(btn, true);

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = SPEECH_LOCALES[to] ?? to;

  const finish = (): void => {
    if (speakingUtterance !== utterance) {
      return;
    }
    speakingUtterance = null;
    markButton(btn, false);
    speakingBtn = null;
    resumeMicIfListening();
  };

  utterance.onend = finish;
  utterance.onerror = finish;

  speakingUtterance = utterance;
  pair.setPaused(true);
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

function toggleSpeak(
  text: string,
  to: string,
  btn: HTMLButtonElement | null
): void {
  if (btn && btn === speakingBtn) {
    stopSpeaking();
  } else {
    speak(text, to, btn);
  }
}

function silenceSpeech(): void {
  speakingUtterance = null;
  markButton(speakingBtn, false);
  speakingBtn = null;
  speechSynthesis.cancel();
}

// ---- State machine: idle · running · paused -----------------------

type State = 'idle' | 'running' | 'paused';
let state: State = 'idle';

function updateControls(): void {
  if (state === 'idle') {
    startPause.textContent = 'Start conversation';
    startPause.classList.remove('ap-duplex-live');
  } else if (state === 'running') {
    startPause.textContent = 'Pause';
    startPause.classList.add('ap-duplex-live');
  } else {
    startPause.textContent = 'Resume';
    startPause.classList.remove('ap-duplex-live');
  }

  clearBtn.hidden = state === 'idle' && segmentCount === 0;
}

async function startConversation(): Promise<void> {
  startPause.textContent = 'preparing…';

  const ok = await ensurePrepared();

  if (!ok) {
    updateControls();
    return;
  }

  state = 'running';
  engineStatus.className = 'ap-status-ready ap-duplex-status';
  engineStatus.textContent = `✓ ${pair.name} — listening, just talk`;
  updateControls();

  pair.start(() => [langA.value, langB.value], handlers);
}

function pauseConversation(): void {
  state = 'paused';
  silenceSpeech();
  pair.setPaused(true);
  engineStatus.className = 'ap-status-muted ap-duplex-status';
  engineStatus.textContent = `paused — conversation kept, press resume`;
  updateControls();
}

function resumeConversation(): void {
  state = 'running';
  pair.setPaused(false);
  engineStatus.className = 'ap-status-ready ap-duplex-status';
  engineStatus.textContent = `✓ ${pair.name} — listening, just talk`;
  updateControls();
}

/** Ends the session AND clears the stream for a fresh conversation. */
function clearConversation(): void {
  silenceSpeech();
  pair.stop();
  state = 'idle';
  segmentCount = 0;
  stream.innerHTML = '';
  pendingRow = null;
  showEmptyHint(true);
  engineStatus.className = 'ap-status-ready ap-duplex-status';
  engineStatus.textContent = `✓ ${pair.name} — press start, then just talk`;
  updateControls();
}

/** Stop listening without clearing (used on a fatal error). */
function setIdle(): void {
  silenceSpeech();
  pair.stop();
  state = 'idle';
  updateControls();
}

startPause.addEventListener('click', () => {
  if (state === 'idle') {
    void startConversation();
  } else if (state === 'running') {
    pauseConversation();
  } else {
    resumeConversation();
  }
});

clearBtn.addEventListener('click', clearConversation);

// ---- Gate ---------------------------------------------------------

async function initPair(): Promise<void> {
  const support = pair.check();

  if (!support.ok) {
    engineStatus.className = 'ap-status-bad ap-duplex-status';
    engineStatus.textContent =
      support.reason ?? 'this translator is unavailable here';
    startPause.disabled = true;
    return;
  }

  if (await pair.isReady()) {
    prepared = true;
    engineStatus.className = 'ap-status-ready ap-duplex-status';
    engineStatus.textContent = `✓ ${pair.name} — press start, then just talk`;
    return;
  }

  engineStatus.className = 'ap-status-muted ap-duplex-status';
  engineStatus.textContent = `${pair.name} — one-time setup:`;
  dlBox.hidden = false;
}

updateControls();
void initPair();
