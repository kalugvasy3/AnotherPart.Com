/**
 * Shared engine plumbing for .Com tools — the recognizers and
 * translators live here; every tool page is a PREDEFINED pair of
 * them (the user picks a tool, never assembles engines).
 */

import { LiveTalkMic } from './live-talk-mic';
import type { Model, VoskKaldiRecognizer } from 'vosk-browser';

export const LANGUAGES: Array<{ code: string; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'ru', label: 'Русский' },
  { code: 'es', label: 'Español' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Português' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'uk', label: 'Українська' },
  { code: 'pl', label: 'Polski' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'zh', label: '中文' }
];

export const SPEECH_LOCALES: Record<string, string> = {
  en: 'en-US',
  ru: 'ru-RU',
  es: 'es-ES',
  de: 'de-DE',
  fr: 'fr-FR',
  it: 'it-IT',
  pt: 'pt-PT',
  tr: 'tr-TR',
  uk: 'uk-UA',
  pl: 'pl-PL',
  nl: 'nl-NL',
  ja: 'ja-JP',
  ko: 'ko-KR',
  zh: 'zh-CN'
};

export function fillLanguageSelect(
  select: HTMLSelectElement,
  picked: string,
  /** Optional whitelist — a pair (e.g. offline Marian) may support only a
   *  subset. Absent = every language in LANGUAGES. */
  allow?: readonly string[]
): void {
  const allowSet = allow ? new Set(allow) : null;

  select.innerHTML = '';

  for (const lang of LANGUAGES) {
    if (allowSet && !allowSet.has(lang.code)) {
      continue;
    }

    const option = document.createElement('option');

    option.value = lang.code;
    option.textContent = lang.label;
    option.selected = lang.code === picked;
    select.appendChild(option);
  }
}

// ---- Online recognition (Web Speech) ------------------------------

export type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<{
          isFinal: boolean;
          0: { transcript: string };
        }>;
      }) => void)
    | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
};

export function speechRecognitionSupported(): boolean {
  return (
    'webkitSpeechRecognition' in window || 'SpeechRecognition' in window
  );
}

export function buildRecognition(): SpeechRecognitionLike {
  const ctor =
    (
      window as unknown as {
        webkitSpeechRecognition?: new () => SpeechRecognitionLike;
      }
    ).webkitSpeechRecognition ??
    (
      window as unknown as {
        SpeechRecognition?: new () => SpeechRecognitionLike;
      }
    ).SpeechRecognition;

  if (!ctor) {
    throw new Error('Speech recognition needs Chrome or Edge');
  }

  return new ctor();
}

// ---- Chrome built-in translation (Translator API) -----------------

export type ChromeTranslator = {
  translate: (text: string) => Promise<string>;
};

const translatorCache = new Map<string, ChromeTranslator>();

export function chromeTranslatorSupported(): boolean {
  return 'Translator' in self;
}

export async function getChromeTranslator(
  from: string,
  to: string
): Promise<ChromeTranslator> {
  const key = `${from}->${to}`;
  const cached = translatorCache.get(key);

  if (cached) {
    return cached;
  }

  const api = (
    self as unknown as {
      Translator?: {
        create: (options: {
          sourceLanguage: string;
          targetLanguage: string;
        }) => Promise<ChromeTranslator>;
      };
    }
  ).Translator;

  if (!api) {
    throw new Error('the built-in translator needs Chrome 138+');
  }

  const translator = await api.create({
    sourceLanguage: from,
    targetLanguage: to
  });

  translatorCache.set(key, translator);

  return translator;
}

// ---- Anonymous tool-usage counter (stub until launch) -------------

export function countToolUse(tool: string): void {
  try {
    const key = `ap-tool-${tool}`;
    const current = Number(localStorage.getItem(key) ?? '0');

    localStorage.setItem(key, String(current + 1));
  } catch {
    // Counting is never worth breaking the tool.
  }
}

// ===================================================================
//  TURN PAIRS — a PREDEFINED recognizer × translator behind one
//  interface, so a single Turn template (src/turn.ts) drives both the
//  online page and the offline page. The law: pairs are fixed per menu
//  item; the user picks a tool, never assembles engines.
// ===================================================================

/** What the recognizer is doing right now, for the on-screen indicator so
 *  the two people can tell it apart: is it hearing me? did it stop? */
export type RecognizerActivity =
  /** Mic open, waiting for speech. `level` 0..1 if the engine reports it. */
  | { state: 'listening'; level?: number }
  /** Speech detected, capturing. `level` 0..1 if available. */
  | { state: 'hearing'; level?: number }
  /** Utterance captured, turning audio into text (offline Whisper). */
  | { state: 'transcribing' }
  /** Nothing active (paused for playback, or stopped). */
  | { state: 'idle' };

/** How the Turn template drives whichever recognizer a pair provides. */
export interface RecognizerHandlers {
  /** Streaming, not-yet-final text (online only; offline stays quiet). */
  onInterim: (text: string) => void;
  /** A finished segment of source-language text. */
  onFinal: (text: string) => void;
  /** Fatal for this turn (e.g. mic blocked) — the caller ends the turn. */
  onError: (message: string) => void;
  /** Live activity for the indicator (mic level + what's happening). */
  onActivity?: (activity: RecognizerActivity) => void;
}

export interface TurnRecognizer {
  /** Begin listening for `sourceLang` (a LANGUAGES code). */
  start(sourceLang: string, handlers: RecognizerHandlers): void;
  /** Half-duplex gate during a ▶ playback — keeps the engine alive but
   *  deaf, so the TTS voice is not transcribed back. */
  setPaused(paused: boolean): void;
  /** End the turn for good; must drop any late callbacks. */
  stop(): void;
}

export interface TurnTranslator {
  translate(text: string, from: string, to: string): Promise<string>;
}

/** Warm-up progress for a pair that must download/compile models. */
export interface PrepareProgress {
  /** Human line for the status text. */
  message: string;
  /** 0..1 overall, or null while the total is not yet known. */
  fraction: number | null;
}

