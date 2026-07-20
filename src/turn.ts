/**
 * TURN TRANSLATOR — two buttons, streaming, one-way at a time
 * (Vasily, 2026-07-18). The phone lies on the table between two
 * people; EACH side owns a button:
 *
 *  - tap YOUR button → it lights amber, your side is being heard;
 *  - tap it again → stop; or the OTHER taps theirs → your button
 *    goes idle where it was, theirs lights up (the turn is taken);
 *  - always streaming, always one-way in the moment.
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
 * Predefined pair: Chrome online recognition × Chrome built-in
 * translation. Later the SAME layout wraps other one-way pairs.
 */

import {
  SPEECH_LOCALES,
  buildRecognition,
  chromeTranslatorSupported,
  countToolUse,
  fillLanguageSelect,
  getChromeTranslator,
  speechRecognitionSupported,
  type SpeechRecognitionLike
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

fillLanguageSelect(langA, 'en');
fillLanguageSelect(langB, 'ru');

function langColor(code: string): string {
  return LANG_COLORS[code] ?? '#94a7cc';
}

// ---- Honest gate --------------------------------------------------

function refreshGate(): boolean {
  const ok = speechRecognitionSupported() && chromeTranslatorSupported();

  if (ok) {
    engineStatus.className = 'ap-status-ready';
    engineStatus.textContent =
      '✓ ready — tap your button and speak';
  } else {
    engineStatus.className = 'ap-status-bad';
    engineStatus.textContent = !speechRecognitionSupported()
      ? 'this translator needs Chrome or Edge (speech recognition)'
      : 'this translator needs Chrome 138+ (built-in translation)';
    btnA.classList.add('ap-turn-side-off');
    btnB.classList.add('ap-turn-side-off');
  }

  return ok;
}

// ---- The turn machine ---------------------------------------------

type Side = 'a' | 'b' | null;

let active: Side = null;
let recognition: SpeechRecognitionLike | null = null;
let speaking = false; // a ▶ playback is holding the mic

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

// A live segment on screen: { original, translation } pair.
interface Segment {
  original: string;
  translation: string;
  from: string;
  to: string;
  row: HTMLDivElement;
}

let liveSegments: Segment[] = [];
let interimRow: HTMLDivElement | null = null;

function startTurn(side: 'a' | 'b'): void {
  active = side;
  flushLiveToArchive(); // any leftover from a previous turn
  liveSegments = [];
  clearLive();
  startRecognition(side);
  refreshButtons();
}

function stopTurn(): void {
  active = null;
  stopRecognition();
  flushLiveToArchive();
  refreshButtons();
}

function startRecognition(side: 'a' | 'b'): void {
  recognition = buildRecognition();
  recognition.lang = SPEECH_LOCALES[sourceLang(side)] ?? sourceLang(side);
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = (event) => {
    let interim = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0].transcript.trim();

      if (result.isFinal) {
        if (text) {
          void addSegment(text, side);
        }
      } else {
        interim += result[0].transcript;
      }
    }

    showInterim(interim.trim());
  };

  recognition.onend = () => {
    // The engine drops on silence; while the button stays lit AND we
    // are not mid-playback, revive it. No double tapping.
    if (active === side && !speaking) {
      try {
        recognition?.start();
      } catch {
        // Restart storm guard.
      }
    }
  };

  recognition.onerror = (event) => {
    if (event.error === 'not-allowed') {
      engineStatus.className = 'ap-status-bad';
      engineStatus.textContent =
        'microphone blocked — allow it in the address bar';
      stopTurn();
    }
  };

  recognition.start();
}

function stopRecognition(): void {
  try {
    recognition?.stop();
  } catch {
    // Already stopped.
  }

  recognition = null;
  showInterim('');
}

// ---- Live zone (pairs, tappable chunks) ---------------------------

function clearLive(): void {
  live.innerHTML = '';
  interimRow = null;
}

function showInterim(text: string): void {
  if (!text) {
    interimRow?.remove();
    interimRow = null;
    return;
  }

  if (!interimRow) {
    interimRow = document.createElement('div');
    interimRow.className = 'ap-seg ap-seg-interim';
    live.appendChild(interimRow);
  }

  interimRow.textContent = text;
  interimRow.scrollIntoView({ block: 'nearest' });
}

async function addSegment(text: string, side: 'a' | 'b'): Promise<void> {
  showInterim('');

  const from = sourceLang(side);
  const to = targetLang(side);

  const row = document.createElement('div');

  row.className = 'ap-seg';
  row.style.borderLeftColor = langColor(from);
  row.innerHTML = `<div class="ap-seg-orig">${escapeHtml(text)}</div>
    <div class="ap-seg-trans">…</div>`;
  live.appendChild(row);
  row.scrollIntoView({ block: 'nearest' });

  countToolUse('turn-two-button-chrome');

  const segment: Segment = { original: text, translation: '', from, to, row };

  liveSegments.push(segment);

  try {
    const translator = await getChromeTranslator(from, to);
    const translated = await translator.translate(text);

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

  speaking = true;
  stopRecognition(); // free the mic from itself

  const utterance = new SpeechSynthesisUtterance(text);

  utterance.lang = SPEECH_LOCALES[to] ?? to;
  utterance.onend = () => {
    speaking = false;

    // If a button is still lit, resume listening for that side.
    if (active) {
      startRecognition(active);
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
    startTurn('a');
  }
});

btnB.addEventListener('click', () => {
  if (active === 'b') {
    stopTurn();
  } else {
    startTurn('b');
  }
});

for (const select of [langA, langB]) {
  // The in-button ▾ must NOT toggle the turn.
  select.addEventListener('click', (event) => event.stopPropagation());
  select.addEventListener('pointerdown', (event) => event.stopPropagation());

  select.addEventListener('change', () => {
    if (active) {
      stopRecognition();
      startRecognition(active);
    }

    refreshButtons();
  });
}

refreshGate();
refreshButtons();
