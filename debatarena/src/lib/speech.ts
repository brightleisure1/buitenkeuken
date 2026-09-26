"use client";

/**
 * Speelt zinnen achter elkaar af. Zinnen komen binnen terwijl de tekst nog streamt;
 * de volgende zin wordt alvast opgehaald terwijl de huidige speelt.
 */
export class SpeechQueue {
  private items: { load: () => Promise<string | null>; url?: Promise<string | null> }[] = [];
  private audio: HTMLAudioElement | null = null;
  private playing = false;
  private ctrl = new AbortController();
  private idleWaiters: (() => void)[] = [];
  private objectUrls: string[] = [];
  rate = 1;
  onError?: (msg: string) => void;

  /** Zin laten uitspreken via de server (ElevenLabs, gecachet per bericht). */
  say(p: { runId: string; messageId: string; idx: number; text: string; voiceId: string }) {
    const signal = this.ctrl.signal;
    this.push(async () => {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
        signal,
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        this.onError?.(d.error ?? "De stem haperde.");
        return null;
      }
      const url = URL.createObjectURL(await res.blob());
      this.objectUrls.push(url);
      return url;
    });
  }

  /** Bestaande audio (replay) afspelen. */
  playUrl(url: string) {
    this.push(async () => url);
  }

  private push(load: () => Promise<string | null>) {
    this.items.push({ load });
    // Alvast de eerstvolgende twee ophalen.
    this.items.slice(0, 2).forEach((it) => (it.url ??= it.load().catch(() => null)));
    if (!this.playing) void this.loop();
  }

  private gen = 0;

  private async loop() {
    const gen = this.gen;
    this.playing = true;
    while (this.items.length) {
      const it = this.items[0];
      it.url ??= it.load().catch(() => null);
      if (this.items[1]) this.items[1].url ??= this.items[1].load().catch(() => null);
      const url = await it.url;
      if (gen !== this.gen) return; // gestopt; een nieuwe lus neemt het over
      this.items.shift();
      if (!url) continue;
      await new Promise<void>((resolve) => {
        const a = new Audio(url);
        a.playbackRate = this.rate;
        this.audio = a;
        a.onended = () => resolve();
        a.onerror = () => resolve();
        a.onpause = () => {
          if (a.ended || this.audio !== a) resolve();
        };
        a.play().catch(() => resolve());
      });
      this.audio = null;
      if (gen !== this.gen) return;
    }
    this.playing = false;
    this.idleWaiters.splice(0).forEach((f) => f());
  }

  setRate(r: number) {
    this.rate = r;
    if (this.audio) this.audio.playbackRate = r;
  }

  get busy() {
    return this.playing || this.items.length > 0;
  }

  /** Wacht tot alles is uitgesproken. */
  idle(): Promise<void> {
    if (!this.busy) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  /** Direct afkappen. */
  stop() {
    this.gen++;
    this.ctrl.abort();
    this.ctrl = new AbortController();
    this.items = [];
    if (this.audio) {
      const a = this.audio;
      this.audio = null;
      a.pause();
      a.dispatchEvent(new Event("pause"));
    }
    this.playing = false;
    this.idleWaiters.splice(0).forEach((f) => f());
    this.objectUrls.splice(0).forEach((u) => setTimeout(() => URL.revokeObjectURL(u), 1000));
  }
}
