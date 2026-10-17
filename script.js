
"use strict";

/* Naol Music Studio - local audio engine */

const $ = (id) => document.getElementById(id);

const audioFiles = $("audioFiles");
const uploadZone = $("uploadZone");
const uploadHint = $("uploadHint");
const trackList = $("trackList");
const emptyState = $("emptyState");
const trackCount = $("trackCount");
const playAllButton = $("playAll");
const stopAllButton = $("stopAll");
const recordButton = $("recordButton");
const masterSeek = $("masterSeek");
const masterVolume = $("masterVolume");
const masterValue = $("masterValue");
const currentTimeLabel = $("currentTime");
const totalTimeLabel = $("totalTime");
const timelineEnd = $("timelineEnd");
const toast = $("toast");
const exportButton = $("exportMix");
const exportStatus = $("exportStatus");

let tracks = [];
let nextTrackId = 1;
let audioContext = null;
let masterGain = null;
let isPlaying = false;
let playbackStartedAt = 0;
let playbackOffset = 0;
let animationFrame = 0;
let recording = null;
let recordedChunks = [];
let recordedKeyboardNotes = [];
let keyboardRecordingStartedAt = null;
let activeNotes = new Map();
let toastTimeout = null;

function getAudioContext() {
  const AudioContextClass =
    window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    throw new Error("This browser does not support Web Audio.");
  }

  if (!audioContext) {
    audioContext = new AudioContextClass();
    masterGain = audioContext.createGain();
    masterGain.gain.value = Number(masterVolume.value) / 100;
    masterGain.connect(audioContext.destination);
  }

  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }

  return audioContext;
}

function notify(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove("show");
  }, 2800);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const remainingSeconds = whole % 60;
  return String(minutes).padStart(2, "0") + ":" +
         String(remainingSeconds).padStart(2, "0");
}

function getDuration() {
  return tracks.reduce((max, track) => {
    return Math.max(max, track.start + track.duration);
  }, 0);
}

function getPosition() {
  if (!isPlaying) return playbackOffset;
  return playbackOffset +
    Math.max(0, (performance.now() - playbackStartedAt) / 1000);
}

function makeTrack(name, buffer, blob, type = "audio") {
  const url = URL.createObjectURL(blob);
  const audio = new Audio();
  audio.preload = "auto";
  audio.src = url;
  audio.volume = 1;
  audio.loop = false;

  const track = {
    id: nextTrackId++,
    name: name || "Untitled audio",
    buffer,
    blob,
    url,
    audio,
    duration: buffer.duration,
    start: 0,
    volume: 1,
    muted: false,
    solo: false,
    type
  };

  tracks.push(track);
  renderTracks();
  updateDurationLabels();
  return track;
}

async function addAudioFile(file) {
  if (!file) return;
  if (!file.type.startsWith("audio/") &&
      !/\.(mp3|wav|m4a|ogg|aac|flac|opus)$/i.test(file.name)) {
    notify("Please choose an audio file.");
    return;
  }

  uploadHint.textContent = "Loading " + file.name + "…";

  try {
    const ctx = getAudioContext();
    const bytes = await file.arrayBuffer();
    const buffer = await ctx.decodeAudioData(bytes.slice(0));

    makeTrack(file.name, buffer, file, "audio");
    uploadHint.textContent =
      "Added: " + file.name + ". You can add more tracks.";
    notify("Music added to your timeline.");
  } catch (error) {
    console.error(error);
    uploadHint.textContent =
      "This audio format could not be decoded. Try MP3 or WAV.";
    notify("Could not read that file. Try another MP3 or WAV.");
  }
}

audioFiles.addEventListener("change", async (event) => {
  const files = Array.from(event.target.files || []);
  for (const file of files) {
    await addAudioFile(file);
  }
  audioFiles.value = "";
});

["dragenter", "dragover"].forEach((eventName) => {
  uploadZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    uploadZone.classList.add("dragover");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  uploadZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    uploadZone.classList.remove("dragover");
  });
});

uploadZone.addEventListener("drop", async (event) => {
  const files = Array.from(event.dataTransfer?.files || []);
  for (const file of files) await addAudioFile(file);
});

