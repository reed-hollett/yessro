import './style.css';
import { config } from './config';
import { detectBeats } from './beat-detect';
import { VideoPlayer } from './player';
import { TrackingOverlay } from './tracking-overlay';
import { ThresholdOverlay } from './threshold-overlay';

const playBtn = document.getElementById('play-btn')!;
const loading = document.getElementById('loading')!;
const transport = document.getElementById('transport')!;
const transportPlaypause = document.getElementById('transport-playpause')!;
const transportTime = document.getElementById('transport-time')!;
const transportDuration = document.getElementById('transport-duration')!;
const transportTrack = document.getElementById('transport-track')!;
const transportProgress = document.getElementById('transport-progress')!;
const transportFx = document.getElementById('transport-fx')!;

let players: VideoPlayer[] = [];
let overlay: TrackingOverlay | null = null;
let threshold: ThresholdOverlay | null = null;
let paused = false;

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function getLaneCount(): number {
  const ratio = window.innerWidth / window.innerHeight;
  if (ratio >= 1.5) return 3;
  if (ratio >= 1.0) return 2;
  return 1;
}

playBtn.addEventListener('click', async () => {
  playBtn.classList.add('hidden');
  loading.style.display = 'block';

  try {
    // 1. Create audio context (must be after user gesture)
    const audioCtx = new AudioContext();

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

    for (let i = 0; i < laneCount; i++) {
      const lane = document.createElement('div');
      lane.className = 'video-lane';
      videoContainer.appendChild(lane);
      const p = new VideoPlayer(lane, poolPerLane);
      p.init(clips, beats, audioCtx);
      players.push(p);
    }

    // 5b. Initialize overlays
    const app = document.getElementById('app')!;
    overlay = new TrackingOverlay(app);
    threshold = new ThresholdOverlay(app, players[0]);
    players[0].onSwap = () => {
      overlay?.shuffle();
      threshold?.shuffle();
    };

    // 6. Start audio playback (cap at 2:03)
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

    // 1 = tracking, 2 = threshold, 3 = invert desaturate
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === '1') toggleTrack();
      if (e.key === '2') toggleThresh();
      if (e.key === '3') toggleInvert();
    };
    window.addEventListener('keydown', handleKey);

    // Sidebar toggle helpers
    const sidebar = document.getElementById('sidebar')!;
    const sidebarBtns = sidebar.querySelectorAll<HTMLButtonElement>('.sidebar-btn');

    // FX button toggles sidebar visibility
    transportFx.onclick = () => {
      sidebar.classList.toggle('visible');
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

    sidebarBtns[0].onclick = toggleTrack;
    sidebarBtns[1].onclick = toggleThresh;
    sidebarBtns[2].onclick = toggleInvert;

    // Stop everything when song ends
    source.onended = () => {
      cancelAnimationFrame(transportRaf);
      players.forEach(p => p.stop());
      overlay?.destroy();
      threshold?.destroy();
      overlay = null;
      threshold = null;
      videoContainer.classList.remove('invert');
      window.removeEventListener('keydown', handleKey);
      sidebar.classList.remove('visible');
      sidebarBtns.forEach(b => { b.classList.remove('active'); b.onclick = null; });
      transportFx.classList.remove('active');
      transportFx.onclick = null;
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
