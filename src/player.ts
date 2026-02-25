import Hls from 'hls.js';
import { config } from './config';

const DEFAULT_POOL_SIZE = 6;

interface PoolEntry {
  video: HTMLVideoElement;
  hls: Hls | null;
  ready: boolean;
}

/**
 * Pooled video player that pre-buffers multiple clips ahead of time.
 * On each beat-cut, it promotes the next ready clip and starts
 * loading a new one at the back of the queue.
 */
export class VideoPlayer {
  private container: HTMLElement;
  private poolSize: number;
  private pool: PoolEntry[] = [];
  private activeIndex = 0;
  private clips: string[] = [];
  private clipCursor = 0;
  private beats: number[] = [];
  private beatIndex = 0;
  private nextCutBeat = 0;
  private audioStartTime = 0;
  private audioCtx: AudioContext | null = null;
  private rafId = 0;
  private running = false;

  onSwap: (() => void) | null = null;

  constructor(container: HTMLElement, poolSize = DEFAULT_POOL_SIZE) {
    this.container = container;
    this.poolSize = poolSize;
  }

  get activeVideo(): HTMLVideoElement | null {
    return this.pool[this.activeIndex]?.video ?? null;
  }

  private createEntry(): PoolEntry {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.loop = true;
    v.className = 'clip';
    v.style.visibility = 'hidden';
    this.container.appendChild(v);
    return { video: v, hls: null, ready: false };
  }

  init(allClips: string[], beats: number[], audioCtx: AudioContext) {
    this.audioCtx = audioCtx;
    this.beats = beats;

    const shuffled = [...allClips].sort(() => Math.random() - 0.5);
    this.clips = shuffled.slice(0, Math.min(config.clipCount, shuffled.length));
    this.clipCursor = 0;
    this.beatIndex = 0;
    this.nextCutBeat = this.rollCutLength();

    // Create pool and start preloading all slots
    for (let i = 0; i < this.poolSize; i++) {
      const entry = this.createEntry();
      this.pool.push(entry);
      this.loadEntry(entry, this.advanceClip());
    }

    // Show the first one immediately
    this.activeIndex = 0;
    this.pool[0].video.style.visibility = 'visible';
  }

  private advanceClip(): string {
    const clip = this.clips[this.clipCursor % this.clips.length];
    this.clipCursor++;
    return clip;
  }

  private loadEntry(entry: PoolEntry, clipUrl: string) {
    const url = clipUrl.startsWith('http') ? clipUrl : `/clips/${clipUrl}`;
    const video = entry.video;
    video.crossOrigin = 'anonymous';
    entry.ready = false;

    // Destroy previous HLS instance
    if (entry.hls) {
      entry.hls.destroy();
      entry.hls = null;
    }

    const onReady = () => {
      entry.ready = true;
      video.play().catch(() => {});
    };

    if (url.endsWith('.m3u8') && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: false, maxBufferLength: 10 });
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (video.duration > 2) {
          video.currentTime = Math.random() * (video.duration - 2);
        }
        onReady();
      });
      entry.hls = hls;
    } else if (url.endsWith('.m3u8') && video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      video.load();
      video.addEventListener('loadedmetadata', () => {
        if (video.duration > 2) {
          video.currentTime = Math.random() * (video.duration - 2);
        }
        onReady();
      }, { once: true });
    } else {
      video.src = url;
      video.load();
      video.addEventListener('loadedmetadata', () => {
        if (video.duration > 2) {
          video.currentTime = Math.random() * (video.duration - 2);
        }
        onReady();
      }, { once: true });
    }
  }

  start(audioStartTime: number) {
    this.audioStartTime = audioStartTime;
    this.running = true;
    this.pool[this.activeIndex].video.play().catch(() => {});
    this.tick();
  }

  pause() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    for (const entry of this.pool) {
      entry.video.pause();
    }
  }

  resume() {
    this.running = true;
    this.pool[this.activeIndex].video.play().catch(() => {});
    this.tick();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    for (const entry of this.pool) {
      entry.video.pause();
      if (entry.hls) entry.hls.destroy();
    }
  }

  private rollCutLength(): number {
    const weights = config.cutWeights;
    const totalWeight = weights.reduce((sum, [, w]) => sum + w, 0);
    let roll = Math.random() * totalWeight;
    for (const [beats, weight] of weights) {
      roll -= weight;
      if (roll <= 0) return beats;
    }
    return weights[0][0];
  }

  private tick = () => {
    if (!this.running || !this.audioCtx) return;

    const elapsed = this.audioCtx.currentTime - this.audioStartTime;

    while (this.beatIndex < this.beats.length && elapsed >= this.beats[this.beatIndex]) {
      this.beatIndex++;
      this.nextCutBeat--;

      if (this.nextCutBeat <= 0) {
        this.nextCutBeat = this.rollCutLength();
        this.swap();
      }
    }

    this.rafId = requestAnimationFrame(this.tick);
  };

  private swap() {
    const current = this.pool[this.activeIndex];
    const nextIndex = (this.activeIndex + 1) % this.poolSize;
    const next = this.pool[nextIndex];

    // Hide current, show next (only if it's ready — otherwise skip this cut)
    if (!next.ready) return;

    current.video.style.visibility = 'hidden';
    next.video.style.visibility = 'visible';
    next.video.play().catch(() => {});

    // Recycle the old active: load a new clip into it
    this.loadEntry(current, this.advanceClip());

    this.activeIndex = nextIndex;
    this.onSwap?.();
  }
}