function drawWaveform(canvas, buffer, muted) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#111b2c";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "#263751";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();

  if (!buffer) return;

  const data = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / width));
  const middle = height / 2;
  const scale = height * 0.43;

  ctx.fillStyle = muted ? "#536079" : "#39e6b2";

  for (let x = 0; x < width; x++) {
    const start = x * step;
    const end = Math.min(start + step, data.length);
    let peak = 0;

    for (let i = start; i < end; i += 1) {
      peak = Math.max(peak, Math.abs(data[i]));
    }

    const barHeight = Math.max(1, peak * scale);
    ctx.fillRect(x, middle - barHeight, 1, barHeight * 2);
  }
}

function renderTracks() {
  trackList.innerHTML = "";
  emptyState.style.display = tracks.length ? "none" : "block";
  trackCount.textContent = tracks.length + (tracks.length === 1 ? " TRACK" : " TRACKS");

  tracks.forEach((track, index) => {
    const card = document.createElement("div");
    card.className = "track";
    card.dataset.trackId = String(track.id);

    const head = document.createElement("div");
    head.className = "track-head";

    const number = document.createElement("div");
    number.className = "track-number";
    number.textContent = String(index + 1).padStart(2, "0");

    const info = document.createElement("div");
    info.className = "track-info";

    const name = document.createElement("div");
    name.className = "track-name";
    name.textContent = track.name;

    const meta = document.createElement("div");
    meta.className = "track-meta";
    meta.textContent = formatTime(track.duration) +
      " · " + (track.type === "keyboard" ? "Keyboard" :
                track.type === "recording" ? "Recording" : "Audio");

    info.append(name, meta);

    const actions = document.createElement("div");
    actions.className = "track-actions";

    const play = makeAction("▶", "Play track", () => playSingle(track.id));
    const mute = makeAction(track.muted ? "M" : "M", "Mute track", () => {
      track.muted = !track.muted;
      mute.classList.toggle("active", track.muted);
      renderTracks();
      if (isPlaying) restartAt(getPosition());
    });
    mute.classList.toggle("active", track.muted);

    const solo = makeAction("S", "Solo track", () => {
      track.solo = !track.solo;
      renderTracks();
      if (isPlaying) restartAt(getPosition());
    });
    solo.classList.toggle("active", track.solo);

    const remove = makeAction("×", "Delete track", () => {
      removeTrack(track.id);
    });
    remove.classList.add("delete");

    actions.append(play, mute, solo, remove);
    head.append(number, info, actions);

    const canvas = document.createElement("canvas");
    canvas.className = "waveform";
    canvas.setAttribute("aria-label", "Audio waveform for " + track.name);

    const controls = document.createElement("div");
    controls.className = "track-controls";

    const volumeLabel = document.createElement("label");
    volumeLabel.textContent = "VOLUME";

    const volume = document.createElement("input");
    volume.type = "range";
    volume.min = "0";
    volume.max = "100";
    volume.value = String(Math.round(track.volume * 100));
    volume.setAttribute("aria-label", "Volume for " + track.name);

    const volumeOutput = document.createElement("output");
    volumeOutput.textContent = volume.value + "%";

    volume.addEventListener("input", () => {
      track.volume = Number(volume.value) / 100;
      volumeOutput.textContent = volume.value + "%";
      if (isPlaying) restartAt(getPosition());
    });

    controls.append(volumeLabel, volume, volumeOutput);
    card.append(head, canvas, controls);
    trackList.appendChild(card);
    drawWaveform(canvas, track.buffer, track.muted);
  });
}

function makeAction(text, label, callback) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.addEventListener("click", callback);
  return button;
}

function removeTrack(id) {
  const index = tracks.findIndex((track) => track.id === id);
  if (index < 0) return;

  const track = tracks[index];
  track.audio.pause();
  track.audio.removeAttribute("src");
  track.audio.load();
  URL.revokeObjectURL(track.url);
  tracks.splice(index, 1);

  if (isPlaying) stopPlayback(false);
  playbackOffset = Math.min(playbackOffset, getDuration());
  renderTracks();
  updateDurationLabels();
  updateTransport();
  notify("Track removed.");
}

function updateDurationLabels() {
  const duration = getDuration();
  totalTimeLabel.textContent = formatTime(duration);
  timelineEnd.textContent = formatTime(duration);
  masterSeek.disabled = duration <= 0;
  if (duration <= 0) masterSeek.value = "0";
}

