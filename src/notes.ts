/**
 * LISTENING NOTES — a transcriber for understanding speech by ear (Vasily,
 * 2026-07-20). You read fine but sometimes can't catch it spoken: it LISTENS,
 * takes NOTES (transcript, no auto-translation), lets you replay each phrase
 * (robot voice by default; the real recording if «original audio» is on), and
 * gives dictionary help ON DEMAND — click a word for its meaning in context.
 *
 * Two languages: «Listening» (what's spoken) and «Dictionary» (the help
 * language). Same on both = a plain transcript, no dictionary. Interface EN.
 */

import {
  OFFLINE_LANGS,
  SPEECH_LOCALES,
  countToolUse,
  fillLanguageSelect,
  getStreamingSource,
  getTranscribeEngine,
  type PrepareProgress,
  type RecognizerActivity,
  type RecognizerHandlers,
  type TranscribeHandlers
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

const listeningSel = $<HTMLSelectElement>('listening');
const dictionarySel = $<HTMLSelectElement>('dictionary');
const engineStatus = $<HTMLDivElement>('engineStatus');
const stream = $<HTMLDivElement>('stream');
const startPause = $<HTMLButtonElement>('startPause');
const clearBtn = $<HTMLButtonElement>('clearBtn');
const saveBtn = $<HTMLButtonElement>('saveBtn');
// Whisper-only options — absent on the streaming page (guarded everywhere).
const keepAudio = document.getElementById('keepAudio') as HTMLInputElement | null;
const highAccuracy = document.getElementById(
  'highAccuracy'
) as HTMLInputElement | null;
const swapBtn = $<HTMLButtonElement>('swap');

swapBtn.addEventListener('click', () => {
  const a = listeningSel.value;
  listeningSel.value = dictionarySel.value;
  dictionarySel.value = a;
});

const engine = getTranscribeEngine();
const source = getStreamingSource();

// The mode is fixed by the PAGE (no user-facing toggle — people don't think
// in checkboxes, Vasily 2026-07-20): the Whisper «Listening notes» page and
// the streaming «Live captions» page (data-mode="streaming") share this one
// script. Whisper = offline, auto-detect, block-based; streaming = live text
// via Chrome's Web Speech, else offline Vosk.
type Mode = 'whisper' | 'streaming';
const mode: Mode =
  document.body.dataset.mode === 'streaming' ? 'streaming' : 'whisper';

const activeName = (): string =>
  mode === 'whisper' ? engine.name : `streaming · ${source.name}`;
const activeCheck = (): { ok: boolean; reason?: string } =>
  mode === 'whisper' ? engine.check() : source.check();
const activeIsReady = (): Promise<boolean> =>
  mode === 'whisper' ? engine.isReady() : source.isReady();
const activeNeedsSetup = (): boolean =>
  mode === 'whisper' ? true : source.needsDownload;
const activeDownloadHint = (): string =>
  mode === 'whisper' ? engine.downloadHint : source.downloadHint ?? '';
const activePrepare = (
  onProgress: (p: PrepareProgress) => void
): Promise<void> =>
  mode === 'whisper'
    ? engine.prepare(onProgress, listeningSel.value)
    : source.prepare(onProgress, listeningSel.value);
const activeSetPaused = (paused: boolean): void =>
  mode === 'whisper' ? engine.setPaused(paused) : source.setPaused(paused);
const activeStop = (): void =>
  mode === 'whisper' ? engine.stop() : source.stop();

fillLanguageSelect(listeningSel, engine.defaults.listening, OFFLINE_LANGS);
fillLanguageSelect(dictionarySel, engine.defaults.dictionary, OFFLINE_LANGS);

function listeningColor(): string {
  return LANG_COLORS[listeningSel.value] ?? '#94a7cc';
}

/** The language of a note, detected from its text (Whisper isn't forced).
 *  Cyrillic → Russian; otherwise the «Listening» pick (a Latin hint). */
function noteLangOf(text: string): string {
  if (/[Ѐ-ӿ]/.test(text)) {
    return 'ru';
  }
  return listeningSel.value === 'ru' ? 'en' : listeningSel.value;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ---- Empty-state hint ---------------------------------------------

const emptyHint = document.createElement('div');
emptyHint.className = 'ap-duplex-empty';
emptyHint.textContent =
  'press start, then it writes down what it hears. tap ▶ to replay a line; tap a word for a dictionary hint.';
stream.appendChild(emptyHint);

function showEmptyHint(show: boolean): void {
  if (show) {
    if (!emptyHint.parentElement) {
      stream.prepend(emptyHint);
    }
  } else {
    emptyHint.remove();
  }
}

// ---- One-time model download --------------------------------------

let prepared = false;
let preparing: Promise<void> | null = null;

const dlBox = document.createElement('div');
dlBox.className = 'ap-dl-box';
dlBox.hidden = true;

const dlLink = document.createElement('button');
dlLink.type = 'button';
dlLink.className = 'ap-dl-link';
dlLink.addEventListener('click', () => void startNotes());

function refreshDlLabel(): void {
  dlLink.textContent = `⬇ download the speech model (${activeDownloadHint()}, one time)`;
}

refreshDlLabel();

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

  if (!activeNeedsSetup()) {
    prepared = true;
    dlBox.hidden = true;
    return true;
  }

  preparing ??= activePrepare(showProgress)
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
    engineStatus.textContent = `couldn't load the model: ${
      error instanceof Error ? error.message : String(error)
    }`;
    return false;
  }
}

