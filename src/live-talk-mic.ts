/**
 * Live Talk microphone capture — 16 kHz mono Float32Array, exactly what
 * Whisper expects. Continuous capture with an energy VAD cuts utterances
 * automatically (adaptive noise floor + «умные ножницы»).
 *
 * Ported from AnotherPart.Me (live-talk-mic.service.ts). Angular removed:
 * the `@Injectable` decorator and the reactive `level` signal are gone —
 * this is a plain class, and the live input level is delivered through an
 * `onLevel` callback instead. Everything else is the battle-tested original.
 *
 * Decoding goes through a plain AudioContext at the device rate and is then
 * resampled manually; relying on `new AudioContext({sampleRate:16000})` to
 * resample decodeAudioData output is NOT portable across WebKit versions.
 */
export class LiveTalkMic {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  /** Live input level 0..1 while recording — "am I even being heard?".
   *  (Was an Angular signal in .Me; now a plain callback.) */
  public onLevel: ((level: number) => void) | null = null;
  private levelContext: AudioContext | null = null;
  private levelRaf = 0;

  private setLevel(level: number): void {
    this.onLevel?.(level);
  }

  public isSupported(): boolean {
    return (
      typeof MediaRecorder !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia
    );
  }

  /**
   * Explicit input device (Vasily, 2026-07-05): with an iPhone paired via
   * Continuity, macOS silently prefers the iPhone microphone — the user must
   * be able to pin the input. `null` = system default.
   */
  private preferredDeviceId: string | null = null;

  public setInputDevice(deviceId: string | null): void {
    this.preferredDeviceId = deviceId;
  }

  private buildAudioConstraints(): MediaTrackConstraints {
    const constraints: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true
    };

    if (this.preferredDeviceId) {
      // `exact`: if the pinned device is gone, FAIL instead of silently
      // recording from the wrong mic (that is the whole point).
      constraints.deviceId = { exact: this.preferredDeviceId };
    }

