import { config } from './config';

export interface BeatData {
  bpm: number;
  beats: number[];
}

/**
 * Detect BPM and generate a beat grid from an AudioBuffer.
 * Uses energy-based onset detection + autocorrelation for BPM estimation.
 */
export function detectBeats(audioBuffer: AudioBuffer): BeatData {
  if (config.bpmOverride) {
    return buildGrid(config.bpmOverride, audioBuffer.duration);
  }

  const mono = mixToMono(audioBuffer);
  const sampleRate = audioBuffer.sampleRate;

  // Compute onset detection function (energy flux)
  const onsets = computeOnsets(mono, sampleRate);

  // Estimate BPM via autocorrelation
  const bpm = estimateBPM(onsets, sampleRate);

  return buildGrid(bpm, audioBuffer.duration);
}

/**
 * Build an evenly-spaced beat grid from BPM.
 */
function buildGrid(bpm: number, duration: number): BeatData {
  const interval = 60 / bpm;
  const beats: number[] = [];

  // Find a reasonable start — use the beat offset from config
  let t = config.beatOffset;
  while (t < duration) {
    beats.push(t);
    t += interval;
  }

  return { bpm: Math.round(bpm * 10) / 10, beats };
}

/**
 * Mix an AudioBuffer down to a mono Float32Array.
 */
function mixToMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) {
    return buffer.getChannelData(0);
  }

  const length = buffer.length;
  const mono = new Float32Array(length);
  const channels = buffer.numberOfChannels;

  for (let ch = 0; ch < channels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      mono[i] += data[i];
    }
  }

  // Average
  for (let i = 0; i < length; i++) {
    mono[i] /= channels;
  }

  return mono;
}

/**
 * Compute an onset detection function using spectral energy flux.
 * Returns an array of energy values, one per hop.
 */
function computeOnsets(samples: Float32Array, sampleRate: number): Float32Array {
  const windowSize = 1024;
  const hopSize = 512;
  const numFrames = Math.floor((samples.length - windowSize) / hopSize);

  if (numFrames <= 0) {
    return new Float32Array(0);
  }

  // Compute energy in each frame
  const energies = new Float32Array(numFrames);
  for (let i = 0; i < numFrames; i++) {
    const offset = i * hopSize;
    let energy = 0;
    for (let j = 0; j < windowSize; j++) {
      const s = samples[offset + j];
      energy += s * s;
    }
    energies[i] = energy / windowSize;
  }

  // Spectral flux: positive differences between consecutive frames
  const flux = new Float32Array(numFrames);
  for (let i = 1; i < numFrames; i++) {
    const diff = energies[i] - energies[i - 1];
    flux[i] = diff > 0 ? diff : 0;
  }

  // Normalize
  let maxFlux = 0;
  for (let i = 0; i < flux.length; i++) {
    if (flux[i] > maxFlux) maxFlux = flux[i];
  }
  if (maxFlux > 0) {
    for (let i = 0; i < flux.length; i++) {
      flux[i] /= maxFlux;
    }
  }

  // We use the raw sample rate info to pass along
  // Store hop metadata for BPM estimation
  (flux as unknown as { _hopSize: number })._hopSize = hopSize;
  (flux as unknown as { _sampleRate: number })._sampleRate = sampleRate;

  return flux;
}

/**
 * Estimate BPM using autocorrelation of the onset detection function.
 * Searches for the strongest periodic peak in the 60–180 BPM range.
 */
function estimateBPM(onsets: Float32Array, sampleRate: number): number {
  const hopSize = (onsets as unknown as { _hopSize: number })._hopSize || 512;
  const hopRate = sampleRate / hopSize; // onsets per second

  // BPM range to search
  const minBPM = 60;
  const maxBPM = 180;

  // Convert BPM range to lag range (in onset frames)
  const minLag = Math.floor(hopRate * (60 / maxBPM));
  const maxLag = Math.ceil(hopRate * (60 / minBPM));

  // Compute autocorrelation for lags in range
  let bestLag = minLag;
  let bestCorr = -Infinity;

  for (let lag = minLag; lag <= maxLag && lag < onsets.length; lag++) {
    let corr = 0;
    let count = 0;
    for (let i = 0; i < onsets.length - lag; i++) {
      corr += onsets[i] * onsets[i + lag];
      count++;
    }
    corr /= count;

    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  // Convert lag back to BPM
  const bpm = (hopRate / bestLag) * 60;

  // Snap to a reasonable value — if it's very low, try doubling
  if (bpm < 80) return bpm * 2;
  if (bpm > 160) return bpm / 2;

  return bpm;
}
