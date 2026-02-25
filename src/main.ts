import './style.css';
import { config } from './config';
import { detectBeats } from './beat-detect';
import { VideoPlayer } from './player';

const playBtn = document.getElementById('play-btn')!;
const info = document.getElementById('info')!;
const loading = document.getElementById('loading')!;

let player: VideoPlayer | null = null;

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
    const { bpm, beats } = detectBeats(audioBuffer);
    info.textContent = `${bpm} BPM`;

    // 4. Fetch clip manifest
    loading.textContent = 'Loading clips...';
    const manifestRes = await fetch(config.manifestPath);
    const clips: string[] = await manifestRes.json();

    if (clips.length === 0) {
      throw new Error('No clips found. Run: npm run convert');
    }

    // 5. Initialize video player
    const videoContainer = document.getElementById('video-container')!;
    player = new VideoPlayer(videoContainer);
    player.init(clips, beats, audioCtx);

    // 6. Start audio playback
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioCtx.destination);
    const startTime = audioCtx.currentTime;
    source.start(startTime);

    // Stop everything when song ends
    source.onended = () => {
      player?.stop();
      info.textContent = '';
      playBtn.classList.remove('hidden');
      playBtn.textContent = 'Replay';
    };

    // 7. Start beat-synced video loop
    loading.style.display = 'none';
    player.start(startTime);

  } catch (err) {
    console.error('Startup error:', err);
    loading.textContent = `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
    playBtn.classList.remove('hidden');
  }
});