function updateTransport() {
  playAllButton.textContent = isPlaying ? "Ⅱ" : "▶";
  playAllButton.setAttribute("aria-label", isPlaying ? "Pause all" : "Play all");
  currentTimeLabel.textContent = formatTime(getPosition());
}

function shouldPlay(track) {
  const anySolo = tracks.some((item) => item.solo);
  return !track.muted && (!anySolo || track.solo);
}

function stopAudioElements() {
  tracks.forEach((track) => {
    track.audio.pause();
    try { track.audio.currentTime = 0; } catch (_) {}
  });
}

function stopPlayback(resetPosition = true) {
  isPlaying = false;
  cancelAnimationFrame(animationFrame);
  tracks.forEach((track) => track.audio.pause());

  if (resetPosition) {
    playbackOffset = 0;
    tracks.forEach((track) => {
      try { track.audio.currentTime = 0; } catch (_) {}
    });
  } else {
    playbackOffset = getPosition();
  }

  updateTransport();
}

async function startPlayback(offset = playbackOffset) {
  if (!tracks.length) {
    notify("Upload a music file first.");
    return;
  }

  const duration = getDuration();
  if (duration <= 0) return;

  if (offset >= duration) offset = 0;

  try {
    getAudioContext();
    if (audioContext.state === "suspended") await audioContext.resume();
  } catch (error) {
    notify("Audio is not available in this browser.");
    return;
  }

  tracks.forEach((track) => {
    track.audio.pause();
    track.audio.volume = Math.max(0, Math.min(1,
      track.volume * Number(masterVolume.value) / 100));
    try {
      track.audio.currentTime = Math.max(0, offset - track.start);
    } catch (_) {}
  });

  playbackOffset = offset;
  playbackStartedAt = performance.now();
  isPlaying = true;

  const playPromises = tracks.filter(shouldPlay).map((track) => {
    const localTime = offset - track.start;
    if (localTime < 0) {
      track.audio.currentTime = 0;
      return new Promise((resolve) => {
        const delay = Math.max(0, -localTime * 1000);
        setTimeout(() => {
          if (!isPlaying) return resolve();
          track.audio.play().then(resolve).catch(resolve);
        }, delay);
      });
    }
    if (localTime >= track.duration) return Promise.resolve();
    track.audio.currentTime = localTime;
    return track.audio.play().catch((error) => {
      console.warn("Playback failed:", error);
    });
  });

  Promise.all(playPromises).catch(() => {});
  updateTransport();
  tick();
}

function restartAt(offset) {
  if (!isPlaying) return;
  stopPlayback(false);
  startPlayback(offset);
}

function tick() {
  if (!isPlaying) return;

  const position = getPosition();
  const duration = getDuration();

  currentTimeLabel.textContent = formatTime(position);
  masterSeek.value = duration > 0
    ? String(Math.round(Math.min(1, position / duration) * 1000))
    : "0";

  if (position >= duration) {
    stopPlayback(true);
    currentTimeLabel.textContent = "00:00";
    masterSeek.value = "0";
    return;
  }

  animationFrame = requestAnimationFrame(tick);
}

playAllButton.addEventListener("click", () => {
  if (isPlaying) {
    stopPlayback(false);
  } else {
    startPlayback(playbackOffset);
  }
});

stopAllButton.addEventListener("click", () => {
  stopPlayback(true);
});

masterSeek.addEventListener("input", () => {
  const duration = getDuration();
  const position = Number(masterSeek.value) / 1000 * duration;
  if (isPlaying) restartAt(position);
  else {
    playbackOffset = position;
    currentTimeLabel.textContent = formatTime(position);
  }
});

masterVolume.addEventListener("input", () => {
  const value = Number(masterVolume.value);
  masterValue.textContent = value + "%";
  tracks.forEach((track) => {
    track.audio.volume = Math.max(0, Math.min(1, track.volume * value / 100));
  });
});

function playSingle(id) {
  const track = tracks.find((item) => item.id === id);
  if (!track) return;
  startPlayback(track.start);
}

let mediaRecorder = null;