export interface TurnPair {
  /** Anonymous usage counter key. */
  id: string;
  /** HONEST active name — shown in the status line (law: активный движок
   *  называется по имени). */
  name: string;
  /** Languages this pair can actually handle; absent = all of LANGUAGES. */
  langs?: readonly string[];
  /** One-time download size, shown on the download button (offline pairs). */
  downloadHint?: string;
  /** Default A/B selection for the page. */
  defaults: { a: string; b: string };
  /** Is the pair usable here? If not, WHY (law: недоступный движок говорит
   *  почему). */
  check(): { ok: boolean; reason?: string };
  /** True if everything is already on the device — nothing to download, so
   *  the page can go straight to green with NO download prompt. */
  isReady?(): Promise<boolean>;
  /** Optional warm-up (offline: download/compile models) with progress. */
  prepare?(
    onProgress: (progress: PrepareProgress) => void,
    a: string,
    b: string
  ): Promise<void>;
  recognizer: TurnRecognizer;
  translator: TurnTranslator;
}

// ---- Online pair: Web Speech × Chrome built-in --------------------

class OnlineRecognizer implements TurnRecognizer {
  private rec: SpeechRecognitionLike | null = null;
  private handlers: RecognizerHandlers | null = null;
  private lang = 'en';
  private listening = false;
  private paused = false;

  public start(sourceLang: string, handlers: RecognizerHandlers): void {
    this.lang = sourceLang;
    this.handlers = handlers;
    this.listening = true;
    this.paused = false;
    this.open();
    this.handlers.onActivity?.({ state: 'listening' });
  }

  public setPaused(paused: boolean): void {
    this.paused = paused;

    if (paused) {
      this.detachAndStop();
    } else if (this.listening) {
      this.open();
    }

    this.handlers?.onActivity?.(
      paused ? { state: 'idle' } : { state: 'listening' }
    );
  }

  public stop(): void {
    this.listening = false;
    this.paused = false;
    this.detachAndStop();
    this.handlers?.onActivity?.({ state: 'idle' });
    this.handlers = null;
  }

  private open(): void {
    const rec = buildRecognition();

    rec.lang = SPEECH_LOCALES[this.lang] ?? this.lang;
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (event) => {
      let interim = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript.trim();

        if (result.isFinal) {
          if (text) {
            this.handlers?.onFinal(text);
          }
        } else {
          interim += result[0].transcript;
        }
      }

      const trimmed = interim.trim();

      this.handlers?.onInterim(trimmed);
      this.handlers?.onActivity?.({
        state: trimmed ? 'hearing' : 'listening'
      });
    };

    rec.onend = () => {
      // The engine drops on silence; while the turn is live and not paused,
      // revive it. No double tapping.
      //
      // BACKOFF (2026-07-20): in some Chrome states `start()` fails and fires
      // `onend` again immediately — a tight restart loop that pegs a CPU core.
      // A short delay caps restarts to a few per second, so it can never
      // busy-spin.
      if (this.listening && !this.paused && this.rec === rec) {
        setTimeout(() => {
          if (this.listening && !this.paused && this.rec === rec) {
            try {
              rec.start();
            } catch {
              // Already started / transient — the next onend retries.
            }
          }
        }, 300);
      }
    };

    rec.onerror = (event) => {
      if (event.error === 'not-allowed') {
        this.handlers?.onError(
          'microphone blocked — allow it in the address bar'
        );
      }
    };

    this.rec = rec;

    try {
      rec.start();
    } catch {
      // Already started.
    }
  }

  /** BUGFIX (2026-07-20, «хвост фразы»): a stopping engine can still fire one
   *  last final `onresult` — the pending interim (e.g. «привет я слушаю»).
   *  With handlers attached that tail lands in the NEXT turn's live zone
   *  (seen live: «утка… привет я слушаю» repeats). Detach BEFORE stop so no
   *  late callback survives the turn boundary. */
  private detachAndStop(): void {
    const dying = this.rec;

    this.rec = null;

    if (dying) {
      dying.onresult = null;
      dying.onend = null;
      dying.onerror = null;

      try {
        dying.stop();
      } catch {
        // Already stopped.
      }
    }
  }
}

class OnlineTranslator implements TurnTranslator {
  public async translate(
    text: string,
    from: string,
    to: string
  ): Promise<string> {
    const translator = await getChromeTranslator(from, to);

    return translator.translate(text);
  }
}

function makeOnlinePair(): TurnPair {
  return {
    id: 'turn-two-button-chrome',
    name: 'Web Speech × Chrome built-in',
    defaults: { a: 'en', b: 'ru' },
    check() {
      if (!speechRecognitionSupported()) {
        return {
          ok: false,
          reason:
            'this translator needs Chrome or Edge (speech recognition)'
        };
      }

      if (!chromeTranslatorSupported()) {
        return {
          ok: false,
          reason: 'this translator needs Chrome 138+ (built-in translation)'
        };
      }

      return { ok: true };
    },
    recognizer: new OnlineRecognizer(),
    translator: new OnlineTranslator()
  };
}

// ---- Offline pair: Whisper (base) × Marian OPUS-MT ----------------
//
// Both engines run in-browser via transformers.js in a Web Worker
// (src/live-talk-translator.worker.ts). Audio and text NEVER leave the
// device — the local-first law's poster child.

/** Marian OPUS-MT coverage in the worker (via the English axis). */
export const OFFLINE_LANGS = [
  'en',
  'ru',
  'es',
  'de',
  'fr',
  'it',
  'tr',
  'uk'
] as const;

/** Whisper wants a language NAME, not our 2-letter code. */
const WHISPER_LANGS: Record<string, string> = {
  en: 'english',
  ru: 'russian',
  es: 'spanish',
  de: 'german',
  fr: 'french',
  it: 'italian',
  tr: 'turkish',
  uk: 'ukrainian'
};

type WorkerMessage =
  | { type: 'progress'; model: string; file: string; loaded: number; total: number }
  | { type: 'ready' }
  | { type: 'asr-ready' }
  | { type: 'load-error'; message: string }
  | { type: 'asr-load-error'; message: string }
  | { type: 'transcription'; id: number; text: string }
  | { type: 'transcription-error'; id: number; message: string }
  | { type: 'translation'; id: number; text: string }
  | { type: 'translation-error'; id: number; message: string };

/** Thin client over the live-talk worker: request/response by id, plus the
 *  single-flight load / load-asr handshakes. */
