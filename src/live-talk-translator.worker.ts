/// <reference lib="webworker" />
//
// Live Talk translation worker: OPUS-MT (Marian) RU↔EN via transformers.js
// v2 (@xenova/transformers). v2 is chosen DELIBERATELY: the Xenova/opus-mt-*
// ONNX models were converted for v2, and the newer v4 runtime rejects their
// quantization format ("Missing required scale ... DequantizeLinear" session
// error, seen live 2026-07-04). v2 + these models is the battle-tested combo.
//
// Runs in a dedicated worker so inference never janks the render loop.
// WASM backend — works everywhere including iOS WebKit.
//
// Ported verbatim from AnotherPart.Me (anotherpart-angular-babylon-starter,
// src/app/core/live-talk/live-talk-translator.worker.ts) — this file is engine
// plumbing with no Angular ties, so it moves across as-is.
//
// Licenses: transformers.js — Apache-2.0; Marian/OPUS-MT code — MIT; OPUS-MT
// model weights — CC-BY-4.0 (attribution: Helsinki-NLP / OPUS). NLLB is
// deliberately NOT used (CC-BY-NC).
//
// Offline: model files are downloaded once from the Hugging Face hub and then
// cached (Cache API) — every later run, including fully offline, is local.

import { env, pipeline } from '@xenova/transformers';

// Models come from the hub, never from bundled local files.
env.allowLocalModels = false;

/**
 * Flexible pairs via the ENGLISH AXIS (matches the Road plan, 4.11/journal):
 * any→en and en→any models exist; a pair without English pivots through it
 * (ru↔tr = ru→en→tr). Verified against the HF hub 2026-07-04: all models
 * below exist as Xenova quantized ONNX. The ONE exception: there is no plain
 * en→tr model — English→Turkish goes through the multilingual en-mul model
 * with a target-language token (quality to be verified by ear).
 */
const TO_EN_MODELS: Record<string, string> = {
  ru: 'Xenova/opus-mt-ru-en',
  es: 'Xenova/opus-mt-es-en',
  tr: 'Xenova/opus-mt-tr-en',
  de: 'Xenova/opus-mt-de-en',
  fr: 'Xenova/opus-mt-fr-en',
  it: 'Xenova/opus-mt-it-en',
  uk: 'Xenova/opus-mt-uk-en'
};

const FROM_EN_MODELS: Record<string, { model: string; prefix?: string }> = {
  ru: { model: 'Xenova/opus-mt-en-ru' },
  es: { model: 'Xenova/opus-mt-en-es' },
  tr: { model: 'Xenova/opus-mt-en-mul', prefix: '>>tur<< ' },
  de: { model: 'Xenova/opus-mt-en-de' },
  fr: { model: 'Xenova/opus-mt-en-fr' },
  it: { model: 'Xenova/opus-mt-en-it' },
  uk: { model: 'Xenova/opus-mt-en-uk' }
};

function modelsForPair(a: string, b: string): string[] {
  const models = new Set<string>();

  for (const lang of [a, b]) {
    if (lang === 'en') {
      continue;
    }

    const toEn = TO_EN_MODELS[lang];
    const fromEn = FROM_EN_MODELS[lang];

    if (!toEn || !fromEn) {
      throw new Error(`Unsupported language: ${lang}`);
    }

    models.add(toEn);
    models.add(fromEn.model);
  }

  return [...models];
}

/** Whisper (multilingual, quantized): speech → text, any of our pair
 *  languages; the language itself is then detected from the script.
 *  The MODEL is the caller's choice — measured live (2026-07-04):
 *  tiny ≈ 2.1 s/фраза but mangles Russian; base ≈ 3× slower but accurate.
 *  Accuracy matters more for the doctor-visit scenario, speed for chat. */
const DEFAULT_ASR_MODEL = 'Xenova/whisper-base';

type LoadRequest = { type: 'load'; a: string; b: string };

type LoadAsrRequest = { type: 'load-asr'; model?: string };

type TranslateRequest = {
  type: 'translate';
  id: number;
  from: string;
  to: string;
  text: string;
};

