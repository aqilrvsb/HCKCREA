/**
 * Offscreen document for audio playback.
 * Handles TTS audio (base64) and SFX (local mp3 files).
 * Reports back when done or on error.
 */

let currentAudio = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PLAY_AUDIO') {
    playAudio(message.audioBase64);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'PLAY_SFX') {
    playSFX(message.sfx);
    sendResponse({ ok: true });
    return false;
  }
});

async function playAudio(base64Data) {
  try {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }

    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const blob = new Blob([bytes], { type: 'audio/mp3' });
    const url = URL.createObjectURL(blob);

    currentAudio = new Audio(url);

    currentAudio.addEventListener('ended', () => {
      URL.revokeObjectURL(url);
      currentAudio = null;
      chrome.runtime.sendMessage({ type: 'AUDIO_DONE' });
    });

    currentAudio.addEventListener('error', () => {
      const errMsg = currentAudio?.error?.message || 'Playback failed';
      URL.revokeObjectURL(url);
      currentAudio = null;
      chrome.runtime.sendMessage({ type: 'AUDIO_ERROR', error: errMsg });
    });

    await currentAudio.play();
  } catch (err) {
    chrome.runtime.sendMessage({ type: 'AUDIO_ERROR', error: err.message });
  }
}

async function playSFX(sfxName) {
  try {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }

    const url = chrome.runtime.getURL(`sfx/${sfxName}.mp3`);
    currentAudio = new Audio(url);

    currentAudio.addEventListener('ended', () => {
      currentAudio = null;
      chrome.runtime.sendMessage({ type: 'SFX_DONE', sfx: sfxName });
    });

    currentAudio.addEventListener('error', () => {
      const errMsg = currentAudio?.error?.message || 'SFX playback failed';
      currentAudio = null;
      chrome.runtime.sendMessage({ type: 'SFX_DONE', sfx: sfxName, error: errMsg });
    });

    await currentAudio.play();
  } catch (err) {
    chrome.runtime.sendMessage({ type: 'SFX_DONE', sfx: sfxName, error: err.message });
  }
}
