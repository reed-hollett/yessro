import './style.css';
import { config } from './config';
import { detectBeats } from './beat-detect';
import { VideoPlayer } from './player';
import { TrackingOverlay } from './tracking-overlay';
import { ThresholdOverlay } from './threshold-overlay';
import { DitherOverlay } from './dither-overlay';
import { initHeroDither } from './hero-dither';

const heroCanvas = document.getElementById('hero-canvas') as HTMLCanvasElement;
const playBtn = document.getElementById('play-btn')!;

// Render hero dither immediately on page load
initHeroDither(heroCanvas);
const loading = document.getElementById('loading')!;
const transport = document.getElementById('transport')!;
const transportPlaypause = document.getElementById('transport-playpause')!;
const transportTime = document.getElementById('transport-time')!;
const transportDuration = document.getElementById('transport-duration')!;
const transportTrack = document.getElementById('transport-track')!;
const transportProgress = document.getElementById('transport-progress')!;
const transportFx = document.getElementById('transport-fx')!;
const fxDialog = document.getElementById('fx-dialog')!;

let players: VideoPlayer[] = [];
let overlay: TrackingOverlay | null = null;
let threshold: ThresholdOverlay | null = null;
let dither: DitherOverlay | null = null;

let paused = false;

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function getLaneCount(): number {
  return 1;
}