type TranscribeRequest = {
  type: 'transcribe';
  id: number;
  audio: Float32Array;
  model?: string;
  /** Force the decode language (e.g. 'english') — used as a retry when the
   *  auto-detected script falls outside the RU↔EN pair (accented English
   *  gets misheard as Polish/Hebrew). */
  language?: string;
};

type WorkerRequest =
  | LoadRequest
  | LoadAsrRequest
  | TranslateRequest
  | TranscribeRequest;

type TranslatorOutput = { translation_text?: string };

type TranslatorFn = (
  text: string
) => Promise<TranslatorOutput | TranslatorOutput[]>;

/** Keyed by MODEL name — models are shared between pairs. */
const translators = new Map<string, TranslatorFn>();

let loadPromise: Promise<void> | null = null;
let loadedPairKey = '';

function postProgress(
  model: string,
  file: string,
  loaded: number,
  total: number
): void {
  postMessage({
    type: 'progress',
    model,
    file,
    loaded,
    total
  });
}

async function loadModel(model: string): Promise<void> {
  if (translators.has(model)) {
    return;
  }

  const translator = (await pipeline('translation', model, {
    // v2 default: *_quantized.onnx (~40–80 MB per model vs ~300 MB fp32).
    quantized: true,
    progress_callback: (event: unknown) => {
      const p = event as {
        status?: string;
        file?: string;
        loaded?: number;
        total?: number;
      };

      if (p.status === 'progress' && p.file && p.total) {
        postProgress(model, p.file, p.loaded ?? 0, p.total);
      }
    }
  })) as unknown as TranslatorFn;

  translators.set(model, translator);
}

async function handleLoad(a: string, b: string): Promise<void> {
  const key = [a, b].sort().join('-');

  if (loadedPairKey !== key) {
    loadedPairKey = key;
    loadPromise = null;
  }

  loadPromise ??= (async () => {
    for (const model of modelsForPair(a, b)) {
      await loadModel(model);
    }
  })();

  await loadPromise;
}

type AsrFn = (
  audio: Float32Array,
  options?: Record<string, unknown>
) => Promise<{ text?: string }>;

let asr: AsrFn | null = null;
let asrLoadPromise: Promise<void> | null = null;
let asrLoadedModel = '';

async function handleLoadAsr(model: string): Promise<void> {
  // Switching quality (tiny ↔ base) drops the old pipeline and loads anew.
  if (asrLoadedModel !== model) {
    asr = null;
    asrLoadPromise = null;
    asrLoadedModel = model;
  }

  asrLoadPromise ??= (async () => {
    asr = (await pipeline('automatic-speech-recognition', model, {
      quantized: true,
      progress_callback: (event: unknown) => {
        const p = event as {
          status?: string;
          file?: string;
          loaded?: number;
          total?: number;
        };

        if (p.status === 'progress' && p.file && p.total) {
          postProgress(model, p.file, p.loaded ?? 0, p.total);
        }
      }
    })) as unknown as AsrFn;
  })();

  await asrLoadPromise;
}

async function handleTranscribe(request: TranscribeRequest): Promise<void> {
  await handleLoadAsr(request.model ?? DEFAULT_ASR_MODEL);

  if (!asr) {
    throw new Error('ASR pipeline unavailable');
  }

  console.log(
    `[live-talk-worker] transcribe: ${request.audio.length} samples`
  );

  // Default: no forced language — Whisper hears whichever side is speaking;
  // the direction is then chosen from the script of the transcribed text.
  //
  // no_repeat_ngram_size: Whisper loops on long/repetitive/looping audio
  // («три, продам, три, продам…» filling the screen, 2026-07-20) — a runaway
  // that also blocks the single Marian translator behind it. Banning any
  // repeated 3-gram breaks the loop at the source. transformers.js v2 has no
  // compression/no-speech decode thresholds, so this is the available lever.
  const options: Record<string, unknown> = {
    task: 'transcribe',
    no_repeat_ngram_size: 3
  };

  if (request.language) {
    options['language'] = request.language;
  }

  // Whisper natively processes a single 30 s window; longer recordings must
  // be chunked or everything past 30 s is SILENTLY dropped (seen live:
  // a 112 s recording came back as one word).
  if (request.audio.length > 30 * 16000) {
    options['chunk_length_s'] = 30;
    options['stride_length_s'] = 5;
  }

  const output = await asr(request.audio, options);

  console.log('[live-talk-worker] whisper output:', JSON.stringify(output));

  postMessage({
    type: 'transcription',
    id: request.id,
    text: output?.text ?? ''
  });
}

