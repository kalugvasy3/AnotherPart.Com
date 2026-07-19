/**
 * TURN TRANSLATOR (Vasily, 2026-07-18): «телефон лежит посредине —
 * я говорю, тыкнул, теперь я». One-way at a time; THE BUTTON in the
 * middle is the whole interface. Predefined pair: Online recognition
 * (Web Speech) × Chrome built-in translation.
 *
 * The flow: tap → listening to side A → tap → A's phrase is sealed,
 * translated, spoken aloud — and listening flips to side B. Every tap
 * is «I'm done — your turn».
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

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const langA = $<HTMLSelectElement>('langA');
const langB = $<HTMLSelectElement>('langB');
const engineStatus = $<HTMLDivElement>('engineStatus');
const said = $<HTMLDivElement>('said');
const heard = $<HTMLDivElement>('heard');
const turnButton = $<HTMLButtonElement>('turnButton');
const stopButton = $<HTMLButtonElement>('stopButton');
const history = $<HTMLDivElement>('history');

fillLanguageSelect(langA, 'en');
fillLanguageSelect(langB, 'ru');

// ---- Honest gate: does this browser carry the pair? ---------------

function refreshGate(): boolean {
  const recOk = speechRecognitionSupported();
  const transOk = chromeTranslatorSupported();

  if (recOk && transOk) {
    engineStatus.className = 'ap-status-ready';
    engineStatus.textContent = '✓ ready — tap the button and speak';

    return true;
  }

  engineStatus.className = 'ap-status-bad';
  engineStatus.textContent = !recOk
    ? 'this translator needs Chrome or Edge (speech recognition)'
    : 'this translator needs Chrome 138+ (built-in translation)';
  turnButton.disabled = true;

  return false;
}

// ---- The turn machine ---------------------------------------------

type Phase = 'off' | 'listening';

let phase: Phase = 'off';
/** Whose turn: 'a' speaks langA, 'b' speaks langB. */
let side: 'a' | 'b' = 'a';
let recognition: SpeechRecognitionLike | null = null;
/** Everything heard since the turn started — sealed by the tap. */
let turnTranscript = '';
let turnInterim = '';

function sourceLang(): string {
  return side === 'a' ? langA.value : langB.value;
}

function targetLang(): string {
  return side === 'a' ? langB.value : langA.value;
}

function labelOf(select: HTMLSelectElement): string {
  return select.selectedOptions[0]?.textContent ?? select.value;
}

function refreshButton(): void {
  if (phase === 'off') {
    turnButton.textContent = '🎤 Tap and speak';
    turnButton.classList.add('ap-turn-live');
    turnButton.classList.remove('ap-turn-listening');
    stopButton.hidden = true;

    return;
  }

  const speaking = side === 'a' ? labelOf(langA) : labelOf(langB);

  turnButton.textContent = `🎙 ${speaking} — speak · tap when done`;
  turnButton.classList.remove('ap-turn-live');
  turnButton.classList.add('ap-turn-listening');
  stopButton.hidden = false;
}

function startRecognition(): void {
  recognition = buildRecognition();
  recognition.lang = SPEECH_LOCALES[sourceLang()] ?? sourceLang();
  recognition.continuous = true;
  recognition.interimResults = true;
  turnTranscript = '';
  turnInterim = '';

  recognition.onresult = (event) => {
    turnInterim = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];

      if (result.isFinal) {
        turnTranscript += result[0].transcript;
      } else {
        turnInterim += result[0].transcript;
      }
    }

    said.textContent = (turnTranscript + turnInterim).trim();
  };

  recognition.onend = () => {
    // The online engine drops on silence — revive it while the turn
    // is still open (the tap is the only real «done»).
    if (phase === 'listening') {
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
      stopAll();
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
}

async function sealTurn(): Promise<void> {
  const text = (turnTranscript + turnInterim).trim();

  said.textContent = '';

  if (!text) {
    return; // An empty turn just flips the side.
  }

  const from = sourceLang();
  const to = targetLang();

  countToolUse('turn-online-chrome');
  appendHistory(`${from}: ${text}`);

  try {
    const translator = await getChromeTranslator(from, to);
    const translated = await translator.translate(text);

    heard.textContent = translated;
    appendHistory(`→ ${to}: ${translated}`);

    // The other side HEARS their language — that is the tool.
    const utterance = new SpeechSynthesisUtterance(translated);

    utterance.lang = SPEECH_LOCALES[to] ?? to;
    speechSynthesis.speak(utterance);
  } catch (error) {
    heard.textContent = '⚠ translation failed — try again';
    console.error('[turn] translate failed:', error);
  }
}

function appendHistory(line: string): void {
  const row = document.createElement('div');

  row.textContent = line;
  history.prepend(row);
}

function stopAll(): void {
  phase = 'off';
  stopRecognition();
  speechSynthesis.cancel();
  refreshButton();
}

turnButton.addEventListener('click', () => {
  if (phase === 'off') {
    // First tap: side A begins.
    phase = 'listening';
    side = 'a';
    heard.textContent = '';
    startRecognition();
    refreshButton();

    return;
  }

  // The tap = «I'm done»: seal this turn, flip the side, listen on.
  stopRecognition();
  void sealTurn();
  side = side === 'a' ? 'b' : 'a';
  startRecognition();
  refreshButton();
});

stopButton.addEventListener('click', stopAll);

for (const select of [langA, langB]) {
  select.addEventListener('change', () => {
    if (phase === 'listening') {
      stopRecognition();
      startRecognition();
      refreshButton();
    }
  });
}

refreshGate();
refreshButton();
