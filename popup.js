const statusEl = document.getElementById('audio-status');
const loadBtn = document.getElementById('load-btn');
const offsetInput = document.getElementById('offset-input');
const resetOffsetPopup = document.getElementById('reset-offset-popup');
const syncBtn = document.getElementById('sync-btn');
const closeBtn = document.getElementById('close-btn');
const offsetMinus = document.getElementById('offset-minus');
const offsetPlus = document.getElementById('offset-plus');
const ejectBtn = document.getElementById('eject-btn');
const volumeSliderPopup = document.getElementById('volume-slider-popup');
const volumeValuePopup = document.getElementById('volume-value-popup');
const autoCorrectionPopup = document.getElementById('auto-correction-popup');
const pauseOnTabSwitchPopup = document.getElementById('pause-on-tab-switch-popup');

closeBtn.addEventListener('click', () => window.close());

async function getTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] && tabs[0].url.includes('twitch.tv') ? tabs[0] : null;
}

async function sendMsg(msg) {
  const tab = await getTab();
  if (!tab) {
    alert('Откройте вкладку с Twitch VOD');
    return;
  }
  return chrome.tabs.sendMessage(tab.id, msg);
}

function fmtTime(sec) {
  const sign = sec < 0 ? '-' : '';
  const absSec = Math.abs(sec);
  const h = Math.floor(absSec / 3600);
  const m = Math.floor((absSec % 3600) / 60);
  const s = Math.floor(absSec % 60);
  const ds = Math.floor((absSec % 1) * 10);
  return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${ds}`;
}

function parseOff(str) {
  let sign = 1;
  let s = str.trim();
  if (s.startsWith('-')) { sign = -1; s = s.slice(1); }
  else if (s.startsWith('+')) { s = s.slice(1); }
  const parts = s.split(':');
  let sec = 0;
  if (parts.length === 3) {
    const h = parseFloat(parts[0]) || 0;
    const m = parseFloat(parts[1]) || 0;
    const last = parts[2].split('.');
    const s_sec = parseFloat(last[0]) || 0;
    const ds = last.length > 1 ? parseFloat('0.' + last[1]) : 0;
    sec = h * 3600 + m * 60 + s_sec + ds;
  } else if (parts.length === 2) {
    const m = parseFloat(parts[0]) || 0;
    const last = parts[1].split('.');
    const s_sec = parseFloat(last[0]) || 0;
    const ds = last.length > 1 ? parseFloat('0.' + last[1]) : 0;
    sec = m * 60 + s_sec + ds;
  } else {
    sec = parseFloat(str) || 0;
  }
  return sign * sec;
}

function updateVolPop(value) {
  const vol = Math.min(100, Math.max(0, Math.round(value)));
  volumeSliderPopup.value = vol;
  volumeValuePopup.textContent = vol + '%';
  sendMsg({ action: 'setVolume', volume: vol });
}
volumeSliderPopup.addEventListener('input', () => {
  updateVolPop(parseInt(volumeSliderPopup.value, 10));
});

autoCorrectionPopup.addEventListener('change', () => {
  sendMsg({ action: 'setAutoCorrection', enabled: autoCorrectionPopup.checked });
});

pauseOnTabSwitchPopup.addEventListener('change', () => {
  sendMsg({ action: 'setPauseOnTabSwitch', enabled: pauseOnTabSwitchPopup.checked });
});

loadBtn.addEventListener('click', async () => {
  const [fileHandle] = await window.showOpenFilePicker({
    types: [{ accept: { 'audio/*': ['.mp3', '.wav', '.ogg', '.flac', '.aac'] } }]
  }).catch(() => null);
  if (!fileHandle) return;

  const file = await fileHandle.getFile();
  const arrayBuffer = await file.arrayBuffer();
  const fileName = file.name;

  await sendMsg({
    action: 'loadAudio',
    fileName,
    arrayBuffer: Array.from(new Uint8Array(arrayBuffer))
  });

  statusEl.textContent = `Аудио: ${fileName}`;
  syncBtn.disabled = false;
  syncBtn.textContent = '▶ Включить синхронизацию';
});

offsetInput.addEventListener('change', () => {
  const offset = parseOff(offsetInput.value);
  if (!isNaN(offset)) sendMsg({ action: 'setOffset', offset });
});

resetOffsetPopup.addEventListener('click', () => {
  offsetInput.value = fmtTime(0);
  sendMsg({ action: 'setOffset', offset: 0 });
});

offsetMinus.addEventListener('click', () => {
  let offset = parseOff(offsetInput.value);
  offset = Math.max(-10000, offset - 0.1);
  offsetInput.value = fmtTime(offset);
  sendMsg({ action: 'setOffset', offset });
});

offsetPlus.addEventListener('click', () => {
  let offset = parseOff(offsetInput.value);
  offset = Math.min(10000, offset + 0.1);
  offsetInput.value = fmtTime(offset);
  sendMsg({ action: 'setOffset', offset });
});

syncBtn.addEventListener('click', async () => {
  const isActive = syncBtn.textContent.includes('Выключить');
  if (isActive) {
    await sendMsg({ action: 'disableSync' });
    syncBtn.textContent = '▶ Включить синхронизацию';
  } else {
    await sendMsg({ action: 'enableSync' });
    syncBtn.textContent = '⏸ Выключить синхронизацию';
  }
});

ejectBtn.addEventListener('click', async () => {
  await sendMsg({ action: 'ejectCassette' });
  statusEl.textContent = 'Аудио не загружено';
  syncBtn.disabled = true;
  syncBtn.textContent = '▶ Включить синхронизацию';
});

(async () => {
  const tab = await getTab();
  if (!tab) return;
  chrome.tabs.sendMessage(tab.id, { action: 'getStatus' }, (response) => {
    if (response) {
      if (response.audioName) {
        statusEl.textContent = `Аудио: ${response.audioName}`;
        syncBtn.disabled = false;
      } else {
        statusEl.textContent = 'Аудио не загружено';
        syncBtn.disabled = true;
      }
      if (response.offset !== undefined) {
        offsetInput.value = fmtTime(response.offset);
      }
      if (response.syncActive) {
        syncBtn.textContent = '⏸ Выключить синхронизацию';
      } else {
        syncBtn.textContent = '▶ Включить синхронизацию';
      }
      if (response.volume !== undefined) {
        const vol = Math.round(response.volume);
        volumeSliderPopup.value = vol;
        volumeValuePopup.textContent = vol + '%';
      }
      if (response.autoCorrection !== undefined) {
        autoCorrectionPopup.checked = response.autoCorrection;
      }
      if (response.pauseOnTabSwitch !== undefined) {
        pauseOnTabSwitchPopup.checked = response.pauseOnTabSwitch;
      }
    }
  });
})();