import { config } from './config';

/**
 * Double-buffer video player that cuts on the beat.
 *
 * Two <video> elements are stacked. While one plays visibly,
 * the other preloads the next clip. On each beat, they swap.
 */
export class VideoPlayer {
  private videoA: HTMLVideoElement;
  private videoB: HTMLVideoElement;
  private active: HTMLVideoElement;
  private standby: HTMLVideoElement;
  private clips: string[] = [];
  private clipIndex = 0;
  private beats: number[] = [];
  private beatIndex = 0;
  private nextCutBeat = 0;
  private audioStartTime = 0;
  private audioCtx: AudioContext | null = null;
  private rafId = 0;
  private running = false;

  constructor(container: HTMLElement) {
    this.videoA = this.createVideoElement();
    this.videoB = this.createVideoElement();
    container.appendChild(this.videoA);
    container.appendChild(this.videoB);

    this.active = this.videoA;
    this.standby = this.videoB;
  }

  private createVideoElement(): HTMLVideoElement {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.loop = true;
    v.className = 'clip';
    v.style.opacity = '0';
    return v;
  }

  /**
   * Initialize with clip filenames and beat timestamps.
   */
  init(allClips: string[], beats: number[], audioCtx: AudioContext) {
    this.audioCtx = audioCtx;
    this.beats = beats;

    // Randomly select clips for this session
    const shuffled = [...allClips].sort(() => Math.random() - 0.5);
    this.clips = shuffled.slice(0, Math.min(config.clipCount, shuffled.length));
    this.clipIndex = 0;
    this.beatIndex = 0;
    this.nextCutBeat = this.rollCutLength();

    // Preload first clip into the active element
    this.loadClip(this.active, this.nextClip());
    this.active.style.opacity = '1';

    // Preload second clip into standby
    this.loadClip(this.standby, this.nextClip());
  }

  private nextClip(): string {
    const clip = this.clips[this.clipIndex % this.clips.length];
    this.clipIndex++;
    return clip;
  }

  private loadClip(video: HTMLVideoElement, clipUrl: string) {
    // Support both full URLs (Mux) and local filenames
    video.src = clipUrl.startsWith('http') ? clipUrl : `/clips/${clipUrl}`;
    video.crossOrigin = 'anonymous';
    video.load();

    // Seek to a random point once loaded for variety
    video.addEventListener('loadedmetadata', () => {
      if (video.duration > 2) {
        video.currentTime = Math.random() * (video.duration - 2);
      }
      video.play().catch(() => {});
    }, { once: true });
  }

  /**
   * Start the beat-synced playback loop.
   */
  start(audioStartTime: number) {
    this.audioStartTime = audioStartTime;
    this.running = true;
    this.active.play().catch(() => {});
    this.tick();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.videoA.pause();
    this.videoB.pause();
  }

  /**
   * Pick a random cut length using weighted distribution from config.
   */
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

    // Advance through beats we've passed
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
    // Instant cut: hide active, show standby
    this.active.style.opacity = '0';
    this.standby.style.opacity = '1';
    this.standby.play().catch(() => {});

    // Swap references
    const prev = this.active;
    this.active = this.standby;
    this.standby = prev;

    // Preload next clip on the now-hidden element
    this.loadClip(this.standby, this.nextClip());
  }
}