// ---- Playback: robot TTS or the original recording, mic paused ----

let audioCtx: AudioContext | null = null;

function pauseWhile(play: (done: () => void) => void): void {
  activeSetPaused(true);
  const resume = (): void => {
    if (state === 'running') {
      activeSetPaused(false);
    }
  };
  play(resume);
}

function speak(text: string, lang: string): void {
  speechSynthesis.cancel();
  pauseWhile((done) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = SPEECH_LOCALES[lang] ?? lang;
    u.onend = done;
    u.onerror = done;
    speechSynthesis.speak(u);
  });
}

function playOriginal(audio: Float32Array): void {
  pauseWhile((done) => {
    try {
      audioCtx ??= new AudioContext();
      const buffer = audioCtx.createBuffer(1, audio.length, 16000);
      // Fresh copy: guarantees an ArrayBuffer-backed Float32Array for
      // copyToChannel's type, and detaches from the (transferred) source.
      buffer.copyToChannel(new Float32Array(audio), 0);
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(audioCtx.destination);
      source.onended = done;
      source.start();
    } catch {
      done();
    }
  });
}

// ---- Pronunciation (IPA) via phonemize, lazily + safely -----------
// English is mature (~95%); Russian output isn't usable and the other
// languages aren't supported — so the IPA line is English-only for now.
// Loaded with a dynamic import in try/catch: a failure must NEVER break the
// page (a static import that threw wiped the whole tool — 2026-07-20).

const PHONEME_LANGS = new Set(['en']);

type ToIpa = (text: string, lang?: string) => string;
let toIpaFn: ToIpa | null = null;
let phonemesLoading: Promise<void> | null = null;

async function ensurePhonemes(): Promise<ToIpa | null> {
  if (toIpaFn) {
    return toIpaFn;
  }

  phonemesLoading ??= import('phonemize')
    .then((mod) => {
      toIpaFn = (text, lang) => mod.toIPA(text, lang);
    })
    .catch((error: unknown) => {
      console.error('[notes] phonemize load failed:', error);
    });

  await phonemesLoading;
  return toIpaFn;
}

// ---- Word popup: pronunciation + on-demand translation ------------

let popup: HTMLDivElement | null = null;

function hidePopup(): void {
  popup?.remove();
  popup = null;
}