recordButton.addEventListener("click", async () => {
  if (recording) {
    stopRecording();
  } else {
    await startRecording();
  }
});

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    notify("Microphone recording is not supported here.");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) recordedChunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
      const mimeType = mediaRecorder.mimeType || "audio/webm";
      const blob = new Blob(recordedChunks, { type: mimeType });
      stream.getTracks().forEach((track) => track.stop());

      if (blob.size > 0) {
        await addAudioFile(new File(
          [blob], "Naol-Recording-" + Date.now() + ".webm",
          { type: blob.type || "audio/webm" }
        ));
        notify("Recording added to your tracks.");
      } else {
        notify("No recorded audio was received.");
      }
    };

    mediaRecorder.start();
    recording = true;
    recordButton.textContent = "■ STOP REC";
    recordButton.classList.add("recording");
    $("keyboardStatus").textContent = "RECORDING";
    notify("Microphone recording started.");
  } catch (error) {
    console.error(error);
    notify("Allow microphone permission, then try again.");
  }
}

function stopRecording() {
  if (!recording || !mediaRecorder) return;
  recording = false;
  recordButton.textContent = "● REC";
  recordButton.classList.remove("recording");
  $("keyboardStatus").textContent = "READY";

  if (mediaRecorder.state !== "inactive") mediaRecorder.stop();
}

function noteFrequency(midiNote) {
  return 440 * Math.pow(2, (midiNote - 69) / 12);
}

function playNote(midiNote, button) {
  let ctx;
  try {
    ctx = getAudioContext();
  } catch (_) {
    notify("Audio is not supported in this browser.");
    return;
  }

  const frequency = noteFrequency(midiNote);
  const instrument = $("instrument").value;
  const gain = ctx.createGain();
  const oscillator = ctx.createOscillator();
  const volume = Number($("keyboardVolume").value) / 100;

  oscillator.type = instrument === "synth" ? "sawtooth" :
                   instrument === "bass" ? "triangle" : "sine";
  oscillator.frequency.value = frequency;

  if (instrument === "piano") {
    const second = ctx.createOscillator();
    second.type = "triangle";
    second.frequency.value = frequency * 2.01;
    const secondGain = ctx.createGain();
    secondGain.gain.value = 0.15;
    second.connect(secondGain);
    secondGain.connect(gain);
    second.start();
    activeNotes.set(midiNote, { oscillator, gain, second, button });
  } else {
    activeNotes.set(midiNote, { oscillator, gain, button });
  }

  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(
    Math.max(0.001, volume * (instrument === "bass" ? 0.65 : 0.3)),
    ctx.currentTime + 0.015
  );

  oscillator.connect(gain);
  gain.connect(masterGain);
  oscillator.start();

  if (button) button.classList.add("active");

  if (keyboardRecordingStartedAt !== null) {
    recordedKeyboardNotes.push({
      note: midiNote,
      start: Math.max(0, performance.now() / 1000 - keyboardRecordingStartedAt),
      duration: 0.4,
      instrument
    });
  }
}

function stopNote(midiNote) {
  const note = activeNotes.get(midiNote);
  if (!note) return;

  const ctx = audioContext;
  const now = ctx.currentTime;

  try {
    note.gain.gain.cancelScheduledValues(now);
    note.gain.gain.setTargetAtTime(0.0001, now, 0.04);
    note.oscillator.stop(now + 0.2);
    if (note.second) note.second.stop(now + 0.2);
  } catch (_) {}

  if (note.button) note.button.classList.remove("active");
  activeNotes.delete(midiNote);
}

document.querySelectorAll("[data-note]").forEach((button) => {
  const note = Number(button.dataset.note);

  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    if (!activeNotes.has(note)) playNote(note, button);
  });

  ["pointerup", "pointercancel", "pointerleave"].forEach((eventName) => {
    button.addEventListener(eventName, () => stopNote(note));
  });
});