/**
 * Marian reliably translates ONE sentence at a time — fed a paragraph it
 * often stops after the first sentence (seen live: «Раз, два, три. Скажи
 * что-нибудь…» → "One, two, three."). So: split, translate, rejoin.
 */
function splitIntoSentences(text: string): string[] {
  const parts = text.match(/[^.!?…]+[.!?…]+["»)\]]?\s*|[^.!?…]+$/g) ?? [text];

  const sentences = parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  // Online recognition returns UNPUNCTUATED run-ons (Vasily, 2026-07-06:
  // a video monologue → one "sentence" of 60+ words → Marian truncated the
  // translation to a stub). Anything overlong is chopped by WORD COUNT —
  // clause boundaries are lost anyway without punctuation, and a slightly
  // choppy translation beats a silently amputated one.
  const MAX_WORDS = 30;
  const chunks: string[] = [];

  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).filter((word) => word.length > 0);

    if (words.length <= MAX_WORDS) {
      chunks.push(sentence);
      continue;
    }

    // Even pieces close to MAX_WORDS (avoids a tiny orphan tail).
    const pieceCount = Math.ceil(words.length / MAX_WORDS);
    const pieceSize = Math.ceil(words.length / pieceCount);

    for (let i = 0; i < words.length; i += pieceSize) {
      chunks.push(words.slice(i, i + pieceSize).join(' '));
    }
  }

  return chunks;
}

async function handleTranslate(request: TranslateRequest): Promise<void> {
  await handleLoad(request.from, request.to);

  // Translation chain: source→en (unless source IS en), then en→target
  // (unless target IS en). A pair without English pivots in two hops.
  const steps: { model: string; prefix?: string }[] = [];

  if (request.from !== 'en') {
    steps.push({ model: TO_EN_MODELS[request.from] });
  }

  if (request.to !== 'en') {
    steps.push(FROM_EN_MODELS[request.to]);
  }

  const translated: string[] = [];

  for (const sentence of splitIntoSentences(request.text)) {
    let current = sentence;

    for (const step of steps) {
      const translator = translators.get(step.model);

      if (!translator) {
        throw new Error(`Model not loaded: ${step.model}`);
      }

      const output = await translator((step.prefix ?? '') + current);
      const first = Array.isArray(output) ? output[0] : output;

      current = (first?.translation_text ?? '').trim();
    }

    translated.push(current);
  }

  postMessage({
    type: 'translation',
    id: request.id,
    text: translated.filter((part) => part.length > 0).join(' ')
  });
}

onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  if (request.type === 'load') {
    handleLoad(request.a, request.b)
      .then(() => postMessage({ type: 'ready' }))
      .catch((error: unknown) => {
        // A failed load must not poison future retries.
        loadPromise = null;
        loadedPairKey = '';

        postMessage({
          type: 'load-error',
          message: error instanceof Error ? error.message : String(error)
        });
      });
    return;
  }

  if (request.type === 'load-asr') {
    handleLoadAsr(request.model ?? DEFAULT_ASR_MODEL)
      .then(() => postMessage({ type: 'asr-ready' }))
      .catch((error: unknown) => {
        // A failed load must not poison future retries.
        asrLoadPromise = null;
        asrLoadedModel = '';

        postMessage({
          type: 'asr-load-error',
          message: error instanceof Error ? error.message : String(error)
        });
      });
    return;
  }

  if (request.type === 'translate') {
    handleTranslate(request).catch((error: unknown) =>
      postMessage({
        type: 'translation-error',
        id: request.id,
        message: error instanceof Error ? error.message : String(error)
      })
    );
    return;
  }

  if (request.type === 'transcribe') {
    handleTranscribe(request).catch((error: unknown) =>
      postMessage({
        type: 'transcription-error',
        id: request.id,
        message: error instanceof Error ? error.message : String(error)
      })
    );
  }
};
