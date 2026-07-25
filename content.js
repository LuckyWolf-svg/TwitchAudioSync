(async function() {
  'use strict';

  function waitVideo() {
    return new Promise((resolve) => {
      const el = document.querySelector('video');
      if (el) return resolve(el);
      const observer = new MutationObserver(() => {
        const el = document.querySelector('video');
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
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

  const video = await waitVideo();
  let audio = null;
  let audioContext = null;
  let gainNode = null;
  let sourceNode = null;

  let offset = 0;
  let syncActive = false;
  let audioName = null;
  let currentVolume = 1;
  let autoCorrectionEnabled = true;
  let pauseOnTabSwitch = false;
  let previousVolume = 100;
  let isMuted = false;
  let syncInterval = null;

  const panel = document.createElement('div');
  panel.id = 'audio-sync-panel';
  panel.className = 'hidden retro';
  panel.innerHTML = `
    <div class="panel-header" id="drag-handle" title="Перетащите панель">
      <span class="panel-title">Audio Sync</span>
      <button class="close-btn" id="close-panel-btn" title="Закрыть панель">✕</button>
    </div>
    <div class="panel-body">
      <div class="cassette-loader" id="cassette-loader" title="Кликните для загрузки аудиофайла">
        <div id="hki_player_wrapper">
          <div class="hki_back"></div>
          <div class="cassette-container">
            <div class="cassette" id="cassette">
              <div class="label">
                <div class="whiteStripe">
                  <span class="audio-name">A</span>
                </div>
              </div>
              <div class="middle">
                <div class="rotor L">
                  <ul>
                    <li></li><li></li><li></li><li></li><li></li><li></li>
                  </ul>
                </div>
                <div class="window"></div>
                <div class="rotor R">
                  <ul>
                    <li></li><li></li><li></li><li></li><li></li><li></li>
                  </ul>
                </div>
              </div>
              <div class="bottompart"></div>
            </div>
          </div>
          <div id="hki_cassette_player">
            <div class="hki_cassette_body">
              <div class="hki_cassette_wheel hki_wheel_left"><div></div></div>
              <div class="hki_cassette_wheel hki_wheel_right"><div></div></div>
            </div>
          </div>
        </div>
        <input type="file" id="file-input" accept="audio/*" style="display:none">
      </div>

      <div class="transport-row">
        <button id="offset-minus" class="offset-btn" title="Уменьшить отклонение на 0.1 секунды"><span class="btn-emoji">−</span></button>
        <button id="toggle-sync-btn" class="sync-btn" disabled title="Включить/выключить синхронизацию"><span class="btn-emoji">▶</span></button>
        <button id="eject-btn" class="stop-btn" title="Вытащить кассету (выгрузить аудио)"><span class="btn-emoji">⏹</span></button>
        <button id="offset-plus" class="offset-btn" title="Увеличить отклонение на 0.1 секунды"><span class="btn-emoji">+</span></button>
      </div>

      <div class="controls-row">
        <label>Отклонение</label>
        <input type="text" id="offset-input" value="00:00:00.0" size="12" title="Введите отклонение в формате ЧЧ:ММ:СС.д (например, 00:00:02.5)">
        <button id="reset-offset-btn" title="Сбросить отклонение в ноль">↺</button>
      </div>

      <div class="controls-row volume-row">
        <label>Громкость</label>
        <input type="range" id="volume-slider" min="0" max="200" value="100" step="1" title="Громкость аудио (от 0% до 200%)">
        <span id="volume-value">100%</span>
        <button id="mute-audio-btn" title="Вкл/Выкл звук"><span class="btn-emoji">🔊</span></button>
      </div>

      <div class="settings-row">
        <label title="Автоматически корректировать расхождение времени аудио и видео"><input type="checkbox" id="auto-correction-checkbox" checked> Автокоррекция</label>
        <label title="Автоматически ставить VOD на паузу при переключении вкладки"><input type="checkbox" id="pause-on-tab-switch-checkbox"> Пауза</label>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  const cassetteLoader = panel.querySelector('#cassette-loader');
  const fileInput = panel.querySelector('#file-input');
  const offsetInput = panel.querySelector('#offset-input');
  const resetOffsetBtn = panel.querySelector('#reset-offset-btn');
  const offsetMinus = panel.querySelector('#offset-minus');
  const offsetPlus = panel.querySelector('#offset-plus');
  const toggleSyncBtn = panel.querySelector('#toggle-sync-btn');
  const ejectBtn = panel.querySelector('#eject-btn');
  const volumeSlider = panel.querySelector('#volume-slider');
  const volumeValue = panel.querySelector('#volume-value');
  const muteBtn = panel.querySelector('#mute-audio-btn');
  const autoCorrectionCheckbox = panel.querySelector('#auto-correction-checkbox');
  const pauseOnTabSwitchCheckbox = panel.querySelector('#pause-on-tab-switch-checkbox');
  const closeBtn = panel.querySelector('#close-panel-btn');
  const dragHandle = panel.querySelector('#drag-handle');

  let isDragging = false;
  let dragOffsetX = 0, dragOffsetY = 0;

  function onDragStart(e) {
    if (e.button !== 0) return;
    const rect = panel.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    isDragging = true;
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
    e.preventDefault();
  }

  function onDragMove(e) {
    if (!isDragging) return;
    let left = e.clientX - dragOffsetX;
    let top = e.clientY - dragOffsetY;
    left = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, left));
    top = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, top));
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
    panel.style.right = 'auto';
  }

  function onDragEnd() {
    isDragging = false;
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
  }

  dragHandle.addEventListener('mousedown', onDragStart);

  function restorePanelPosition() {
    try {
      const pos = JSON.parse(localStorage.getItem('twitchAudioSyncPanelPos'));
      if (pos) {
        panel.style.left = pos.left + 'px';
        panel.style.top = pos.top + 'px';
        panel.style.right = 'auto';
      }
    } catch (e) {}
  }
  restorePanelPosition();

  function savePanelPosition() {
    const rect = panel.getBoundingClientRect();
    localStorage.setItem('twitchAudioSyncPanelPos', JSON.stringify({
      left: rect.left,
      top: rect.top
    }));
  }
  document.addEventListener('mouseup', () => {
    if (!isDragging) savePanelPosition();
  });

  function initAudio() {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (!gainNode) {
      gainNode = audioContext.createGain();
      gainNode.gain.value = currentVolume;
      gainNode.connect(audioContext.destination);
    }
    return { audioContext, gainNode };
  }

  function connectAudio(audioElement) {
    const { audioContext, gainNode } = initAudio();
    if (sourceNode) {
      try { sourceNode.disconnect(); } catch(e) {}
      sourceNode = null;
    }
    sourceNode = audioContext.createMediaElementSource(audioElement);
    sourceNode.connect(gainNode);
  }

  function setVol(value) {
    const vol = Math.min(200, Math.max(0, value));
    const volPercent = Math.round(vol);
    currentVolume = volPercent / 100;
    volumeSlider.value = volPercent;
    volumeValue.textContent = volPercent + '%';
    if (gainNode) {
      gainNode.gain.value = currentVolume;
    } else if (audio) {
      audio.volume = Math.min(1, currentVolume);
    }
    localStorage.setItem('twitchAudioSyncVolume', String(volPercent));
    if (isMuted && volPercent > 0) {
      isMuted = false;
      updateMuteButton();
    }
  }

  function restoreVol() {
    const saved = localStorage.getItem('twitchAudioSyncVolume');
    if (saved !== null) {
      const vol = parseFloat(saved);
      if (!isNaN(vol) && vol >= 0) {
        setVol(vol);
        return;
      }
    }
    setVol(100);
  }

  function toggleMute() {
    if (!audio) return;
    isMuted = !isMuted;
    if (isMuted) {
      previousVolume = Math.round(volumeSlider.value);
      setVol(0);
    } else {
      const vol = previousVolume > 0 ? previousVolume : 100;
      setVol(vol);
    }
    updateMuteButton();
  }

  function updateMuteButton() {
    const span = muteBtn.querySelector('.btn-emoji');
    if (span) {
      span.textContent = isMuted ? '🔇' : '🔊';
    }
  }

  volumeSlider.addEventListener('input', () => {
    setVol(parseFloat(volumeSlider.value));
  });
  muteBtn.addEventListener('click', toggleMute);

  function updateRotor(playing) {
    if (playing) {
      cassetteLoader.classList.add('playing');
    } else {
      cassetteLoader.classList.remove('playing');
    }
  }

  function updateName(name) {
    const audioNameSpan = panel.querySelector('.audio-name');
    if (audioNameSpan) {
      audioNameSpan.textContent = name || 'A';
    }
  }

  function setupEvents() {
    if (!audio) return;
    audio.addEventListener('play', () => updateRotor(true));
    audio.addEventListener('pause', () => updateRotor(false));
    updateRotor(!audio.paused);
  }

  function loadAudio(file) {
    if (!file) return;
    eject(true);
    const url = URL.createObjectURL(file);
    audio = new Audio(url);
    audio.preload = 'auto';
    audio.loop = false;
    connectAudio(audio);
    setupEvents();

    audioName = file.name;
    updateName(audioName);
    cassetteLoader.classList.add('inserted');
    updateBtn();

    if (!syncActive) {
      enable();
    } else {
      disable();
      enable();
    }
  }

  function eject(silent = false) {
    if (audio) {
      audio.pause();
      URL.revokeObjectURL(audio.src);
      audio = null;
    }
    if (sourceNode) {
      try { sourceNode.disconnect(); } catch(e) {}
      sourceNode = null;
    }
    if (syncActive) {
      disable();
    }
    if (!silent) {
      cassetteLoader.classList.remove('inserted');
      audioName = null;
      updateName('A');
      offset = 0;
      setOffInput(0);
      updateBtn();
      isMuted = false;
      updateMuteButton();
    }
  }

  cassetteLoader.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    fileInput.click();
  });
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      loadAudio(e.target.files[0]);
    }
    fileInput.value = '';
  });

  function applyOff() {
    if (!audio || !syncActive) return;
    const target = video.currentTime + offset;
    if (target < 0) {
      offset = -video.currentTime;
      setOffInput(offset);
      audio.currentTime = 0;
    } else {
      audio.currentTime = target;
    }
  }

  function setOffInput(value) {
    offsetInput.value = fmtTime(value);
  }

  function changeOff(delta) {
    offset = Math.max(-video.currentTime, offset + delta);
    setOffInput(offset);
    if (syncActive) applyOff();
  }

  function updateBtn() {
    toggleSyncBtn.disabled = !audio;
    const emojiSpan = toggleSyncBtn.querySelector('.btn-emoji');
    if (!audio) {
      if (emojiSpan) emojiSpan.textContent = '▶';
      return;
    }
    if (syncActive) {
      emojiSpan.textContent = '⏸';
    } else {
      emojiSpan.textContent = '▶';
    }
  }

  function syncPos() {
    if (!audio || !syncActive) return;

    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }

    if (video.paused && !audio.paused) {
      audio.pause();
    } else if (!video.paused && audio.paused) {
      if (document.visibilityState === 'visible' && audio.readyState >= 2) {
        audio.play().catch(() => {});
      }
    }

    if (autoCorrectionEnabled) {
      const target = video.currentTime + offset;
      if (target < 0) {
        offset = -video.currentTime;
        setOffInput(offset);
        audio.currentTime = 0;
      } else if (Math.abs(audio.currentTime - target) > 0.3) {
        audio.currentTime = target;
      }
    }
  }

  function startInt() {
    if (syncInterval) clearInterval(syncInterval);
    syncInterval = setInterval(syncPos, 150);
  }

  function stopInt() {
    if (syncInterval) {
      clearInterval(syncInterval);
      syncInterval = null;
    }
  }

  function enable() {
    if (!audio) return;
    syncActive = true;
    if (offset === 0 && audio.currentTime > 0) {
      offset = audio.currentTime - video.currentTime;
      setOffInput(offset);
    }
    applyOff();
    startInt();
    video.addEventListener('timeupdate', updateBtn);
    syncPos();
    updateBtn();
  }

  function disable() {
    syncActive = false;
    stopInt();
    if (audio) {
      audio.pause();
    }
    video.removeEventListener('timeupdate', updateBtn);
    updateBtn();
  }

  toggleSyncBtn.addEventListener('click', () => {
    if (!audio) return;
    if (syncActive) {
      disable();
    } else {
      enable();
    }
  });

  ejectBtn.addEventListener('click', () => eject(false));

  offsetInput.addEventListener('input', () => {
    const val = parseOff(offsetInput.value);
    if (!isNaN(val)) {
      offset = val;
      if (syncActive) applyOff();
    }
  });

  resetOffsetBtn.addEventListener('click', () => {
    offset = 0;
    setOffInput(0);
    if (syncActive) applyOff();
  });

  offsetMinus.addEventListener('click', () => changeOff(-0.1));
  offsetPlus.addEventListener('click', () => changeOff(0.1));

  closeBtn.addEventListener('click', () => {
    panel.classList.toggle('hidden');
    savePanelPosition();
  });

  autoCorrectionCheckbox.addEventListener('change', () => {
    autoCorrectionEnabled = autoCorrectionCheckbox.checked;
  });

  pauseOnTabSwitchCheckbox.addEventListener('change', () => {
    pauseOnTabSwitch = pauseOnTabSwitchCheckbox.checked;
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'togglePanel') {
      panel.classList.toggle('hidden');
      savePanelPosition();
      sendResponse({});
      return true;
    } else if (msg.action === 'loadAudio') {
      eject(true);
      const uint8Array = new Uint8Array(msg.arrayBuffer);
      const blob = new Blob([uint8Array], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      audio = new Audio(url);
      audio.preload = 'auto';
      connectAudio(audio);
      setupEvents();
      audioName = msg.fileName;
      updateName(audioName);
      cassetteLoader.classList.add('inserted');
      updateBtn();
      if (!syncActive) {
        enable();
      } else {
        disable();
        enable();
      }
      sendResponse({ success: true });
      return true;
    } else if (msg.action === 'setOffset') {
      offset = msg.offset;
      setOffInput(offset);
      if (syncActive) applyOff();
      sendResponse({});
      return true;
    } else if (msg.action === 'enableSync') {
      if (!audio) return sendResponse({ error: 'No audio' });
      enable();
      sendResponse({});
      return true;
    } else if (msg.action === 'disableSync') {
      disable();
      sendResponse({});
      return true;
    } else if (msg.action === 'getVideoTime') {
      sendResponse({ currentTime: video.currentTime });
      return true;
    } else if (msg.action === 'getStatus') {
      sendResponse({
        audioName,
        offset,
        syncActive,
        volume: Math.round(volumeSlider.value),
        autoCorrection: autoCorrectionEnabled,
        pauseOnTabSwitch: pauseOnTabSwitch
      });
      return true;
    } else if (msg.action === 'ejectCassette') {
      eject(false);
      sendResponse({});
      return true;
    } else if (msg.action === 'setVolume') {
      setVol(msg.volume);
      sendResponse({});
      return true;
    } else if (msg.action === 'setAutoCorrection') {
      autoCorrectionEnabled = msg.enabled;
      autoCorrectionCheckbox.checked = autoCorrectionEnabled;
      sendResponse({});
      return true;
    } else if (msg.action === 'setPauseOnTabSwitch') {
      pauseOnTabSwitch = msg.enabled;
      pauseOnTabSwitchCheckbox.checked = pauseOnTabSwitch;
      sendResponse({});
      return true;
    }
    return false;
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (audio && syncActive && pauseOnTabSwitch && !video.paused) {
        video.pause();
      }
      if (audio && syncActive && video.paused) {
        audio.pause();
      }
    } else if (document.visibilityState === 'visible') {
      if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {});
      }
      if (audio && syncActive && !video.paused && audio.paused && audio.readyState >= 2) {
        audio.play().catch(() => {});
      }
    }
  });

  updateBtn();
  restoreVol();
  setOffInput(0);
  updateMuteButton();
})();