import './style.css';
import { config } from './config';
import { detectBeats } from './beat-detect';
import { VideoPlayer } from './player';
import { TrackingOverlay } from './tracking-overlay';
import { ThresholdOverlay } from './threshold-overlay';

import { EdgeOverlay } from './edge-overlay';
import { TimecodeOverlay } from './timecode-overlay';
import { MosaicOverlay } from './mosaic-overlay';
import { StrobeOverlay } from './strobe-overlay';
import { ZoomOverlay } from './zoom-overlay';

const playBtn = document.getElementById('play-btn')!;
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

let edge: EdgeOverlay | null = null;
let timecode: TimecodeOverlay | null = null;
let mosaic: MosaicOverlay | null = null;
let strobe: StrobeOverlay | null = null;
let zoom: ZoomOverlay | null = null;
let paused = false;

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function getLaneCount(): number {
  const ratio = window.innerWidth / window.innerHeight;
  if (ratio >= 1.0) return 2;
  return 1;
}

playBtn.addEventListener('click', async () => {
  playBtn.classList.add('hidden');
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

    // Start with first lane at full saturation
    lanes[0]?.classList.add('active-lane');

    const setActiveLane = (index: number) => {
      lanes.forEach((l, j) => l.classList.toggle('active-lane', j === index));
    };

    // 5b. Initialize overlays
    const app = document.getElementById('app')!;
    overlay = new TrackingOverlay(app);
    threshold = new ThresholdOverlay(app, players[0]);
    edge = new EdgeOverlay(app, players[0]);
    mosaic = new MosaicOverlay(app, players[0]);
    strobe = new StrobeOverlay(app);
    zoom = new ZoomOverlay(app, players[0]);

    // When any lane swaps, it becomes the active (saturated) one
    players.forEach((p, i) => {
      p.onSwap = () => {
        setActiveLane(i);
        if (i === 0) {
          overlay?.shuffle();
          threshold?.shuffle();
          edge?.shuffle();
          mosaic?.shuffle();
          strobe?.flash();
          zoom?.shuffle();
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
    timecode = new TimecodeOverlay(app, audioCtx, startTime);

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
      if (e.key === '4') toggleEdge();
      if (e.key === '5') toggleTimecode();
      if (e.key === '6') toggleMosaic();
      if (e.key === '7') toggleStrobe();
      if (e.key === '8') togglePosterize();
      if (e.key === '9') toggleMirror();
      if (e.key === '0') toggleZoom();
    };
    window.addEventListener('keydown', handleKey);

    // Sidebar toggle helpers
    const sidebar = document.getElementById('sidebar')!;
    const sidebarBtns = sidebar.querySelectorAll<HTMLButtonElement>('.sidebar-btn');

    // FX button: sidebar on mobile, keyboard dialog on desktop
    const isMobile = () => window.innerWidth < 769;
    transportFx.onclick = () => {
      if (isMobile()) {
        sidebar.classList.toggle('visible');
        fxDialog.classList.remove('visible');
      } else {
        fxDialog.classList.toggle('visible');
        sidebar.classList.remove('visible');
      }
      transportFx.classList.toggle('active');
    };

    const toggleTrack = () => {
      overlay?.toggle();
      sidebarBtns[0].classList.toggle('active');
    };
    const toggleThresh = () => {
      threshold?.toggle();
      sidebarBtns[1].classList.toggle('active');
    };
    const toggleInvert = () => {
      videoContainer.classList.toggle('invert');
      sidebarBtns[2].classList.toggle('active');
    };
    const toggleEdge = () => {
      edge?.toggle();
      sidebarBtns[3].classList.toggle('active');
    };
    const toggleTimecode = () => {
      timecode?.toggle();
      sidebarBtns[4].classList.toggle('active');
    };
    const toggleMosaic = () => {
      mosaic?.toggle();
      sidebarBtns[5].classList.toggle('active');
    };
    const toggleStrobe = () => {
      strobe?.toggle();
      sidebarBtns[6].classList.toggle('active');
    };
    const togglePosterize = () => {
      videoContainer.classList.toggle('posterize');
      sidebarBtns[7].classList.toggle('active');
    };
    const toggleMirror = () => {
      videoContainer.classList.toggle('mirror');
      sidebarBtns[8].classList.toggle('active');
    };
    const toggleZoom = () => {
      zoom?.toggle();
      sidebarBtns[9].classList.toggle('active');
    };

    sidebarBtns[0].onclick = toggleTrack;
    sidebarBtns[1].onclick = toggleThresh;
    sidebarBtns[2].onclick = toggleInvert;
    sidebarBtns[3].onclick = toggleEdge;
    sidebarBtns[4].onclick = toggleTimecode;
    sidebarBtns[5].onclick = toggleMosaic;
    sidebarBtns[6].onclick = toggleStrobe;
    sidebarBtns[7].onclick = togglePosterize;
    sidebarBtns[8].onclick = toggleMirror;
    sidebarBtns[9].onclick = toggleZoom;

    // Default on: tracking (1), threshold (2)
    toggleTrack();
    toggleThresh();

    // Stop everything when song ends
    source.onended = () => {
      cancelAnimationFrame(transportRaf);
      players.forEach(p => p.stop());
      overlay?.destroy();
      threshold?.destroy();
      edge?.destroy();
      timecode?.destroy();
      mosaic?.destroy();
      strobe?.destroy();
      zoom?.destroy();
      overlay = null;
      threshold = null;
      edge = null;
      timecode = null;
      mosaic = null;
      strobe = null;
      zoom = null;
      videoContainer.classList.remove('invert', 'posterize', 'mirror');
      window.removeEventListener('keydown', handleKey);
      sidebar.classList.remove('visible');
      sidebarBtns.forEach(b => { b.classList.remove('active'); b.onclick = null; });
      transportFx.classList.remove('active');
      transportFx.onclick = null;
      fxDialog.classList.remove('visible');
      transport.classList.remove('visible');
      transportPlaypause.onclick = null;
      playBtn.classList.remove('hidden');
      playBtn.textContent = 'Replay';
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
