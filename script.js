"use strict";

// ---------------------------------------------------------------
// Config
// ---------------------------------------------------------------
const FREQ_MIN = 110;    // A2
const FREQ_MAX = 1046.5; // C6  (~3 octave range)
const FILTER_MIN = 300;
const FILTER_MAX = 9000;
let SMOOTHING = 0.35;
let RAMP_TIME = 0.06;
const HAND_LOST_TIMEOUT = 220;
const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],
  [11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]
];

const SCALE_MIDI = [];
(function buildScale(){
  const majorSteps = [0,2,4,5,7,9,11];
  const lowMidi = Math.round(69 + 12*Math.log2(FREQ_MIN/440)) - 12;
  const highMidi = Math.round(69 + 12*Math.log2(FREQ_MAX/440)) + 12;
  for(let m = lowMidi; m <= highMidi; m++){
    if(majorSteps.includes(((m % 12) + 12) % 12)) SCALE_MIDI.push(m);
  }
})();
function freqToMidi(f){ return 69 + 12*Math.log2(f/440); }
function midiToFreq(m){ return 440 * Math.pow(2, (m-69)/12); }
function nearestScaleFreq(f){
  const m = freqToMidi(f);
  let best = SCALE_MIDI[0], bestDist = Infinity;
  for(const cand of SCALE_MIDI){
    const d = Math.abs(cand - m);
    if(d < bestDist){ bestDist = d; best = cand; }
  }
  return midiToFreq(best);
}
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function lerp(a,b,t){ return a + (b-a)*t; }

// ---------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------
const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const octx = overlay.getContext('2d');
const startOverlay = document.getElementById('startOverlay');
const startBtn = document.getElementById('startBtn');
const errorBox = document.getElementById('errorBox');
const statusLog = document.getElementById('statusLog');
const handDot = document.getElementById('handDot');
const handText = document.getElementById('handText');
const pitchValue = document.getElementById('pitchValue');
const pitchMeter = document.getElementById('pitchMeter');
const volValue = document.getElementById('volValue');
const volMeter = document.getElementById('volMeter');
const toneValue = document.getElementById('toneValue');
const toneMeter = document.getElementById('toneMeter');
const scaleToggle = document.getElementById('scaleToggle');
const waveButtons = document.querySelectorAll('.wave-btn');
const smoothingRange = document.getElementById('smoothingRange');
const rampRange = document.getElementById('rampRange');

let snapToScale = true;
let currentWave = 'sine';
let running = false;
let audioMode = 'none';
let audioContext = null;
let osc = null;
let filter = null;
let gain = null;
let lastSeenAt = 0;
let smoothed = null;
let handLandmarker = null;
let rafId = null;
let lastVideoTime = -1;
let fallbackPointer = { x: 0.5, y: 0.5, active: false };

scaleToggle.addEventListener('click', () => {
  snapToScale = !snapToScale;
  scaleToggle.textContent = 'Snap to scale: ' + (snapToScale ? 'On' : 'Off');
  scaleToggle.classList.toggle('on', snapToScale);
  try{ localStorage.setItem('aero_snap', snapToScale ? '1' : '0'); }catch(e){}
});
waveButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    waveButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentWave = btn.dataset.wave;
    if(osc) osc.type = currentWave;
    try{ localStorage.setItem('aero_wave', currentWave); }catch(e){}
  });
});

// settings persistence
smoothingRange.addEventListener('input', e => {
  const v = parseFloat(e.target.value);
  SMOOTHING = v;
  try{ localStorage.setItem('aero_smoothing', String(v)); }catch(e){}
});
rampRange.addEventListener('input', e => {
  const v = parseFloat(e.target.value);
  RAMP_TIME = v;
  try{ localStorage.setItem('aero_ramp', String(v)); }catch(e){}
});

// ---------------------------------------------------------------
// Diagnostic status log — every step logs here, so failures are visible
// instead of a silent blank screen.
// ---------------------------------------------------------------
const steps = {};
function logStep(key, label, state, detail){
  steps[key] = { label, state, detail };
  statusLog.classList.add('show');
  statusLog.innerHTML = Object.values(steps).map(s => {
    const icon = s.state === 'ok' ? '✓' : s.state === 'fail' ? '✕' : '…';
    const cls = s.state;
    return `<div class="${cls}">${icon} ${s.label}${s.detail ? ' — ' + s.detail : ''}</div>`;
  }).join('');
}