playBtn.addEventListener('click', async () => {
  playBtn.classList.add('hidden');
  heroCanvas.classList.add('hidden');
  loading.style.display = 'block';

  try {
    // 1. Create audio context and unlock it (must be before any await on iOS)
    const audioCtx = new AudioContext();
    await audioCtx.resume();

    // Play a silent buffer to fully unlock audio on iOS
    const silent = audioCtx.createBuffer(1, 1, audioCtx.sampleRate);
    const silentSrc = audioCtx.createBufferSource();
    silentSrc.buffer = silent;
    silentSrc.connect(audioCtx.destination);
    silentSrc.start();

    // 2. Fetch and decode the song
    loading.textContent = 'Loading song...';
    const response = await fetch(config.songPath);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    // 3. Detect beats
    loading.textContent = 'Detecting beats...';
    const { beats } = detectBeats(audioBuffer);


    // 4. Fetch clip manifest
    loading.textContent = 'Loading clips...';
    const manifestRes = await fetch(config.manifestPath);
    const clips: string[] = await manifestRes.json();

    if (clips.length === 0) {
      throw new Error('No clips found. Run: npm run convert');
    }

    // 5. Initialize video player lanes
    const videoContainer = document.getElementById('video-container')!;
    videoContainer.innerHTML = '';
    const laneCount = getLaneCount();
    const poolPerLane = laneCount === 1 ? 6 : 4;
    players = [];

    const lanes: HTMLDivElement[] = [];
    for (let i = 0; i < laneCount; i++) {
      const lane = document.createElement('div');
      lane.className = 'video-lane';
      videoContainer.appendChild(lane);
      lanes.push(lane);
      const p = new VideoPlayer(lane, poolPerLane);
      p.init(clips, beats, audioCtx);
      players.push(p);
    }


    // 5b. Initialize overlays
    const app = document.getElementById('app')!;
    overlay = new TrackingOverlay(app);
    threshold = new ThresholdOverlay(app, players[0]);
    dither = new DitherOverlay(app, players[0]);

    // Lane visibility & saturation: randomly hide lanes and add color
    const shuffleLaneVisibility = () => {
      if (laneCount <= 1) return;
      const roll = Math.random();
      if (roll < 0.08) {
        // Rare: only 1 lane visible
        const keep = Math.floor(Math.random() * laneCount);
        lanes.forEach((l, i) => { l.style.opacity = i === keep ? '1' : '0'; });
      } else if (roll < 0.35) {
        // Sometimes: hide 1 lane
        const hide = Math.floor(Math.random() * laneCount);
        lanes.forEach((l, i) => { l.style.opacity = i === hide ? '0' : '1'; });
      } else {
        // Default: all visible
        lanes.forEach(l => { l.style.opacity = '1'; });
      }
    };

    // When any lane swaps, it becomes the active (saturated) one
    players.forEach((p, i) => {
      p.onSwap = () => {
        shuffleLaneVisibility();
        if (i === 0) {
          overlay?.shuffle();
          threshold?.shuffle();
          dither?.shuffle();
        }
      };
    });

    // 6. Start audio playback (cap at 2:03)
    if (audioCtx.state !== 'running') await audioCtx.resume();
    const maxDuration = 123; // 2:03
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioCtx.destination);
    const startTime = audioCtx.currentTime;
    source.start(startTime, 0, maxDuration);
    const duration = Math.min(audioBuffer.duration, maxDuration);
    transportDuration.textContent = formatTime(duration);
    transport.classList.add('visible');
    paused = false;
    transportPlaypause.innerHTML = '&#9616;&#9616;';

    // Transport progress loop
    let transportRaf = 0;
    const updateTransport = () => {
      if (!paused) {
        const elapsed = Math.min(audioCtx.currentTime - startTime, duration);
        transportTime.textContent = formatTime(elapsed);
        transportProgress.style.width = `${(elapsed / duration) * 100}%`;
      }
      transportRaf = requestAnimationFrame(updateTransport);
    };
    transportRaf = requestAnimationFrame(updateTransport);

    // Play/pause toggle
    const handlePlaypause = () => {
      if (paused) {
        audioCtx.resume();
        players.forEach(p => p.resume());
        transportPlaypause.innerHTML = '&#9616;&#9616;';
        paused = false;
      } else {
        audioCtx.suspend();
        players.forEach(p => p.pause());
        transportPlaypause.innerHTML = '&#9654;';
        paused = true;
      }
    };
    transportPlaypause.onclick = handlePlaypause;

    // Click on track to seek (visual only — Web Audio can't seek mid-stream)
    transportTrack.onclick = () => {};

    // 1-0,Q toggle effects
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === '1') toggleTrack();
      if (e.key === '2') toggleThresh();
      if (e.key === '3') toggleInvert();
      if (e.key === '4') toggleDither();
    };
    window.addEventListener('keydown', handleKey);

    // FX pad (mobile) + FX dialog (desktop)
    const fxPad = document.getElementById('fx-pad')!;
    const padBtns = fxPad.querySelectorAll<HTMLButtonElement>('.pad-btn');

    // FX button: keyboard dialog on desktop only
    transportFx.onclick = () => {
      fxDialog.classList.toggle('visible');
      transportFx.classList.toggle('active');
    };

    const toggleTrack = () => {
      overlay?.toggle();
      padBtns[0].classList.toggle('active');
    };
    const toggleThresh = () => {
      threshold?.toggle();
      padBtns[1].classList.toggle('active');
    };
    const toggleInvert = () => {
      videoContainer.classList.toggle('invert');
      padBtns[2].classList.toggle('active');
    };
    const toggleDither = () => {
      dither?.toggle();
      padBtns[3].classList.toggle('active');
    };
    padBtns[0].onclick = toggleTrack;
    padBtns[1].onclick = toggleThresh;
    padBtns[2].onclick = toggleInvert;
    padBtns[3].onclick = toggleDither;

    // Default on: tracking (1), threshold (2), dither (4)
    toggleTrack();
    toggleThresh();
    toggleDither();

    // Stop everything when song ends
    source.onended = () => {
      cancelAnimationFrame(transportRaf);
      players.forEach(p => p.stop());
      overlay?.destroy();
      threshold?.destroy();
      dither?.destroy();
      overlay = null;
      threshold = null;
      dither = null;
      videoContainer.classList.remove('invert');
      window.removeEventListener('keydown', handleKey);
      padBtns.forEach(b => { b.classList.remove('active'); b.onclick = null; });
      transportFx.classList.remove('active');
      transportFx.onclick = null;
      fxDialog.classList.remove('visible');
      transport.classList.remove('visible');
      transportPlaypause.onclick = null;
      playBtn.classList.remove('hidden');
      playBtn.textContent = 'Replay';
      heroCanvas.classList.remove('hidden');
      initHeroDither(heroCanvas);
    };

    // 7. Start beat-synced video loop
    loading.style.display = 'none';
    players.forEach(p => p.start(startTime));

  } catch (err) {
    console.error('Startup error:', err);
    loading.textContent = `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
    playBtn.classList.remove('hidden');
  }
});