    return constraints;
  }

  // ---- Auto conversation: continuous capture + energy VAD ----
  //
  // The mic stays open; utterances are cut automatically: speech starts when
  // the level rises above an adaptive noise floor (with a pre-roll so the
  // first syllable is not clipped) and ends after a stretch of silence.
  // While the app recognizes/translates/speaks, capture is PAUSED
  // (half-duplex) so the TTS voice does not trigger the detector.

  private static readonly AUTO_PREROLL_MS = 300;
  private static readonly AUTO_END_SILENCE_MS = 800;
  private static readonly AUTO_MIN_SPEECH_MS = 400;
  private static readonly AUTO_MAX_UTTERANCE_MS = 20000;
  private static readonly AUTO_WINDOW_MS = 30000;

  /**
   * «Умные ножницы» (Vasily, 2026-07-07): continuous speech (reading,
   * a video) has no 800ms pauses, so pieces used to grow to the hard
   * 20s cap — and a hard cap cuts MID-WORD, hurting both boundary words.
   * Instead, after SOFT_CUT_SPEECH_MS of speech a MICRO-dip (a breath,
   * a comma — far shorter than a real pause) is enough to close the
   * piece at a natural word boundary. Pieces come out ~8–12s; the 20s
   * hard cap remains only as a last resort (music/noise without dips).
   * Not shorter than 8s on purpose: Whisper takes accuracy from context,
   * tiny fragments recognize hard terms worse.
   */
  private static readonly AUTO_SOFT_CUT_SPEECH_MS = 8000;
  private static readonly AUTO_SOFT_CUT_DIP_MS = 250;

  private autoCtx: AudioContext | null = null;
  private autoStream: MediaStream | null = null;
  private autoSource: MediaStreamAudioSourceNode | null = null;
  private autoProcessor: ScriptProcessorNode | null = null;
  private autoGain: GainNode | null = null;

  private autoChunks: Float32Array[] = [];
  private autoVadState: 'waiting' | 'speech' = 'waiting';
  private autoPaused = false;
  private autoNoiseFloor = 0.01;
  private autoSpeechStartChunk = 0;
  private autoSilenceMs = 0;
  private autoSpeechMs = 0;

  private autoCallbacks: {
    onSpeechStart: () => void;
    onSpeechEnd: () => void;
    onUtterance: (audio: Float32Array) => void;
    /** Raw chunk tap for STREAMING recognizers (Vosk): every mic chunk at
     *  the device rate, synchronous — consume or copy immediately. */
    onChunk?: (chunk: Float32Array, sampleRate: number) => void;
  } | null = null;

  /**
   * User-set speech-start threshold as a FRACTION of the displayed level bar
   * (the red draggable line). Display gain is ×3, so bar fraction → rms is
   * fraction/3. Page rustling below the line never starts a recording.
   */
  private autoStartLevelFraction = 0.15;

  public setAutoStartThreshold(fraction: number): void {
    this.autoStartLevelFraction = Math.min(0.95, Math.max(0.02, fraction));
  }

  /** True when autoStream belongs to SOMEONE ELSE (the video call) —
   *  stopAuto must not stop their tracks (bridge, 2026-07-07). */
  private autoStreamExternal = false;

  public async startAuto(
    callbacks: {
      onSpeechStart: () => void;
      onSpeechEnd: () => void;
      onUtterance: (audio: Float32Array) => void;
      onChunk?: (chunk: Float32Array, sampleRate: number) => void;
    },
    /** Call-subtitles mode: feed recognition from the CALL's own audio
     *  track instead of opening a second microphone capture — the mic is
     *  managed by the Video call («микрофоном управляет VIDEO», Vasily,
     *  2026-07-08). The SAME track (not a clone) on purpose: the call's
     *  Mic on/off then governs the subtitles too. */
    externalStream?: MediaStream
  ): Promise<void> {
    if (this.autoCtx) {
      return;
    }

    if (externalStream) {
      this.autoStream = externalStream;
      this.autoStreamExternal = true;
    } else {
      this.autoStream = await navigator.mediaDevices.getUserMedia({
        audio: this.buildAudioConstraints()
      });
      this.autoStreamExternal = false;
    }

    this.autoCallbacks = callbacks;
    this.autoChunks = [];
    this.autoVadState = 'waiting';
    this.autoPaused = false;
    this.autoSilenceMs = 0;
    this.autoSpeechMs = 0;

    const ctx = new AudioContext();

    this.autoCtx = ctx;
    this.autoSource = ctx.createMediaStreamSource(this.autoStream);
    // ScriptProcessor: portable and sufficient at speech rates; it must be
    // wired to the destination through a zero gain to keep firing.
    this.autoProcessor = ctx.createScriptProcessor(4096, 1, 1);
    this.autoGain = ctx.createGain();
    this.autoGain.gain.value = 0;

    this.autoSource.connect(this.autoProcessor);
    this.autoProcessor.connect(this.autoGain);
    this.autoGain.connect(ctx.destination);

    this.autoProcessor.onaudioprocess = (event: AudioProcessingEvent): void => {
      this.handleAutoAudio(
        event.inputBuffer.getChannelData(0),
        ctx.sampleRate
      );
    };
  }

  public setAutoPaused(paused: boolean): void {
    this.autoPaused = paused;

    if (!paused) {
      // Fresh start after TTS: forget everything heard meanwhile.
      this.autoChunks = [];
      this.autoVadState = 'waiting';
      this.autoSilenceMs = 0;
      this.autoSpeechMs = 0;
    } else {
      this.setLevel(0);
    }
  }

  public stopAuto(): void {
    if (this.autoProcessor) {
      this.autoProcessor.onaudioprocess = null;
      this.autoProcessor.disconnect();
      this.autoProcessor = null;
    }

    this.autoSource?.disconnect();
    this.autoSource = null;
    this.autoGain?.disconnect();
    this.autoGain = null;

    if (this.autoCtx) {
      void this.autoCtx.close();
      this.autoCtx = null;
    }

    if (!this.autoStreamExternal) {
      // Our own capture — release the hardware. An EXTERNAL stream (the
      // video call's audio) is not ours to stop.
      this.autoStream?.getTracks().forEach((track) => track.stop());
    }

    this.autoStream = null;
    this.autoStreamExternal = false;
    this.autoCallbacks = null;
    this.autoChunks = [];
    this.setLevel(0);
  }

  private handleAutoAudio(data: Float32Array, sampleRate: number): void {
    if (this.autoPaused || !this.autoCallbacks) {
      return;
    }

    let sumSquares = 0;

    for (let i = 0; i < data.length; i++) {
      sumSquares += data[i] * data[i];
    }

    const rms = Math.sqrt(sumSquares / data.length);

    this.setLevel(Math.min(1, rms * 3));

    // Streaming tap first: Vosk wants EVERY chunk, VAD state is irrelevant.
    this.autoCallbacks.onChunk?.(data, sampleRate);

    this.autoChunks.push(new Float32Array(data));

    // Cap the rolling window.
    const chunkMs = (data.length / sampleRate) * 1000;
    const maxChunks = Math.ceil(
      LiveTalkMic.AUTO_WINDOW_MS / chunkMs
    );

    while (this.autoChunks.length > maxChunks) {
      this.autoChunks.shift();

      if (this.autoSpeechStartChunk > 0) {
        this.autoSpeechStartChunk--;
      }
    }

    if (this.autoVadState === 'waiting') {
      // Track the noise floor only while nobody speaks.
      this.autoNoiseFloor = this.autoNoiseFloor * 0.95 + rms * 0.05;

      const startThreshold = Math.max(
        0.02,
        this.autoNoiseFloor * 3,
        this.autoStartLevelFraction / 3
      );

      if (rms > startThreshold) {
        const preRollChunks = Math.ceil(
          (LiveTalkMic.AUTO_PREROLL_MS / 1000) * sampleRate / data.length
        );

        this.autoVadState = 'speech';
        this.autoSpeechStartChunk = Math.max(
          0,
          this.autoChunks.length - 1 - preRollChunks
        );
        this.autoSilenceMs = 0;
        this.autoSpeechMs = chunkMs;
        this.autoCallbacks.onSpeechStart();
      }

      return;
    }

    // In speech. NOTE (Vasily, 2026-07-04): the user's red line gates ONLY
    // the START of an utterance. The END is decided by this standard adaptive
    // silence logic and must NOT involve the line — otherwise a phrase that
    // trails off quietly would be cut short.
    this.autoSpeechMs += chunkMs;

    const endThreshold = Math.max(0.015, this.autoNoiseFloor * 2.5);

    if (rms < endThreshold) {
      this.autoSilenceMs += chunkMs;
    } else {
      this.autoSilenceMs = 0;
    }

    const softCut =
      this.autoSpeechMs >= LiveTalkMic.AUTO_SOFT_CUT_SPEECH_MS &&
      this.autoSilenceMs >= LiveTalkMic.AUTO_SOFT_CUT_DIP_MS;
    const hardCut =
      this.autoSpeechMs >= LiveTalkMic.AUTO_MAX_UTTERANCE_MS;

    const utteranceOver =
      this.autoSilenceMs >= LiveTalkMic.AUTO_END_SILENCE_MS ||
      softCut ||
      hardCut;

    if (!utteranceOver) {
      return;
    }

    if (softCut && !hardCut) {
      console.log(
        `[live-talk] mic: soft cut at ${(this.autoSpeechMs / 1000).toFixed(1)}s (breath dip)`
      );
    } else if (hardCut) {
      console.log(
        '[live-talk] mic: hard cut at 20s — no dip found (music/noise?)'
      );
    }

    const voicedMs = this.autoSpeechMs - this.autoSilenceMs;
    const utteranceChunks = this.autoChunks.slice(this.autoSpeechStartChunk);

    this.autoChunks = [];
    this.autoVadState = 'waiting';
    this.autoSilenceMs = 0;
    this.autoSpeechMs = 0;
    this.autoCallbacks.onSpeechEnd();

    if (voicedMs < LiveTalkMic.AUTO_MIN_SPEECH_MS) {
      return; // A click or a cough — not speech.
    }

    let total = 0;

    for (const chunk of utteranceChunks) {
      total += chunk.length;
    }

    const joined = new Float32Array(total);
    let offset = 0;

    for (const chunk of utteranceChunks) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }

    this.autoCallbacks.onUtterance(
      this.resampleLinear(joined, sampleRate, 16000)
    );
  }

  public isRecording(): boolean {
    return this.recorder !== null;
  }

  public async start(): Promise<void> {
    if (this.recorder) {
      return;
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: this.buildAudioConstraints()
    });

    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream);

    this.recorder.addEventListener('dataavailable', (event: BlobEvent) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    });

    this.recorder.start();
    this.startLevelMeter(this.stream);
  }

  private startLevelMeter(stream: MediaStream): void {
    try {
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();

      analyser.fftSize = 512;
      source.connect(analyser);

      this.levelContext = context;

      const data = new Uint8Array(analyser.fftSize);

      const tick = (): void => {
        analyser.getByteTimeDomainData(data);

        let sumSquares = 0;

        for (let i = 0; i < data.length; i++) {
          const centered = (data[i] - 128) / 128;
          sumSquares += centered * centered;
        }

        const rms = Math.sqrt(sumSquares / data.length);

        // ~3× gain so normal speech fills most of the bar.
        this.setLevel(Math.min(1, rms * 3));
        this.levelRaf = requestAnimationFrame(tick);
      };

      this.levelRaf = requestAnimationFrame(tick);
    } catch {
      // Meter is best-effort; recording works without it.
    }
  }

  private stopLevelMeter(): void {
    if (this.levelRaf) {
      cancelAnimationFrame(this.levelRaf);
      this.levelRaf = 0;
    }

    if (this.levelContext) {
      void this.levelContext.close();
      this.levelContext = null;
    }

    this.setLevel(0);
  }

  public async stop(): Promise<Float32Array> {
    const recorder = this.recorder;
    const stream = this.stream;

    this.recorder = null;
    this.stream = null;
    this.stopLevelMeter();

    if (!recorder) {
      throw new Error('Not recording');
    }

    const stopped = new Promise<void>((resolve) => {
      recorder.addEventListener('stop', () => resolve(), { once: true });
    });

    recorder.stop();
    await stopped;

    stream?.getTracks().forEach((track) => track.stop());

    const blob = new Blob(this.chunks, {
      type: recorder.mimeType || 'audio/webm'
    });

    this.chunks = [];

    return this.decodeTo16kMono(await blob.arrayBuffer());
  }

  /** Abort a recording without producing audio (e.g. panel closed). */
  public cancel(): void {
    const recorder = this.recorder;
    const stream = this.stream;

    this.recorder = null;
    this.stream = null;
    this.chunks = [];
    this.stopLevelMeter();

    try {
      recorder?.stop();
    } catch {
      // Already stopped.
    }

    stream?.getTracks().forEach((track) => track.stop());
  }

  private async decodeTo16kMono(buffer: ArrayBuffer): Promise<Float32Array> {
    const context = new AudioContext();

    try {
      const decoded = await context.decodeAudioData(buffer);
      const mono = this.mixToMono(decoded);

      return this.resampleLinear(mono, decoded.sampleRate, 16000);
    } finally {
      void context.close();
    }
  }

  private mixToMono(decoded: AudioBuffer): Float32Array {
    if (decoded.numberOfChannels === 1) {
      return decoded.getChannelData(0);
    }

    const length = decoded.length;
    const mono = new Float32Array(length);

    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const data = decoded.getChannelData(channel);

      for (let i = 0; i < length; i++) {
        mono[i] += data[i] / decoded.numberOfChannels;
      }
    }

    return mono;
  }

  private resampleLinear(
    input: Float32Array,
    fromRate: number,
    toRate: number
  ): Float32Array {
    if (fromRate === toRate) {
      return input;
    }

    const ratio = fromRate / toRate;
    const outputLength = Math.max(1, Math.round(input.length / ratio));
    const output = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const position = i * ratio;
      const index = Math.floor(position);
      const fraction = position - index;
      const a = input[index] ?? 0;
      const b = input[index + 1] ?? a;

      output[i] = a + (b - a) * fraction;
    }

    return output;
  }
}