class LiveTalkWorkerClient {
  // LAZY (2026-07-20): the worker — and therefore the transformers.js /
  // onnxruntime-web WASM glue it imports — is spun up only on first use, NOT
  // when the page constructs the pair. Opening the offline page must cost
  // nothing until the user actually taps a button.
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (text: string) => void; reject: (error: Error) => void }
  >();

  private loadWaiters: { resolve: () => void; reject: (e: Error) => void } | null =
    null;
  private asrWaiters: { resolve: () => void; reject: (e: Error) => void } | null =
    null;

  public onProgress:
    | ((model: string, file: string, loaded: number, total: number) => void)
    | null = null;

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        new URL('./live-talk-translator.worker.ts', import.meta.url),
        { type: 'module' }
      );

      this.worker.onmessage = (event: MessageEvent<WorkerMessage>) =>
        this.handle(event.data);
    }

    return this.worker;
  }

  private handle(msg: WorkerMessage): void {
    switch (msg.type) {
      case 'progress':
        this.onProgress?.(msg.model, msg.file, msg.loaded, msg.total);
        break;
      case 'ready':
        this.loadWaiters?.resolve();
        this.loadWaiters = null;
        break;
      case 'asr-ready':
        this.asrWaiters?.resolve();
        this.asrWaiters = null;
        break;
      case 'load-error':
        this.loadWaiters?.reject(new Error(msg.message));
        this.loadWaiters = null;
        break;
      case 'asr-load-error':
        this.asrWaiters?.reject(new Error(msg.message));
        this.asrWaiters = null;
        break;
      case 'transcription':
      case 'translation': {
        const entry = this.pending.get(msg.id);

        if (entry) {
          this.pending.delete(msg.id);
          entry.resolve(msg.text);
        }
        break;
      }
      case 'transcription-error':
      case 'translation-error': {
        const entry = this.pending.get(msg.id);

        if (entry) {
          this.pending.delete(msg.id);
          entry.reject(new Error(msg.message));
        }
        break;
      }
    }
  }

  public loadTranslation(a: string, b: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.loadWaiters = { resolve, reject };
      this.ensureWorker().postMessage({ type: 'load', a, b });
    });
  }

  public loadAsr(model?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.asrWaiters = { resolve, reject };
      this.ensureWorker().postMessage({ type: 'load-asr', model });
    });
  }

  public transcribe(
    audio: Float32Array,
    language?: string,
    model?: string
  ): Promise<string> {
    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      // NOT transferred: the Listening-notes tool keeps the same utterance
      // for original-audio replay, so the main thread must retain it. A
      // structured clone of an utterance-sized buffer is cheap.
      this.ensureWorker().postMessage({
        type: 'transcribe',
        id,
        audio,
        language,
        model
      });
    });
  }

  public translate(from: string, to: string, text: string): Promise<string> {
    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ensureWorker().postMessage({ type: 'translate', id, from, to, text });
    });
  }
}

class OfflineRecognizer implements TurnRecognizer {
  private handlers: RecognizerHandlers | null = null;
  private lang = 'en';
  private hearing = false;

  public constructor(
    private worker: LiveTalkWorkerClient,
    private mic: LiveTalkMic,
    /** Whisper model id; undefined = the worker's default (base). */
    private asrModel?: string
  ) {}

  public start(sourceLang: string, handlers: RecognizerHandlers): void {
    this.lang = sourceLang;
    this.handlers = handlers;
    this.hearing = false;

    // The mic's live level → the indicator, so «слышит ли меня» is obvious.
    this.mic.onLevel = (level) => {
      this.handlers?.onActivity?.({
        state: this.hearing ? 'hearing' : 'listening',
        level
      });
    };

    this.handlers.onActivity?.({ state: 'listening', level: 0 });

    void this.mic
      .startAuto({
        onSpeechStart: () => {
          this.hearing = true;
          this.handlers?.onInterim('…');
          this.handlers?.onActivity?.({ state: 'hearing' });
        },
        onSpeechEnd: () => {
          this.hearing = false;
          this.handlers?.onInterim('');
          // Audio captured — Whisper now turns it into text.
          this.handlers?.onActivity?.({ state: 'transcribing' });
        },
        onUtterance: (audio) => void this.transcribe(audio)
      })
      .catch((error: unknown) => {
        this.handlers?.onError(
          error instanceof DOMException && error.name === 'NotAllowedError'
            ? 'microphone blocked — allow it in the address bar'
            : `microphone unavailable: ${
                error instanceof Error ? error.message : String(error)
              }`
        );
      });
  }

  private async transcribe(audio: Float32Array): Promise<void> {
    try {
      const text = (
        await this.worker.transcribe(
          audio,
          WHISPER_LANGS[this.lang],
          this.asrModel
        )
      ).trim();

      if (text) {
        this.handlers?.onFinal(text);
      }
    } catch (error) {
      console.error('[turn-offline] transcribe failed:', error);
    } finally {
      // Back to waiting for the next utterance.
      if (this.handlers) {
        this.handlers.onActivity?.({ state: 'listening', level: 0 });
      }
    }
  }

  public setPaused(paused: boolean): void {
    this.mic.setAutoPaused(paused);
    this.handlers?.onActivity?.(
      paused ? { state: 'idle' } : { state: 'listening', level: 0 }
    );
  }

  public stop(): void {
    this.mic.onLevel = null;
    this.mic.stopAuto();
    this.handlers?.onActivity?.({ state: 'idle' });
    this.handlers = null;
  }
}

class OfflineTranslator implements TurnTranslator {
  public constructor(private worker: LiveTalkWorkerClient) {}

  public translate(text: string, from: string, to: string): Promise<string> {
    return this.worker.translate(from, to, text);
  }
}

// ---- Vosk: offline STREAMING recognition (Kaldi WASM, Apache-2.0) --
//
// Unlike Whisper (utterance-based), Vosk streams: raw mic chunks go straight
// in and words come out AS they are spoken — light CPU, small models. So it
// drives onInterim/onFinal exactly like the online engine, but on-device.
//
// Models are the ~40 MB small builds hosted by the vosk-browser demo
// (gh-pages, CORS open) — a one-time download, then the browser HTTP-caches
// them. Audio itself never leaves the device. (Journal note from .Me: for
// production the models should move into our own assets / OPFS.)

// ONE place to switch hosts. Today: the vosk-browser demo (a personal
// gh-pages — fragile). To move to our own reliable mirror, change ONLY this
// base to e.g. 'https://huggingface.co/<org>/anotherpart-vosk/resolve/main/'
// (see scripts/mirror-vosk-to-hf.md). Models are content-addressed by
// version in the filename, so the URL stays immutable and HTTP-cacheable.
const VOSK_MODEL_BASE = 'https://ccoreilly.github.io/vosk-browser/models/';