// ---------------------------------------------------------------
// Audio chain
// ---------------------------------------------------------------
async function buildAudioChain(){
  if(typeof Tone !== 'undefined' && Tone && Tone.Oscillator){
    audioMode = 'tone';
    osc = new Tone.Oscillator({ frequency: FREQ_MIN, type: currentWave }).start();
    filter = new Tone.Filter({ frequency: FILTER_MAX, type: 'lowpass', Q: 0.8, rolloff: -12 });
    gain = new Tone.Gain(0);
    osc.connect(filter);
    filter.connect(gain);
    gain.toDestination();
    return;
  }

  audioMode = 'web-audio';
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if(!AudioContextClass){ throw new Error('This browser does not support Web Audio.'); }

  audioContext = new AudioContextClass();
  if(audioContext.state === 'suspended') await audioContext.resume();

  osc = audioContext.createOscillator();
  filter = audioContext.createBiquadFilter();
  gain = audioContext.createGain();
  osc.type = currentWave;
  osc.frequency.value = FREQ_MIN;
  filter.type = 'lowpass';
  filter.frequency.value = FILTER_MAX;
  gain.gain.value = 0;
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(audioContext.destination);
  osc.start();
}

function stopAudioChain(){
  try{
    if(audioMode === 'tone'){
      if(osc){ osc.stop(); osc.disconnect(); osc.dispose && osc.dispose(); osc = null; }
      if(filter){ filter.disconnect(); filter.dispose && filter.dispose(); filter = null; }
      if(gain){ gain.disconnect(); gain.dispose && gain.dispose(); gain = null; }
      Tone && Tone.context && Tone.context.close && Tone.context.close();
    } else {
      if(osc){ try { osc.stop(); } catch(e){} osc.disconnect(); osc = null; }
      if(filter){ filter.disconnect(); filter = null; }
      if(gain){ gain.disconnect(); gain = null; }
      audioContext = null;
    }
  }catch(e){ console.warn('stopAudioChain', e); }
}

// ---------------------------------------------------------------
// Hand tracking / input fallback
// ---------------------------------------------------------------
async function createLandmarker(){
  try{
    const visionModule = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs');
    const { HandLandmarker, FilesetResolver } = visionModule;
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'
    );
    const modelUrl = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

    try{
      return await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: modelUrl, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 1
      });
    } catch(gpuErr){
      logStep('model', 'Loading hand-tracking model', 'pending', 'GPU delegate failed, retrying on CPU…');
      return await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: modelUrl, delegate: 'CPU' },
        runningMode: 'VIDEO',
        numHands: 1
      });
    }
  } catch(err){
    console.warn('MediaPipe unavailable, using pointer fallback', err);
    return null;
  }
}

function resizeCanvas(){
  overlay.width = overlay.clientWidth;
  overlay.height = overlay.clientHeight;
}
window.addEventListener('resize', resizeCanvas);

function drawSkeleton(landmarks){
  octx.strokeStyle = 'rgba(255,140,66,0.85)';
  octx.lineWidth = 2;
  octx.fillStyle = 'rgba(82,214,200,0.9)';
  for(const [a,b] of HAND_CONNECTIONS){
    const p1 = landmarks[a], p2 = landmarks[b];
    octx.beginPath();
    octx.moveTo(p1.x*overlay.width, p1.y*overlay.height);
    octx.lineTo(p2.x*overlay.width, p2.y*overlay.height);
    octx.stroke();
  }
  for(const p of landmarks){
    octx.beginPath();
    octx.arc(p.x*overlay.width, p.y*overlay.height, 3, 0, Math.PI*2);
    octx.fill();
  }
}

