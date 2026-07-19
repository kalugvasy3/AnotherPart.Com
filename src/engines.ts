/**
 * Shared engine plumbing for .Com tools — the recognizers and
 * translators live here; every tool page is a PREDEFINED pair of
 * them (the user picks a tool, never assembles engines).
 */

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
  picked: string
): void {
  for (const lang of LANGUAGES) {
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