const VOSK_MODEL_FILES: Record<string, string> = {
  ru: 'vosk-model-small-ru-0.4.tar.gz',
  en: 'vosk-model-small-en-us-0.15.tar.gz',
  es: 'vosk-model-small-es-0.3.tar.gz',
  de: 'vosk-model-small-de-0.15.tar.gz',
  fr: 'vosk-model-small-fr-pguyot-0.3.tar.gz',
  it: 'vosk-model-small-it-0.4.tar.gz',
  tr: 'vosk-model-small-tr-0.3.tar.gz'
  // No Ukrainian small model in this set.
};

const VOSK_MODEL_URLS: Record<string, string> = Object.fromEntries(
  Object.entries(VOSK_MODEL_FILES).map(([lang, file]) => [
    lang,
    VOSK_MODEL_BASE + file
  ])
);

const VOSK_LANGS = Object.keys(VOSK_MODEL_FILES);

/** Holds one Vosk Model per language (each ~40 MB); loaded lazily and kept
 *  so alternating turns don't re-download. */
class VoskEngine {
  private models = new Map<string, Model>();
  private loading = new Map<string, Promise<Model>>();

  public async loadModel(lang: string): Promise<Model> {
    const existing = this.models.get(lang);

    if (existing) {
      return existing;
    }

    const url = VOSK_MODEL_URLS[lang];

    if (!url) {
      throw new Error(`Vosk has no model for "${lang}"`);
    }

    let pending = this.loading.get(lang);

    if (!pending) {
      pending = (async () => {
        // Dynamic import: the ~1.5 MB engine loads only on this page.
        const { createModel } = await import('vosk-browser');
        const model = await createModel(url);

        this.models.set(lang, model);
        this.loading.delete(lang);

        return model;
      })();

      this.loading.set(lang, pending);
    }

    return pending;
  }
}

class VoskRecognizer implements TurnRecognizer {
  private handlers: RecognizerHandlers | null = null;
  private recognizer: VoskKaldiRecognizer | null = null;
  private recognizerRate = 0;
  private hearing = false;

  public constructor(
    private engine: VoskEngine,
    private mic: LiveTalkMic
  ) {}

