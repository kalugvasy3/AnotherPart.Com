/**
 * Minimal ambient typings for `phonemize` (MIT) — a pure-JS grapheme→phoneme
 * library. Our own file so tsc compiles BEFORE `npm i phonemize` lands in
 * node_modules; the real package ships its own types.
 *
 * `phonemize/all` registers every language processor (English is mature,
 * Russian approximate — the two that matter for us) and re-exports `toIPA`.
 */
declare module 'phonemize/all' {
  export function toIPA(
    text: string,
    options?: string | Record<string, unknown>
  ): string;
}

declare module 'phonemize' {
  export function toIPA(
    text: string,
    options?: string | Record<string, unknown>
  ): string;
}