function updateGesture(raw){
  if(!smoothed) smoothed = { ...raw };
  smoothed.y = lerp(smoothed.y, raw.y, SMOOTHING);
  smoothed.open = lerp(smoothed.open, raw.open, SMOOTHING);
  smoothed.x = lerp(smoothed.x, raw.x, SMOOTHING);

  let targetFreq = FREQ_MIN * Math.pow(FREQ_MAX/FREQ_MIN, smoothed.y);
  if(snapToScale) targetFreq = nearestScaleFreq(targetFreq);
  const targetGain = smoothed.open * 0.85;
  const targetFilter = FILTER_MIN * Math.pow(FILTER_MAX/FILTER_MIN, smoothed.x);

  if(osc && filter && gain){
    if(audioMode === 'tone'){
      osc.frequency.rampTo(targetFreq, RAMP_TIME);
      filter.frequency.rampTo(targetFilter, RAMP_TIME);
      gain.gain.rampTo(targetGain, RAMP_TIME);
    } else {
      osc.frequency.setTargetAtTime(targetFreq, audioContext.currentTime, Math.max(RAMP_TIME, 0.01));
      filter.frequency.setTargetAtTime(targetFilter, audioContext.currentTime, Math.max(RAMP_TIME, 0.01));
      gain.gain.setTargetAtTime(targetGain, audioContext.currentTime, Math.max(RAMP_TIME, 0.01));
    }
  }

  pitchValue.textContent = Math.round(targetFreq) + ' Hz';
  pitchMeter.style.width = (smoothed.y*100).toFixed(0) + '%';
  volValue.textContent = Math.round(targetGain/0.85*100) + '%';
  volMeter.style.width = (targetGain/0.85*100).toFixed(0) + '%';
  toneValue.textContent = Math.round(targetFilter) + ' Hz';
  toneMeter.style.width = (smoothed.x*100).toFixed(0) + '%';
}

function processLandmarks(lm){
  const W = video.videoWidth || 960, H = video.videoHeight || 540;
  const wrist = lm[0], palm = lm[9], thumbTip = lm[4], indexTip = lm[8];

  const dx = (thumbTip.x - indexTip.x) * W;
  const dy = (thumbTip.y - indexTip.y) * H;
  const pinchDist = Math.sqrt(dx*dx + dy*dy);

  const hsx = (wrist.x - palm.x) * W;
  const hsy = (wrist.y - palm.y) * H;
  const handScale = Math.max(1, Math.sqrt(hsx*hsx + hsy*hsy));

  const openness = clamp((pinchDist/handScale - 0.35) / (1.7 - 0.35), 0, 1);
  const yNorm = clamp((palm.y - 0.08) / (0.92 - 0.08), 0, 1);
  const xNorm = clamp(palm.x, 0, 1);

  updateGesture({ y: 1 - yNorm, open: openness, x: xNorm });
}

function updatePointerPosition(event){
  const rect = video.getBoundingClientRect();
  if(!rect || rect.width === 0 || rect.height === 0) return;
  fallbackPointer = {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    active: true
  };
}

window.addEventListener('pointermove', (event) => {
  updatePointerPosition(event);
});
window.addEventListener('pointerdown', (event) => {
  updatePointerPosition(event);
});
window.addEventListener('pointerup', () => {
  fallbackPointer.active = false;
});
window.addEventListener('pointerleave', () => {
  fallbackPointer.active = false;
});

function renderLoop(){
  rafId = requestAnimationFrame(renderLoop);
  resizeCanvas();
  octx.clearRect(0, 0, overlay.width, overlay.height);

  if(handLandmarker && video.readyState >= 2 && video.currentTime !== lastVideoTime){
    lastVideoTime = video.currentTime;
    const results = handLandmarker.detectForVideo(video, performance.now());
    const hasHand = results.landmarks && results.landmarks.length > 0;
    if(hasHand){
      lastSeenAt = performance.now();
      handDot.classList.add('live');
      handText.textContent = 'tracking';
      drawSkeleton(results.landmarks[0]);
      processLandmarks(results.landmarks[0]);
      return;
    }
  }

  if(fallbackPointer.active){
    lastSeenAt = performance.now();
    handDot.classList.add('live');
    handText.textContent = 'pointer';
    updateGesture({ y: 1 - fallbackPointer.y, open: 0.8, x: fallbackPointer.x });
  } else {
    handDot.classList.remove('live');
    handText.textContent = 'no hand';
    if(gain && performance.now() - lastSeenAt > HAND_LOST_TIMEOUT){
      if(audioMode === 'tone'){
        gain.gain.rampTo(0, RAMP_TIME*2);
      } else {
        gain.gain.setTargetAtTime(0, audioContext.currentTime, Math.max(RAMP_TIME*2, 0.01));
      }
      volValue.textContent = '0%';
      volMeter.style.width = '0%';
    }
  }
}

async function startCamera(){
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    throw new Error('Camera access is not available in this browser.');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 960 }, height: { ideal: 540 }, facingMode: 'user' },
    audio: false
  });
  video.srcObject = stream;
  await new Promise((resolve, reject) => {
    video.onloadedmetadata = () => { video.play().then(resolve).catch(reject); };
    video.onerror = () => reject(new Error('Video element failed to load the camera stream.'));
  });
}