  public start(sourceLang: string, handlers: RecognizerHandlers): void {
    this.handlers = handlers;
    this.hearing = false;

    this.mic.onLevel = (level) =>
      this.handlers?.onActivity?.({
        state: this.hearing ? 'hearing' : 'listening',
        level
      });

    this.handlers.onActivity?.({ state: 'listening', level: 0 });

    void (async () => {
      let model: Model;

      try {
        model = await this.engine.loadModel(sourceLang);
      } catch (error) {
        this.handlers?.onError(
          `couldn't load the ${sourceLang.toUpperCase()} streaming model: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return;
      }

      // The turn may have ended while the model loaded.
      if (this.handlers === handlers) {
        this.beginStream(model, handlers);
      }
    })();
  }

  private beginStream(model: Model, handlers: RecognizerHandlers): void {
    void this.mic
      .startAuto({
        onSpeechStart: () => {
          this.hearing = true;
          handlers.onActivity?.({ state: 'hearing' });
        },
        onSpeechEnd: () => {
          this.hearing = false;
          handlers.onActivity?.({ state: 'listening', level: 0 });
        },
        onUtterance: () => {
          // Vosk is streaming — it emits its own finals; the VAD-cut
          // utterance is unused here.
        },
        onChunk: (chunk, sampleRate) =>
          this.acceptChunk(model, chunk, sampleRate)
      })
      .catch((error: unknown) => {
        handlers.onError(
          error instanceof DOMException && error.name === 'NotAllowedError'
            ? 'microphone blocked — allow it in the address bar'
            : `microphone unavailable: ${
                error instanceof Error ? error.message : String(error)
              }`
        );
      });
  }

  private acceptChunk(
    model: Model,
    chunk: Float32Array,
    sampleRate: number
  ): void {
    if (!this.recognizer || this.recognizerRate !== sampleRate) {
      this.disposeRecognizer();
      this.recognizer = new model.KaldiRecognizer(sampleRate);
      this.recognizerRate = sampleRate;
      this.recognizer.setWords(true);

      this.recognizer.on('result', (message) => {
        const text = message?.result?.text?.trim();

        if (text) {
          this.handlers?.onFinal(text);
        }
      });

      this.recognizer.on('partialresult', (message) => {
        this.handlers?.onInterim(message?.result?.partial?.trim() ?? '');
      });
    }

    try {
      this.recognizer.acceptWaveformFloat(chunk, sampleRate);
    } catch (error) {
      console.error('[turn-vosk] acceptWaveform failed:', error);
    }
  }

  public setPaused(paused: boolean): void {
    // Half-duplex: paused mic stops feeding chunks (mic guards internally).
    this.mic.setAutoPaused(paused);
    this.handlers?.onActivity?.(
      paused ? { state: 'idle' } : { state: 'listening', level: 0 }
    );
  }

  public stop(): void {
    this.mic.onLevel = null;
    this.mic.stopAuto();
    this.disposeRecognizer();
    this.handlers?.onActivity?.({ state: 'idle' });
    this.handlers = null;
  }

  private disposeRecognizer(): void {
    try {
      this.recognizer?.remove();
    } catch {
      // Worker already gone.
    }

    this.recognizer = null;
    this.recognizerRate = 0;
  }
}

/** Are the models already on the device? A completed download sets a
 *  per-model flag; the Cache API check guards against the browser having
 *  since evicted them. transformers.js v2 stores files under
 *  'transformers-cache'. The flag is PER MODEL — base and small download
 *  different Whisper files, so «base ready» must not mask «small missing». */
async function offlineCached(readyFlag: string): Promise<boolean> {
  try {
    if (localStorage.getItem(readyFlag) !== '1') {
      return false;
    }

    if ('caches' in self) {
      const cache = await caches.open('transformers-cache');
      const keys = await cache.keys();

      if (keys.length === 0) {
        return false; // flagged before, but the cache was cleared since
      }
    }

    return true;
  } catch {
    return false;
  }
}

/** Ask the browser to keep our model cache (Cache API + Vosk HTTP cache)
 *  from being evicted under storage pressure — so «downloaded once» really
 *  means once. Best-effort, silent; called before any model download. */
let persistRequested = false;

function requestPersistentStorage(): void {
  if (persistRequested) {
    return;
  }

  persistRequested = true;
  void navigator.storage?.persist?.().catch(() => {
    // Best-effort — the tool works whether or not it's granted.
  });
}

function offlineSupport(): { ok: boolean; reason?: string } {
  const hasMic = !!navigator.mediaDevices?.getUserMedia;
  const hasWorker = typeof Worker !== 'undefined';
  const hasAudio =
    typeof AudioContext !== 'undefined' ||
    'webkitAudioContext' in (self as object);

  if (!hasMic) {
    return {
      ok: false,
      reason: 'this offline translator needs microphone access'
    };
  }

  if (!hasWorker || !hasAudio) {
    return {
      ok: false,
      reason: 'this offline translator needs a modern browser (Web Workers)'
    };
  }

  return { ok: true };
}

interface OfflinePairConfig {
  id: string;
  name: string;
  /** Whisper model id; undefined = the worker default (Xenova/whisper-base). */
  asrModel?: string;
  /** localStorage flag remembering a completed download for THIS model. */
  readyFlag: string;
  /** One-time download size for the button (this model's Whisper + Marian). */
  downloadHint: string;
}

function makeOfflinePair(config: OfflinePairConfig): TurnPair {
  // Instantiate lazily-ish: the client only spins up the worker; models
  // download on prepare/first use.
  const worker = new LiveTalkWorkerClient();
  const mic = new LiveTalkMic();

  return {
    id: config.id,
    name: config.name,
    langs: OFFLINE_LANGS,
    downloadHint: config.downloadHint,
    defaults: { a: 'en', b: 'ru' },
    check: offlineSupport,
    isReady: () => offlineCached(config.readyFlag),
    async prepare(onProgress, a, b) {
      requestPersistentStorage();

      // Aggregate bytes across every file transformers.js reports, so the bar
      // moves forward overall instead of resetting per file.
      const seen = new Map<string, { loaded: number; total: number }>();

      worker.onProgress = (_model, file, loaded, total) => {
        seen.set(file, { loaded, total });

        let loadedSum = 0;
        let totalSum = 0;

        for (const entry of seen.values()) {
          loadedSum += entry.loaded;
          totalSum += entry.total;
        }

        onProgress({
          message: 'downloading on-device models…',
          fraction: totalSum > 0 ? loadedSum / totalSum : null
        });
      };

      onProgress({ message: 'preparing Whisper (speech)…', fraction: null });
      await worker.loadAsr(config.asrModel);

      onProgress({
        message: 'preparing Marian (translation)…',
        fraction: null
      });
      await worker.loadTranslation(a, b);

      worker.onProgress = null;

      // Remember we finished a full download — next visits skip the prompt.
      try {
        localStorage.setItem(config.readyFlag, '1');
      } catch {
        // A blocked localStorage never breaks the tool.
      }
    },
    recognizer: new OfflineRecognizer(worker, mic, config.asrModel),
    translator: new OfflineTranslator(worker)
  };
}

function voskSupport(): { ok: boolean; reason?: string } {
  const base = offlineSupport();

  if (!base.ok) {
    return base;
  }

  if (typeof WebAssembly === 'undefined') {
    return {
      ok: false,
      reason: 'this streaming translator needs WebAssembly'
    };
  }

  return { ok: true };
}

function makeVoskPair(): TurnPair {
  const engine = new VoskEngine();
  const mic = new LiveTalkMic();
  const worker = new LiveTalkWorkerClient(); // Marian, for translation
  const readyFlag = 'ap-vosk-pack-ready-v1';

  return {
    id: 'turn-two-button-vosk',
    name: 'Vosk streaming × Marian OPUS-MT — offline',
    langs: VOSK_LANGS,
    downloadHint: '~40 MB per language + translation',
    defaults: { a: 'en', b: 'ru' },
    check: voskSupport,
    isReady: () => offlineCached(readyFlag),
    async prepare(onProgress, a, b) {
      requestPersistentStorage();

      onProgress({
        message: 'preparing Vosk streaming models…',
        fraction: null
      });

      // Warm the streaming models for BOTH sides so alternating turns are
      // instant (Vosk gives no byte progress — indeterminate bar).
      await engine.loadModel(a);

      if (b !== a) {
        await engine.loadModel(b);
      }

      const seen = new Map<string, { loaded: number; total: number }>();

      worker.onProgress = (_model, file, loaded, total) => {
        seen.set(file, { loaded, total });

        let loadedSum = 0;
        let totalSum = 0;

        for (const entry of seen.values()) {
          loadedSum += entry.loaded;
          totalSum += entry.total;
        }

        onProgress({
          message: 'downloading translation models…',
          fraction: totalSum > 0 ? loadedSum / totalSum : null
        });
      };

      onProgress({
        message: 'preparing Marian (translation)…',
        fraction: null
      });
      await worker.loadTranslation(a, b);

      worker.onProgress = null;

      try {
        localStorage.setItem(readyFlag, '1');
      } catch {
        // A blocked localStorage never breaks the tool.
      }
    },
    recognizer: new VoskRecognizer(engine, mic),
    translator: new OfflineTranslator(worker)
  };
}

// ---- Duplex: both sides just talk, direction auto-detected ---------
//
// Whisper transcribes WITHOUT a forced language (it hears whoever speaks);
// we then decide which of the pair's two languages it was and translate to
// the other. Detection is done on the TEXT (transformers.js v2 doesn't hand
// back Whisper's own language) — reliable across scripts, best-effort within
// one script. Recognition must be Whisper: Web Speech / Vosk need a fixed
// language, so only Whisper can auto-detect.

const LANG_SCRIPT: Record<string, 'cyrillic' | 'latin'> = {
  ru: 'cyrillic',
  uk: 'cyrillic',
  en: 'latin',
  es: 'latin',
  de: 'latin',
  fr: 'latin',
  it: 'latin',
  tr: 'latin'
};

/** A few high-frequency function words per Latin language — enough to vote
 *  between the TWO known candidates of a pair (not general language-ID). */
const LANG_MARKERS: Record<string, string[]> = {
  en: ['the', 'and', 'is', 'to', 'of', 'you', 'that', 'it', 'for', 'are'],
  es: ['el', 'la', 'que', 'de', 'los', 'en', 'un', 'una', 'es', 'por'],
  de: ['der', 'die', 'und', 'ich', 'das', 'nicht', 'ist', 'ein', 'zu', 'mit'],
  fr: ['le', 'les', 'de', 'et', 'un', 'une', 'je', 'que', 'est', 'pas'],
  it: ['il', 'la', 'che', 'di', 'un', 'una', 'sono', 'per', 'non', 'con'],
  tr: ['bir', 've', 'bu', 'için', 'ben', 'ne', 'de', 'çok', 'ama', 'evet']
};

/** Which of [a, b] the text is in. Different scripts → certain (script test);
 *  same script → a marker-word vote (ties keep `a`). */
export function detectLang(text: string, a: string, b: string): string {
  const scriptA = LANG_SCRIPT[a] ?? 'latin';
  const scriptB = LANG_SCRIPT[b] ?? 'latin';
  const textScript = /[Ѐ-ӿ]/.test(text) ? 'cyrillic' : 'latin';

  if (scriptA !== scriptB) {
    return scriptA === textScript ? a : b;
  }

  const words = text.toLowerCase().split(/\s+/).map((w) => w.replace(/[^\p{L}]/gu, ''));

  const score = (lang: string): number => {
    const markers = new Set(LANG_MARKERS[lang] ?? []);
    return words.filter((w) => markers.has(w)).length;
  };

  return score(b) > score(a) ? b : a;
}

export interface DuplexHandlers {
  onActivity(activity: RecognizerActivity): void;
  /** A finished utterance: the original + its detected direction. Returns a
   *  setter the engine calls once the translation is ready. */
  onSegment(
    original: string,
    from: string,
    to: string
  ): (translation: string) => void;
  onError(message: string): void;
}

export interface DuplexEngine {
  id: string;
  name: string;
  langs: readonly string[];
  downloadHint: string;
  defaults: { a: string; b: string };
  check(): { ok: boolean; reason?: string };
  isReady(): Promise<boolean>;
  prepare(
    onProgress: (progress: PrepareProgress) => void,
    a: string,
    b: string
  ): Promise<void>;
  start(getLangs: () => [string, string], handlers: DuplexHandlers): void;
  setPaused(paused: boolean): void;
  stop(): void;
}

interface DuplexConfig {
  id: string;
  name: string;
  asrModel?: string;
  readyFlag: string;
  downloadHint: string;
}

class DuplexEngineImpl implements DuplexEngine {
  private worker = new LiveTalkWorkerClient();
  private mic = new LiveTalkMic();
  private handlers: DuplexHandlers | null = null;
  private hearing = false;

  public constructor(private config: DuplexConfig) {}

  public get id(): string {
    return this.config.id;
  }
  public get name(): string {
    return this.config.name;
  }
  public get langs(): readonly string[] {
    return OFFLINE_LANGS;
  }
  public get downloadHint(): string {
    return this.config.downloadHint;
  }
  public get defaults(): { a: string; b: string } {
    return { a: 'en', b: 'ru' };
  }

  public check(): { ok: boolean; reason?: string } {
    return offlineSupport();
  }

  public isReady(): Promise<boolean> {
    return offlineCached(this.config.readyFlag);
  }

  public async prepare(
    onProgress: (progress: PrepareProgress) => void,
    a: string,
    b: string
  ): Promise<void> {
    requestPersistentStorage();

    const seen = new Map<string, { loaded: number; total: number }>();

    this.worker.onProgress = (_model, file, loaded, total) => {
      seen.set(file, { loaded, total });

      let loadedSum = 0;
      let totalSum = 0;

      for (const entry of seen.values()) {
        loadedSum += entry.loaded;
        totalSum += entry.total;
      }

      onProgress({
        message: 'downloading on-device models…',
        fraction: totalSum > 0 ? loadedSum / totalSum : null
      });
    };

    onProgress({ message: 'preparing Whisper (speech)…', fraction: null });
    await this.worker.loadAsr(this.config.asrModel);

    onProgress({ message: 'preparing Marian (translation)…', fraction: null });
    await this.worker.loadTranslation(a, b);

    this.worker.onProgress = null;

    try {
      localStorage.setItem(this.config.readyFlag, '1');
    } catch {
      // A blocked localStorage never breaks the tool.
    }
  }

  public start(
    getLangs: () => [string, string],
    handlers: DuplexHandlers
  ): void {
    this.handlers = handlers;
    this.hearing = false;

    this.mic.onLevel = (level) =>
      this.handlers?.onActivity({
        state: this.hearing ? 'hearing' : 'listening',
        level
      });

    handlers.onActivity({ state: 'listening', level: 0 });

    void this.mic
      .startAuto({
        onSpeechStart: () => {
          this.hearing = true;
          this.handlers?.onActivity({ state: 'hearing' });
        },
        onSpeechEnd: () => {
          this.hearing = false;
          this.handlers?.onActivity({ state: 'transcribing' });
        },
        onUtterance: (audio) => void this.process(audio, getLangs())
      })
      .catch((error: unknown) => {
        handlers.onError(
          error instanceof DOMException && error.name === 'NotAllowedError'
            ? 'microphone blocked — allow it in the address bar'
            : `microphone unavailable: ${
                error instanceof Error ? error.message : String(error)
              }`
        );
      });
  }

  private async process(
    audio: Float32Array,
    [a, b]: [string, string]
  ): Promise<void> {
    try {
      // No forced language — Whisper hears whichever side is speaking.
      const text = (
        await this.worker.transcribe(audio, undefined, this.config.asrModel)
      ).trim();

      if (!text) {
        return;
      }

      const from = detectLang(text, a, b);
      const to = from === a ? b : a;
      const setTranslation = this.handlers?.onSegment(text, from, to);

      try {
        const translated = await this.worker.translate(from, to, text);
        setTranslation?.(translated);
      } catch (error) {
        console.error('[duplex] translate failed:', error);
        setTranslation?.('⚠ translation failed');
      }
    } catch (error) {
      console.error('[duplex] transcribe failed:', error);
    } finally {
      this.handlers?.onActivity({ state: 'listening', level: 0 });
    }
  }

  public setPaused(paused: boolean): void {
    this.mic.setAutoPaused(paused);
    this.handlers?.onActivity(
      paused ? { state: 'idle' } : { state: 'listening', level: 0 }
    );
  }

  public stop(): void {
    this.mic.onLevel = null;
    this.mic.stopAuto();
    this.handlers?.onActivity({ state: 'idle' });
    this.handlers = null;
  }
}

const cachedDuplex = new Map<string, DuplexEngine>();

/** The two predefined duplex combinations (recognition = Whisper). */
export function getDuplexEngine(id: string): DuplexEngine {
  let engine = cachedDuplex.get(id);

  if (!engine) {
    engine = new DuplexEngineImpl(
      id === 'duplex-small'
        ? {
            id: 'duplex-two-way-small',
            name: 'Duplex · Whisper small × Marian — offline',
            asrModel: 'Xenova/whisper-small',
            readyFlag: 'ap-offline-pack-ready-small-v1',
            downloadHint: '~250 MB + translation'
          }
        : {
            id: 'duplex-two-way-base',
            name: 'Duplex · Whisper base × Marian — offline',
            readyFlag: 'ap-offline-pack-ready-v1',
            downloadHint: '~80 MB + translation'
          }
    );
    cachedDuplex.set(id, engine);
  }

  return engine;
}

// ---- Transcribe: listen & take notes, NO auto-translation ---------
//
// For understanding speech by ear: Whisper transcribes the spoken language
// (forced, for accuracy), nothing is translated automatically. Translation
// is HELP ON DEMAND — the page asks translate() for a clicked word in its
// little context. The original utterance audio is handed to the page too, so
// it can optionally keep it for replay (the page decides — audio is heavy).

export interface TranscribeHandlers {
  onActivity(activity: RecognizerActivity): void;
  /** An utterance was CAPTURED (before recognition) — the page shows a
   *  «recognizing…» placeholder so the queue is visible and nothing looks
   *  lost. Returns a filler the engine calls with the transcript once ready
   *  (empty string = nothing recognized → drop the placeholder). `audio` is
   *  the raw 16 kHz utterance (kept only while «original audio» is on). */
  onCapture(audio: Float32Array): (text: string) => void;
  onError(message: string): void;
}

export interface TranscribeEngine {
  id: string;
  name: string;
  langs: readonly string[];
  downloadHint: string;
  defaults: { listening: string; dictionary: string };
  check(): { ok: boolean; reason?: string };
  isReady(): Promise<boolean>;
  prepare(
    onProgress: (progress: PrepareProgress) => void,
    listening: string
  ): Promise<void>;
  /** Transcribes whatever is spoken — Whisper auto-detects the language (no
   *  forcing: forcing «English» on Russian speech makes Whisper translate,
   *  which is not what a transcriber should do). */
  start(handlers: TranscribeHandlers): void;
  setPaused(paused: boolean): void;
  stop(): void;
  /** Switch the Whisper model (undefined = base ~80 MB, small ~250 MB). */
  setModel(model?: string): void;
  /** On-demand dictionary help (Marian loads lazily on first use). */
  translate(from: string, to: string, text: string): Promise<string>;
}

class TranscribeEngineImpl implements TranscribeEngine {
  private worker = new LiveTalkWorkerClient();
  private mic = new LiveTalkMic();
  private handlers: TranscribeHandlers | null = null;
  private hearing = false;
  /** undefined = Whisper base (~80 MB); 'Xenova/whisper-small' = ~250 MB. */
  private model: string | undefined = undefined;

  public readonly id = 'transcribe-notes';
  public readonly langs = OFFLINE_LANGS;
  public readonly defaults = { listening: 'en', dictionary: 'ru' };

  private get small(): boolean {
    return this.model === 'Xenova/whisper-small';
  }

  public get name(): string {
    return this.small
      ? 'Listening notes · Whisper small — offline'
      : 'Listening notes · Whisper base — offline';
  }

  public get downloadHint(): string {
    return this.small ? '~250 MB (speech)' : '~80 MB (speech)';
  }

  private readyFlag(): string {
    return this.small ? 'ap-notes-ready-small-v1' : 'ap-notes-ready-v1';
  }

  public setModel(model?: string): void {
    this.model = model;
  }

  public check(): { ok: boolean; reason?: string } {
    return offlineSupport();
  }

  public isReady(): Promise<boolean> {
    return offlineCached(this.readyFlag());
  }

  public async prepare(
    onProgress: (progress: PrepareProgress) => void,
    _listening: string
  ): Promise<void> {
    requestPersistentStorage();

    const seen = new Map<string, { loaded: number; total: number }>();

    this.worker.onProgress = (_model, file, loaded, total) => {
      seen.set(file, { loaded, total });

      let loadedSum = 0;
      let totalSum = 0;

      for (const entry of seen.values()) {
        loadedSum += entry.loaded;
        totalSum += entry.total;
      }

      onProgress({
        message: 'downloading the speech model…',
        fraction: totalSum > 0 ? loadedSum / totalSum : null
      });
    };

    onProgress({ message: 'preparing Whisper (speech)…', fraction: null });
    // Only the speech model — translation (Marian) loads lazily on the first
    // dictionary lookup.
    await this.worker.loadAsr(this.model);

    this.worker.onProgress = null;

    try {
      localStorage.setItem(this.readyFlag(), '1');
    } catch {
      // A blocked localStorage never breaks the tool.
    }
  }

  public start(handlers: TranscribeHandlers): void {
    this.handlers = handlers;
    this.hearing = false;

    this.mic.onLevel = (level) =>
      this.handlers?.onActivity({
        state: this.hearing ? 'hearing' : 'listening',
        level
      });

    handlers.onActivity({ state: 'listening', level: 0 });

    void this.mic
      .startAuto({
        onSpeechStart: () => {
          this.hearing = true;
          this.handlers?.onActivity({ state: 'hearing' });
        },
        onSpeechEnd: () => {
          // Back to waiting for the mic indicator; the captured utterance
          // gets its OWN «recognizing…» placeholder in the stream.
          this.hearing = false;
          this.handlers?.onActivity({ state: 'listening', level: 0 });
        },
        onUtterance: (audio) => void this.process(audio)
      })
      .catch((error: unknown) => {
        handlers.onError(
          error instanceof DOMException && error.name === 'NotAllowedError'
            ? 'microphone blocked — allow it in the address bar'
            : `microphone unavailable: ${
                error instanceof Error ? error.message : String(error)
              }`
        );
      });
  }

  private async process(audio: Float32Array): Promise<void> {
    // Placeholder up FRONT (before the await) so the queue is visible.
    const fill = this.handlers?.onCapture(audio);

    try {
      // No forced language — Whisper hears whichever language is spoken.
      const text = (await this.worker.transcribe(audio, undefined, this.model)).trim();

      fill?.(text);
    } catch (error) {
      console.error('[transcribe] failed:', error);
      fill?.('');
    }
  }

  public translate(from: string, to: string, text: string): Promise<string> {
    return this.worker.translate(from, to, text);
  }

  public setPaused(paused: boolean): void {
    this.mic.setAutoPaused(paused);
    this.handlers?.onActivity(
      paused ? { state: 'idle' } : { state: 'listening', level: 0 }
    );
  }

  public stop(): void {
    this.mic.onLevel = null;
    this.mic.stopAuto();
    this.handlers?.onActivity({ state: 'idle' });
    this.handlers = null;
  }
}

let cachedTranscribe: TranscribeEngine | null = null;

export function getTranscribeEngine(): TranscribeEngine {
  return (cachedTranscribe ??= new TranscribeEngineImpl());
}

// ---- Streaming transcription source: Chrome, else Vosk ------------
//
// Live captions: text appears AS you speak (no waiting for the phrase like
// Whisper). Both need a FIXED language (no auto-detect). We pick Chrome's
// Web Speech when available (instant, no download, but online) and fall back
// to Vosk (offline, ~40 MB/language). Both reuse the recognizers already
// built for the translators.

export interface StreamingSource {
  /** Honest active-engine name for the status line. */
  name: string;
  /** True for Vosk (one-time model download); false for Chrome. */
  needsDownload: boolean;
  downloadHint?: string;
  /** Languages this source supports, if limited (Vosk); absent = all. */
  langs?: readonly string[];
  check(): { ok: boolean; reason?: string };
  isReady(): Promise<boolean>;
  prepare(
    onProgress: (progress: PrepareProgress) => void,
    lang: string
  ): Promise<void>;
  start(lang: string, handlers: RecognizerHandlers): void;
  setPaused(paused: boolean): void;
  stop(): void;
}

class ChromeStreaming implements StreamingSource {
  private rec = new OnlineRecognizer();
  public readonly name = 'Chrome (Web Speech)';
  public readonly needsDownload = false;

  public check(): { ok: boolean; reason?: string } {
    return speechRecognitionSupported()
      ? { ok: true }
      : {
          ok: false,
          reason: 'streaming needs Chrome or Edge (speech recognition)'
        };
  }

  public isReady(): Promise<boolean> {
    return Promise.resolve(true);
  }

  public prepare(): Promise<void> {
    return Promise.resolve();
  }

  public start(lang: string, handlers: RecognizerHandlers): void {
    this.rec.start(lang, handlers);
  }

  public setPaused(paused: boolean): void {
    this.rec.setPaused(paused);
  }

  public stop(): void {
    this.rec.stop();
  }
}

class VoskStreaming implements StreamingSource {
  private engine = new VoskEngine();
  private mic = new LiveTalkMic();
  private rec = new VoskRecognizer(this.engine, this.mic);
  private readyFlag = 'ap-vosk-pack-ready-v1';

  public readonly name = 'Vosk (offline)';
  public readonly needsDownload = true;
  public readonly downloadHint = '~40 MB per language';
  public readonly langs = VOSK_LANGS;

  public check(): { ok: boolean; reason?: string } {
    return voskSupport();
  }

  public async isReady(): Promise<boolean> {
    // Vosk models live in the HTTP cache (not transformers-cache), so the
    // flag alone is the hint; a cleared cache just re-downloads on start.
    try {
      return localStorage.getItem(this.readyFlag) === '1';
    } catch {
      return false;
    }
  }

  public async prepare(
    onProgress: (progress: PrepareProgress) => void,
    lang: string
  ): Promise<void> {
    requestPersistentStorage();
    onProgress({ message: 'preparing Vosk streaming model…', fraction: null });
    await this.engine.loadModel(lang);

    try {
      localStorage.setItem(this.readyFlag, '1');
    } catch {
      // A blocked localStorage never breaks the tool.
    }
  }

  public start(lang: string, handlers: RecognizerHandlers): void {
    this.rec.start(lang, handlers);
  }

  public setPaused(paused: boolean): void {
    this.rec.setPaused(paused);
  }

  public stop(): void {
    this.rec.stop();
  }
}

let cachedStreaming: StreamingSource | null = null;

/** Chrome's Web Speech when available, else offline Vosk. */
export function getStreamingSource(): StreamingSource {
  return (cachedStreaming ??= speechRecognitionSupported()
    ? new ChromeStreaming()
    : new VoskStreaming());
}

// ---- Factory ------------------------------------------------------

let cachedOnline: TurnPair | null = null;
let cachedVosk: TurnPair | null = null;
const cachedPairs = new Map<string, TurnPair>();

/** Predefined pairs, one per Turn page. `data-pair` on the page's <body>
 *  chooses which. Default: online (the ready template). */
export function getTurnPair(id: string | undefined): TurnPair {
  if (id === 'stream') {
    return (cachedVosk ??= makeVoskPair());
  }

  if (id === 'offline') {
    return getCached('offline', {
      id: 'turn-two-button-offline',
      name: 'Whisper (base) × Marian OPUS-MT — offline',
      // asrModel omitted → worker default (Xenova/whisper-base, ~80 MB).
      readyFlag: 'ap-offline-pack-ready-v1',
      downloadHint: '~80 MB + translation'
    });
  }

  if (id === 'offline-small') {
    return getCached('offline-small', {
      id: 'turn-two-button-offline-small',
      name: 'Whisper (small) × Marian OPUS-MT — offline · hard terms',
      asrModel: 'Xenova/whisper-small', // ~250 MB, slower, most accurate
      readyFlag: 'ap-offline-pack-ready-small-v1',
      downloadHint: '~250 MB + translation'
    });
  }

  return (cachedOnline ??= makeOnlinePair());
}

function getCached(key: string, config: OfflinePairConfig): TurnPair {
  let pair = cachedPairs.get(key);

  if (!pair) {
    pair = makeOfflinePair(config);
    cachedPairs.set(key, pair);
  }

  return pair;
}
