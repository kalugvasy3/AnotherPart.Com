/**
 * Minimal ambient typings for `vosk-browser` (Apache-2.0), verified against
 * lib/src/model.ts of ccoreilly/vosk-browser@0.0.8.
 *
 * Ported from AnotherPart.Me. Why our own file: tsc must compile BEFORE the
 * real package (which ships its own d.ts) lands in node_modules — the engine
 * is installed separately (`npm i vosk-browser`) and imported dynamically.
 * Keep in sync with the real API if the dependency is ever bumped.
 */
declare module 'vosk-browser' {
  export interface VoskRecognizerResultMessage {
    event: string;
    recognizerId?: string;
    result?: {
      text?: string;
      result?: Array<{
        conf: number;
        start: number;
        end: number;
        word: string;
      }>;
    };
  }

  export interface VoskRecognizerPartialMessage {
    event: string;
    recognizerId?: string;
    result?: {
      partial?: string;
    };
  }

  export interface VoskKaldiRecognizer {
    id: string;
    on(
      event: 'result',
      listener: (message: VoskRecognizerResultMessage) => void
    ): void;
    on(
      event: 'partialresult',
      listener: (message: VoskRecognizerPartialMessage) => void
    ): void;
    setWords(words: boolean): void;
    acceptWaveform(buffer: AudioBuffer): void;
    acceptWaveformFloat(buffer: Float32Array, sampleRate: number): void;
    retrieveFinalResult(): void;
    remove(): void;
  }

  export interface Model {
    ready: boolean;
    KaldiRecognizer: new (
      sampleRate: number,
      grammar?: string
    ) => VoskKaldiRecognizer;
    setLogLevel(level: number): void;
    terminate(): void;
    on(event: string, listener: (message: unknown) => void): void;
  }

  export function createModel(
    modelUrl: string,
    logLevel?: number
  ): Promise<Model>;
}