document.addEventListener(
  'click',
  (event) => {
    if (popup && event.target instanceof Node && !popup.contains(event.target)) {
      hidePopup();
    }
  },
  true
);

async function lookupWord(
  words: string[],
  index: number,
  x: number,
  y: number,
  from: string
): Promise<void> {
  const to = dictionarySel.value;

  const word = (words[index] ?? '').replace(/[^\p{L}\p{N}'-]/gu, '').trim();

  if (!word) {
    return;
  }

  const wantIpa = PHONEME_LANGS.has(from);
  const wantTranslation = from !== to;

  if (!wantIpa && !wantTranslation) {
    return; // nothing to show for this language pair
  }

  hidePopup();
  popup = document.createElement('div');
  popup.className = 'ap-word-pop';
  popup.innerHTML =
    `<div class="ap-word-pop-src">${escapeHtml(word)}</div>` +
    (wantIpa ? `<div class="ap-word-pop-ipa">…</div>` : '') +
    (wantTranslation ? `<div class="ap-word-pop-tr">…</div>` : '');
  document.body.appendChild(popup);
  placePopup(x, y);

  // Pronunciation of the single word (English).
  if (wantIpa) {
    const toIPA = await ensurePhonemes();
    const ipaEl = popup?.querySelector('.ap-word-pop-ipa');
    if (ipaEl) {
      let ipa = '';
      if (toIPA) {
        try {
          ipa = toIPA(word, 'en').trim();
        } catch {
          ipa = '';
        }
      }
      ipaEl.textContent = ipa ? `[${ipa}]` : '—';
    }
    placePopup(x, y);
  }

  // Translation of a small window (word + next) so a preposition/particle —
  // «go ahead», «look at» — comes along.
  if (wantTranslation) {
    const phrase = words
      .slice(index, index + 2)
      .join(' ')
      .replace(/[^\p{L}\p{N}\s'-]/gu, '')
      .trim();
    const trEl = popup?.querySelector('.ap-word-pop-tr');

    try {
      const translated = await engine.translate(from, to, phrase || word);
      if (trEl) {
        trEl.textContent = translated || '—';
      }
      placePopup(x, y);
    } catch {
      if (trEl) {
        trEl.textContent = '⚠ dictionary unavailable';
      }
    }
  }
}

function placePopup(x: number, y: number): void {
  if (!popup) {
    return;
  }
  const rect = popup.getBoundingClientRect();
  let px = x;
  let py = y + 14;
  if (px + rect.width > window.innerWidth - 8) {
    px = window.innerWidth - rect.width - 8;
  }
  if (py + rect.height > window.innerHeight - 8) {
    py = y - rect.height - 12;
  }
  popup.style.left = `${Math.max(8, px)}px`;
  popup.style.top = `${Math.max(8, py)}px`;
}

// ---- The transcript stream ----------------------------------------

let segmentCount = 0;
let pendingRow: HTMLDivElement | null = null;

interface Note {
  text: string;
}

const notes: Note[] = [];

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
    label = 'writing…';
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

/** A captured utterance shows a «recognizing…» placeholder immediately (so
 *  the queue is visible); it's filled with the transcript when ready, or
 *  removed if nothing was recognized. */
function createPending(
  audioForReplay: Float32Array | null
): (text: string) => void {
  showEmptyHint(false);

  const row = document.createElement('div');
  row.className = 'ap-seg ap-note ap-note-recognizing';
  row.style.borderLeftColor = listeningColor();
  row.innerHTML = `<span class="ap-note-wait">recognizing…</span>`;

  // Keep the live «listening…» indicator pinned at the very bottom.
  if (pendingRow && pendingRow.parentElement === stream) {
    stream.insertBefore(row, pendingRow);
  } else {
    stream.appendChild(row);
  }
  row.scrollIntoView({ block: 'nearest' });

  return (text: string) => {
    if (!text) {
      row.remove(); // nothing recognized — drop the placeholder
      return;
    }
    fillNote(row, text, audioForReplay);
  };
}

function fillNote(
  row: HTMLDivElement,
  text: string,
  audio: Float32Array | null
): void {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const noteLang = noteLangOf(text);
  // Clickable if there's translation help (note language ≠ dictionary) OR
  // pronunciation help (a phonemize-supported language).
  const canLookup =
    noteLang !== dictionarySel.value || PHONEME_LANGS.has(noteLang);

  const wordHtml = words
    .map((word, i) =>
      canLookup
        ? `<span class="ap-word" data-i="${i}">${escapeHtml(word)}</span>`
        : escapeHtml(word)
    )
    .join(' ');

  row.className = 'ap-seg ap-note';
  row.style.borderLeftColor = LANG_COLORS[noteLang] ?? '#94a7cc';
  // Single line (no translation row here) — the ▶ / 🔊 ride at the END of the
  // sentence, inline, to save vertical space (Vasily, 2026-07-20).
  row.innerHTML =
    `<div class="ap-seg-orig ap-note-text">${wordHtml} ` +
    `<button class="ap-arch-play" title="Replay (robot voice)">▶</button>` +
    (audio
      ? ` <button class="ap-note-orig" title="Original audio">🔊</button>`
      : '') +
    `</div>`;

  notes.push({ text });
  segmentCount++;
  updateControls();
  countToolUse(engine.id);

  row
    .querySelector<HTMLButtonElement>('.ap-arch-play')
    ?.addEventListener('click', () => speak(text, noteLang));

  if (audio) {
    row
      .querySelector<HTMLButtonElement>('.ap-note-orig')
      ?.addEventListener('click', () => playOriginal(audio));
  }

  if (canLookup) {
    row.querySelectorAll<HTMLSpanElement>('.ap-word').forEach((span) => {
      span.addEventListener('click', (event) => {
        event.stopPropagation();
        const i = Number(span.dataset['i'] ?? '0');
        void lookupWord(words, i, event.clientX, event.clientY, noteLang);
      });
    });
  }

  row.scrollIntoView({ block: 'nearest' });
}

const handlers: TranscribeHandlers = {
  onActivity: (a) => setActivity(a),
  onCapture: (audio) =>
    createPending(keepAudio?.checked ? audio : null),
  onError: (message) => {
    engineStatus.className = 'ap-status-bad ap-duplex-status';
    engineStatus.textContent = message;
    setIdle();
  }
};

// ---- Streaming rendering: live interim text → finalized note ------

let streamRow: HTMLDivElement | null = null;

function showStreamInterim(text: string): void {
  if (!text) {
    streamRow?.remove();
    streamRow = null;
    return;
  }
  showEmptyHint(false);
  if (!streamRow) {
    streamRow = document.createElement('div');
    streamRow.className = 'ap-seg ap-note ap-seg-interim';
    stream.appendChild(streamRow);
  }
  streamRow.textContent = text;
  streamRow.scrollIntoView({ block: 'nearest' });
}

function finalizeStreamNote(text: string): void {
  const row = document.createElement('div');
  stream.appendChild(row);
  fillNote(row, text, null);
}

const streamHandlers: RecognizerHandlers = {
  onInterim: (text) => showStreamInterim(text),
  onFinal: (text) => {
    showStreamInterim('');
    if (text) {
      finalizeStreamNote(text);
    }
  },
  onError: (message) => {
    engineStatus.className = 'ap-status-bad ap-duplex-status';
    engineStatus.textContent = message;
    setIdle();
  },
  onActivity: () => {
    // Streaming shows liveness through the interim text — no pending row.
  }
};

function activeStart(): void {
  if (mode === 'whisper') {
    engine.start(handlers);
  } else {
    source.start(listeningSel.value, streamHandlers);
  }
}

// ---- State machine: idle · running · paused -----------------------

type State = 'idle' | 'running' | 'paused';
let state: State = 'idle';

function updateControls(): void {
  if (state === 'idle') {
    startPause.textContent = 'Start';
    startPause.classList.remove('ap-duplex-live');
  } else if (state === 'running') {
    startPause.textContent = 'Pause';
    startPause.classList.add('ap-duplex-live');
  } else {
    startPause.textContent = 'Resume';
    startPause.classList.remove('ap-duplex-live');
  }

  const hasContent = segmentCount > 0;
  clearBtn.hidden = state === 'idle' && !hasContent;
  saveBtn.hidden = !hasContent;
  // The model can only be switched between sessions.
  if (highAccuracy) {
    highAccuracy.disabled = state !== 'idle';
  }
  if (keepAudio) {
    keepAudio.disabled = state !== 'idle';
  }
}

async function startNotes(): Promise<void> {
  startPause.textContent = 'preparing…';

  const ok = await ensurePrepared();

  if (!ok) {
    updateControls();
    return;
  }

  state = 'running';
  engineStatus.className = 'ap-status-ready ap-duplex-status';
  engineStatus.textContent = `✓ ${activeName()} — listening`;
  updateControls();

  activeStart();
}

function pauseNotes(): void {
  state = 'paused';
  speechSynthesis.cancel();
  activeSetPaused(true);
  engineStatus.className = 'ap-status-muted ap-duplex-status';
  engineStatus.textContent = 'paused — notes kept, press resume';
  updateControls();
}

function resumeNotes(): void {
  state = 'running';
  activeSetPaused(false);
  engineStatus.className = 'ap-status-ready ap-duplex-status';
  engineStatus.textContent = `✓ ${activeName()} — listening`;
  updateControls();
}

function clearNotes(): void {
  speechSynthesis.cancel();
  hidePopup();
  activeStop();
  state = 'idle';
  segmentCount = 0;
  notes.length = 0;
  stream.innerHTML = '';
  pendingRow = null;
  streamRow = null;
  showEmptyHint(true);
  engineStatus.className = 'ap-status-ready ap-duplex-status';
  engineStatus.textContent = `✓ ${activeName()} — press start`;
  updateControls();
}

function setIdle(): void {
  speechSynthesis.cancel();
  activeStop();
  state = 'idle';
  streamRow = null;
  updateControls();
}

function saveNotes(): void {
  if (notes.length === 0) {
    return;
  }
  const text = notes.map((n) => n.text).join('\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `notes-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

startPause.addEventListener('click', () => {
  if (state === 'idle') {
    void startNotes();
  } else if (state === 'running') {
    pauseNotes();
  } else {
    resumeNotes();
  }
});

clearBtn.addEventListener('click', clearNotes);
saveBtn.addEventListener('click', saveNotes);

// High accuracy toggles Whisper base ↔ small (250 MB). Switching resets the
// prepared state — the new model has its own one-time download.
highAccuracy?.addEventListener('change', () => {
  engine.setModel(highAccuracy.checked ? 'Xenova/whisper-small' : undefined);
  prepared = false;
  preparing = null;
  refreshDlLabel();
  dlBox.hidden = true;
  void initEngine();
});

// ---- Gate ---------------------------------------------------------

async function initEngine(): Promise<void> {
  const support = activeCheck();

  if (!support.ok) {
    engineStatus.className = 'ap-status-bad ap-duplex-status';
    engineStatus.textContent =
      support.reason ?? 'this tool is unavailable here';
    startPause.disabled = true;
    return;
  }

  if (!activeNeedsSetup() || (await activeIsReady())) {
    prepared = true;
    engineStatus.className = 'ap-status-ready ap-duplex-status';
    engineStatus.textContent = `✓ ${activeName()} — press start`;
    dlBox.hidden = true;
    return;
  }

  prepared = false;
  engineStatus.className = 'ap-status-muted ap-duplex-status';
  engineStatus.textContent = `${activeName()} — one-time setup:`;
  dlBox.hidden = false;
}

updateControls();
void initEngine();