$("addKeyboardTrack").addEventListener("click", async () => {
  if (keyboardRecordingStartedAt === null) {
    keyboardRecordingStartedAt = performance.now() / 1000;
    recordedKeyboardNotes = [];
    $("keyboardStatus").textContent = "REC NOTES";
    $("addKeyboardTrack").textContent = "■ FINISH KEYBOARD PERFORMANCE";
    notify("Play notes, then tap finish.");
    return;
  }

  keyboardRecordingStartedAt = null;
  $("keyboardStatus").textContent = "READY";
  $("addKeyboardTrack").textContent = "＋ ADD KEYBOARD PERFORMANCE TO TRACKS";

  if (!recordedKeyboardNotes.length) {
    notify("Play some keyboard notes first.");
    return;
  }

  try {
    const ctx = getAudioContext();
    const duration = Math.max(1.5, ...recordedKeyboardNotes.map(
      (note) => note.start + note.duration
    )) + 0.5;

    const sampleRate = ctx.sampleRate;
    const frameCount = Math.ceil(duration * sampleRate);
    const offline = new OfflineAudioContext(2, frameCount, sampleRate);

    recordedKeyboardNotes.forEach((note) => {
      const oscillator = offline.createOscillator();
      const gain = offline.createGain();
      const frequency = noteFrequency(note.note);

      oscillator.type = note.instrument === "synth" ? "sawtooth" :
                       note.instrument === "bass" ? "triangle" : "sine";
      oscillator.frequency.value = frequency;

      const start = note.start;
      const end = start + Math.max(0.12, note.duration);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.2, start + 0.015);
      gain.gain.setTargetAtTime(0.0001, Math.max(start + 0.06, end - 0.04), 0.03);

      oscillator.connect(gain);
      gain.connect(offline.destination);
      oscillator.start(start);
      oscillator.stop(end + 0.15);
    });

    const buffer = await offline.startRendering();
    const wav = audioBufferToWav(buffer);
    makeTrack("Keyboard Performance.wav", buffer, wav, "keyboard");
    recordedKeyboardNotes = [];
    notify("Keyboard performance added.");
  } catch (error) {
    console.error(error);
    notify("Could not create keyboard track.");
  }
});

function audioBufferToWav(buffer) {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const frames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = frames * blockAlign;
  const out = new ArrayBuffer(44 + dataSize);
  const view = new DataView(out);

  function writeString(offset, text) {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  const channelData = [];
  for (let channel = 0; channel < channels; channel++) {
    channelData.push(buffer.getChannelData(channel));
  }

  let offset = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      let sample = Math.max(-1, Math.min(1, channelData[channel][frame]));
      sample = sample < 0 ? sample * 32768 : sample * 32767;
      view.setInt16(offset, sample, true);
      offset += 2;
    }
  }

  return new Blob([out], { type: "audio/wav" });
}

exportButton.addEventListener("click", async () => {
  if (!tracks.length) {
    notify("Upload music before exporting.");
    return;
  }

  exportButton.disabled = true;
  exportStatus.textContent = "Rendering your mix…";

  try {
    const duration = getDuration();
    const sampleRate = 44100;
    const frameCount = Math.ceil(duration * sampleRate);
    const offline = new OfflineAudioContext(2, frameCount, sampleRate);
    const anySolo = tracks.some((track) => track.solo);

    for (const track of tracks) {
      if (track.muted || (anySolo && !track.solo)) continue;
      if (!track.buffer) continue;

      const source = offline.createBufferSource();
      const gain = offline.createGain();
      source.buffer = track.buffer;
      gain.gain.value = track.volume * Number(masterVolume.value) / 100;
      source.connect(gain);
      gain.connect(offline.destination);
      source.start(Math.max(0, track.start));
    }

    const rendered = await offline.startRendering();
    const wavBlob = audioBufferToWav(rendered);
    const url = URL.createObjectURL(wavBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "Naol-Music-Studio-Mix.wav";
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 10000);
    exportStatus.textContent = "Mix exported as WAV.";
    notify("Your WAV mix is ready.");
  } catch (error) {
    console.error(error);
    exportStatus.textContent = "Export failed. Try fewer or shorter tracks.";
    notify("Mix export failed. Try a smaller project.");
  } finally {
    exportButton.disabled = false;
  }
});

window.addEventListener("beforeunload", () => {
  tracks.forEach((track) => URL.revokeObjectURL(track.url));
});

window.addEventListener("resize", () => {
  document.querySelectorAll(".track").forEach((card) => {
    const track = tracks.find(
      (item) => item.id === Number(card.dataset.trackId)
    );
    const canvas = card.querySelector("canvas");
    if (track && canvas) drawWaveform(canvas, track.buffer, track.muted);
  });
});

updateDurationLabels();
updateTransport();
renderTracks();