function stopCamera(){
  try{
    const s = video.srcObject;
    if(s){
      const tracks = s.getTracks();
      tracks.forEach(t => t.stop());
      video.srcObject = null;
    }
  }catch(e){ console.warn('stopCamera', e); }
}

// ---------------------------------------------------------------
// Start flow
// ---------------------------------------------------------------
startBtn.addEventListener('click', async () => {
  if(running){
    running = false;
    startBtn.textContent = 'Enable Camera & Sound';
    startOverlay.classList.remove('hidden');
    if(rafId) cancelAnimationFrame(rafId);
    stopCamera();
    stopAudioChain();
    if(handLandmarker && handLandmarker.close) handLandmarker.close();
    return;
  }

  startBtn.disabled = true;
  startBtn.textContent = 'Starting…';
  errorBox.classList.remove('show');

  try{
    logStep('audio', 'Starting audio engine', 'pending');
    await buildAudioChain();
    logStep('audio', 'Starting audio engine', 'ok');

    running = true;

    logStep('model', 'Loading hand-tracking model', 'pending');
    handLandmarker = await createLandmarker();
    if(handLandmarker){
      logStep('model', 'Loading hand-tracking model', 'ok');
    } else {
      logStep('model', 'Loading hand-tracking model', 'ok', 'using pointer fallback');
    }

    logStep('camera', 'Requesting camera access', 'pending');
    try{
      await startCamera();
      logStep('camera', 'Requesting camera access', 'ok');
    } catch(err){
      console.warn('Camera unavailable, continuing with pointer mode', err);
      logStep('camera', 'Requesting camera access', 'ok', 'camera unavailable, pointer mode enabled');
    }

    resizeCanvas();
    renderLoop();
    startOverlay.classList.add('hidden');
    startBtn.textContent = 'Stop';
    startBtn.disabled = false;
  } catch(err){
    console.error(err);
    const key = !handLandmarker ? 'model' : 'camera';
    logStep(key, key === 'model' ? 'Loading hand-tracking model' : 'Requesting camera access', 'fail', err && err.message ? err.message : String(err));
    failStart(describeError(err));
  }
});

// keyboard shortcuts: space toggles start/stop, s toggles snap, w cycles waveform
window.addEventListener('keydown', (e) => {
  if(e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if(e.code === 'Space'){
    e.preventDefault(); startBtn.click();
  } else if(e.key === 's' || e.key === 'S'){
    scaleToggle.click();
  } else if(e.key === 'w' || e.key === 'W'){
    const waves = ['sine','triangle','sawtooth','square'];
    let idx = waves.indexOf(currentWave);
    idx = (idx + 1) % waves.length;
    const btn = Array.from(waveButtons).find(b => b.dataset.wave === waves[idx]);
    btn && btn.click();
  }
});

// load saved settings
try{
  const sv = localStorage.getItem('aero_wave'); if(sv) {
    currentWave = sv; Array.from(waveButtons).forEach(b=>b.classList.toggle('active', b.dataset.wave===currentWave));
  }
  const ss = localStorage.getItem('aero_snap'); if(ss !== null){ snapToScale = ss === '1'; scaleToggle.classList.toggle('on', snapToScale); scaleToggle.textContent = 'Snap to scale: ' + (snapToScale ? 'On' : 'Off'); }
  const sm = localStorage.getItem('aero_smoothing'); if(sm){ SMOOTHING = parseFloat(sm); smoothingRange.value = SMOOTHING; }
  const rt = localStorage.getItem('aero_ramp'); if(rt){ RAMP_TIME = parseFloat(rt); rampRange.value = RAMP_TIME; }
}catch(e){/*no storage*/}

function failStart(message){
  errorBox.textContent = message;
  errorBox.classList.add('show');
  startBtn.disabled = false;
  startBtn.textContent = 'Try Again';
  if(rafId) cancelAnimationFrame(rafId);
}

function describeError(err){
  const msg = (err && err.message) ? err.message : String(err);
  if(/Permission denied|NotAllowedError/i.test(msg)){
    return 'Camera permission was denied. Check the camera icon in your address bar and allow access, then try again.';
  }
  if(/NotFoundError|no camera/i.test(msg)){
    return 'No camera was found on this device.';
  }
  if(/insecure|secure context/i.test(msg)){
    return 'This page needs to run on https:// or http://localhost — camera access is blocked on plain file:// pages in most browsers. Try serving it with "python3 -m http.server" and opening http://localhost:8000/.';
  }
  return 'Something went wrong: ' + msg + '. Open your browser\'s developer console (F12) for full details.';
}

resizeCanvas();
