/**
 * App — root component. Orchestrates layout and component lifecycle.
 *
 * Layout:
 *   [Toolbar]
 *   [Compartments scroll area (horizontal)]
 *   [Spectrum visualizer (collapsible)]
 */

import { appStore } from '../core/AppStore';
import { playbackController } from '../core/PlaybackController';
import { ProjectSerializer } from '../codec/ProjectSerializer';
import { t, getLang } from '../core/i18n';
import { Toolbar } from './Toolbar';
import { CompartmentPanel } from './CompartmentPanel';
import { SpectrumVisualizer } from '../renderer/SpectrumVisualizer';
import { HistoryStore } from '../core/HistoryStore';
import type { HistoryEntry } from '../core/HistoryStore';
import { init as initWaline } from '@waline/client';
import { Mp3Exporter } from '../export/Mp3Exporter';
import * as Tone from 'tone';
import { AppConfig } from '../main_config';

export class App {
  private toolbar: Toolbar;
  private panels = new Map<string, CompartmentPanel>();
  private compartmentsEl!: HTMLElement;
  private visualizer!: SpectrumVisualizer;
  private _storeUnsub!: () => void;
  private _audioPlayer = new Audio();
  private _currentPlayingSrc: string | null = null;
  private _currentPlayingBtn: HTMLElement | null = null;

  constructor(private root: HTMLElement) {
    this.toolbar = new Toolbar();
    this._buildLayout();
    this._initCompartments();
    this._bindGlobalEvents();
    this._subscribeStore();
  }

  // ---- Layout ----

  private _buildLayout(): void {
    this.root.innerHTML = '';

    this.root.appendChild(this.toolbar.el);

    // Compartments area
    // Wrapper for relative positioning of the pin button
    const wrapWrapper = document.createElement('div');
    wrapWrapper.style.position = 'relative';
    wrapWrapper.style.width = '100%';
    this.root.appendChild(wrapWrapper);

    const wrap = document.createElement('div');
    wrap.className = 'compartments-area';
    wrap.id = 'compartments-area';
    this.compartmentsEl = wrap;
    wrapWrapper.appendChild(wrap);

    // Pin Button
    const pinBtn = document.createElement('button');
    pinBtn.className = 'btn-pin active';
    pinBtn.title = '锁定横向滚轮 (Lock Horizontal Scroll)';
    pinBtn.textContent = '📌';
    let isPinned = true;
    pinBtn.addEventListener('click', () => {
      isPinned = !isPinned;
      pinBtn.classList.toggle('active', isPinned);
      pinBtn.style.opacity = isPinned ? '1' : '0.5';
    });
    wrapWrapper.appendChild(pinBtn);

    const compartmentsResizer = document.createElement('div');
    compartmentsResizer.className = 'custom-resizer';
    wrapWrapper.appendChild(compartmentsResizer);
    this._bindResizer(compartmentsResizer, wrap);

    this._updateTexts = this._updateTexts.bind(this);
    window.addEventListener('i18n-change', this._updateTexts);

    // Map vertical mouse wheel to horizontal scrolling ONLY if pinned AND hovering grid
    this.compartmentsEl.addEventListener('wheel', (e: WheelEvent) => {
      if (isPinned && e.deltaY !== 0 && this.compartmentsEl.scrollWidth > this.compartmentsEl.clientWidth) {
        e.preventDefault();
        this.compartmentsEl.scrollLeft += e.deltaY;
      }
    }, { passive: false });

    // Touch swipe → horizontal scroll (mobile): one-finger swipe left/right
    let _touchStartX = 0;
    let _touchScrollLeft = 0;
    this.compartmentsEl.addEventListener('touchstart', (e: TouchEvent) => {
      _touchStartX = e.touches[0].clientX;
      _touchScrollLeft = this.compartmentsEl.scrollLeft;
    }, { passive: true });
    this.compartmentsEl.addEventListener('touchmove', (e: TouchEvent) => {
      const dx = _touchStartX - e.touches[0].clientX;
      this.compartmentsEl.scrollLeft = _touchScrollLeft + dx;
    }, { passive: true });

    // Bottom Panel
    const bottomPanel = document.createElement('div');
    bottomPanel.className = 'bottom-panel';
    this.root.appendChild(bottomPanel);

    // Codec data display/editor section
    const codecSection = document.createElement('section');
    codecSection.className = 'codec-section'; // default open
    codecSection.innerHTML = `
      <div class="codec-header">
        <div style="display:flex; align-items:center;">
          <span class="status-dot"></span>
          <span class="codec-title">${t('app.codecTitle')}</span>
        </div>
        <div class="codec-actions">
          <button class="codec-btn btn-ghost" id="btn-reset-codec">${t('app.codecReset')}</button>
          <button class="codec-btn btn-ghost" id="btn-copy-codec" title="${t('toolbar.saveTitle')}">${t('app.codecCopy')}</button>
          <button class="codec-btn btn-ghost" id="btn-load-mp3">${t('app.codecLoadMp3')}</button>
          <input type="file" id="input-load-mp3" accept=".mp3" style="display:none">
          <button class="codec-btn btn-accent-small" id="btn-apply-codec" title="${t('toolbar.loadTitle')}">${t('app.codecApply')}</button>
        </div>
      </div>
      <div class="codec-body">
        <textarea class="codec-textarea" id="codec-textarea" placeholder="${t('app.codecPlaceholder')}" spellcheck="false"></textarea>
        <div class="custom-resizer" id="codec-resizer"></div>
      </div>
    `;
    bottomPanel.appendChild(codecSection);

    const codecResizer = codecSection.querySelector('#codec-resizer') as HTMLElement;
    const codecTextarea = codecSection.querySelector('#codec-textarea') as HTMLElement;
    if (codecResizer && codecTextarea) {
      this._bindResizer(codecResizer, codecTextarea);
    }

    // Toggle codec
    codecSection.querySelector('.codec-header')?.addEventListener('click', (e) => {
      // Don't toggle if clicking on action buttons
      if ((e.target as HTMLElement).closest('.codec-btn')) return;
      codecSection.classList.toggle('codec-section--collapsed');
    });

    // Bind codec actions
    codecSection.querySelector('#btn-reset-codec')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(t('app.codecResetConfirm'))) {
        if (appStore.isPlaying) {
          playbackController.stop();
        }
        appStore.resetToDefault();
        this.root.dispatchEvent(new CustomEvent('app:project-loaded', { bubbles: true }));
        this._showToast(t('app.codecReset') + ' ✓');
      }
    });

    codecSection.querySelector('#btn-copy-codec')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const textarea = this.root.querySelector<HTMLTextAreaElement>('#codec-textarea');
      if (!textarea) return;
      try {
        await navigator.clipboard.writeText(textarea.value);
        this._showToast(t('app.codecCopySuccess'));
      } catch {
        textarea.select();
        this._showToast(t('app.codecCopyFailed'));
      }
    });

    const fileInput = codecSection.querySelector('#input-load-mp3') as HTMLInputElement;
    codecSection.querySelector('#btn-load-mp3')?.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput?.click();
    });

    fileInput?.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      
      try {
        const slice = file.slice(0, 1024 * 1024);
        const buffer = await slice.arrayBuffer();
        const code = Mp3Exporter.extractStateFromMp3(buffer);
        if (code) {
          const states = ProjectSerializer.deserialize(code);
          if (states && states.length > 0) {
            if (appStore.isPlaying) {
              playbackController.stop();
            }
            appStore.loadProject(states);
            this.root.dispatchEvent(new CustomEvent('app:project-loaded', { bubbles: true }));
            this._showToast(t('app.codecApplySuccess'));
          } else {
            this._showToast(t('app.codecInvalid'));
          }
        } else {
          this._showToast(t('app.loadFailed') + ' No ToneMatrix state found in this MP3');
        }
      } catch (err) {
        console.error('Error reading MP3:', err);
      } finally {
        fileInput.value = ''; // reset
      }
    });

    codecSection.querySelector('#btn-apply-codec')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const textarea = this.root.querySelector<HTMLTextAreaElement>('#codec-textarea');
      if (!textarea) return;
      const raw = textarea.value.trim();
      const states = ProjectSerializer.deserialize(raw);
      if (!states || states.length === 0) {
        this._showToast(t('app.codecInvalid'));
        return;
      }
      if (appStore.isPlaying) {
        playbackController.stop();
      }
      appStore.loadProject(states);
      this.root.dispatchEvent(new CustomEvent('app:project-loaded', { bubbles: true }));
      this._showToast(t('app.codecApplySuccess'));
      this._syncCodecTextarea(true);
    });

    // Initial sync of codec textarea
    this._syncCodecTextarea(true);

    // Description section
    const descSection = document.createElement('section');
    descSection.className = 'desc-section'; // default open
    descSection.innerHTML = `
      <div class="desc-header">
        <div style="display:flex; align-items:center;">
          <span class="status-dot"></span>
          <span class="desc-title">${t('app.descTitle')}</span>
        </div>
      </div>
      <div class="desc-body"></div>
    `;
    bottomPanel.appendChild(descSection);

    // Load description from file
    this._loadDescription();

    // Toggle description
    descSection.querySelector('.desc-header')?.addEventListener('click', () => {
      descSection.classList.toggle('desc-section--collapsed');
    });

    // Spectrum section
    const specSection = document.createElement('section');
    specSection.className = 'spectrum-section spectrum-section--collapsed'; // default closed

    const specHeader = document.createElement('div');
    specHeader.className = 'spectrum-header';
    specHeader.innerHTML = `
      <div style="display:flex; align-items:center;">
        <span class="status-dot"></span>
        <span class="spectrum-title">${t('app.spectrumTitle')}</span>
      </div>
    `;

    const specCanvas = document.createElement('canvas');
    specCanvas.className = 'spectrum-canvas';
    specCanvas.id = 'spectrum-canvas';

    specSection.append(specHeader, specCanvas);
    bottomPanel.appendChild(specSection);

    // Toggle spectrum
    specHeader.addEventListener('click', () => {
      specSection.classList.toggle('spectrum-section--collapsed');
    });

    // Visualizer
    this.visualizer = new SpectrumVisualizer(specCanvas);
    this.visualizer.start();

    // Showcase section unconditionally placed BEFORE waline section
    this._initShowcase(bottomPanel);

    // Waline section (conditional)
    if (AppConfig.enableComments) {
      const walineSection = document.createElement('section');
      walineSection.className = 'waline-section';
      walineSection.innerHTML = `
        <div class="waline-header">
          <div style="display:flex; align-items:center;">
            <span class="status-dot"></span>
            <span class="waline-title">${t('app.walineTitle')}</span>
          </div>
          <div style="display:flex; align-items:center; gap: 8px;">
            <button id="btn-my-history" class="btn-secondary" style="font-size: 11px; padding: 2px 6px;">${t('app.myHistory')}</button>
          </div>
        </div>
        <div class="waline-body">
          <div id="waline" style="padding: 16px; background: var(--bg-base); min-height: 200px;"></div>
        </div>
      `;
      bottomPanel.appendChild(walineSection);

      // Toggle waline
      walineSection.querySelector('.waline-header')?.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('#btn-my-history')) return;
        walineSection.classList.toggle('waline-section--collapsed');
        
        if (!walineSection.classList.contains('waline-section--collapsed')) {
          setTimeout(() => {
            walineSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 150);
        }
      });

      // Init Waline safely
      try {
        initWaline({
          el: '#waline',
          serverURL: AppConfig.walineServerURL, 
          dark: true,
          search: false,
          imageUploader: false,
        });
        this._initWalineObserver();
        this._initHistoryUI(walineSection.querySelector('#btn-my-history') as HTMLButtonElement);
      } catch (e) {
        console.error('Failed to initialize Waline:', e);
        const wEl = walineSection.querySelector('#waline') as HTMLElement;
        if (wEl) {
          wEl.innerHTML = `<div style="text-align:center; padding: 20px; color: var(--text-muted);">
            💬 评论区暂时无法加载 (Comments currently unavailable)<br/>
            <span style="font-size: 11px;">网络连接问题或服务器维护中</span>
          </div>`;
        }
      }
    }

    // Show global mobile pull-up hint
    if (window.innerWidth <= 640) {
      const hint = document.createElement('div');
      hint.className = 'mobile-scroll-hint';
      hint.textContent = t('panel.scrollHint');
      document.body.appendChild(hint);
      setTimeout(() => hint.remove(), 5500);
    }
  }

  private _bindResizer(resizer: HTMLElement, target: HTMLElement) {
    let startY = 0;
    let startHeight = 0;
    
    const onMouseMove = (e: MouseEvent) => {
      const dy = e.clientY - startY;
      target.style.height = `${Math.max(50, startHeight + dy)}px`;
    };
    
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      resizer.classList.remove('active');
    };
    
    resizer.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault();
      startY = e.clientY;
      startHeight = target.getBoundingClientRect().height;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      resizer.classList.add('active');
    });
  }

  private _initWalineObserver(): void {
    const target = this.root.querySelector('#waline');
    if (!target) return;

    const observer = new MutationObserver(() => {
      const contents = target.querySelectorAll('.wl-content p:not([data-processed])');
      contents.forEach(p => {
        p.setAttribute('data-processed', 'true');
        // Replace TMX_v2 code with play button and truncated snippet
        p.innerHTML = p.innerHTML.replace(/TMX_v2(?:\|[0-9a-zA-Z\.,\-]+)+/g, (match) => {
          const snippet = match.substring(0, 15) + '...';
          return `<div style="display:inline-flex; align-items:center; gap:8px; margin:4px 0;">
            <code style="font-size:11px; color:var(--text-secondary); background:rgba(255,255,255,0.05); padding:3px 6px; border-radius:4px; font-family:var(--font-mono);">${snippet}</code>
            <button class="btn-play-code btn-accent-small" data-code="${match}" title="${match}">▶ 加载代码</button>
          </div>`;
        });
      });
    });

    observer.observe(target, { childList: true, subtree: true });

    // Handle clicks on dynamically added buttons
    target.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.btn-play-code');
      if (!btn) return;
      const code = btn.getAttribute('data-code');
      if (code) {
        this._showConfirmModal(code, () => {
          const states = ProjectSerializer.deserialize(code);
          if (states && states.length > 0) {
            if (appStore.isPlaying) Tone.Transport.stop();
            appStore.loadProject(states);
            this.root.dispatchEvent(new CustomEvent('app:project-loaded', { bubbles: true }));
            this._showToast(t('app.codecApplySuccess') || '✓ 成功加载代码！');
          } else {
            this._showToast(t('app.codecInvalid') || '代码格式错误');
          }
        });
      }
    });
  }

  private _showConfirmModal(code: string, onConfirm: () => void) {
    const overlay = document.createElement('div');
    overlay.className = 'tmx-modal-overlay';
    overlay.innerHTML = `
      <div class="tmx-modal">
        <h3 style="margin-bottom: 12px; color: var(--text-primary); font-size: 16px;">⚠️ 确认加载代码</h3>
        <p style="color: var(--text-secondary); margin-bottom: 12px; font-size: 13px;">即将加载以下项目数据，当前内容会被覆盖。确定加载吗？</p>
        <textarea readonly class="codec-textarea" style="height: 120px; margin-bottom: 16px; font-size: 11px; width: 100%; border-color: var(--border); background: rgba(0,0,0,0.2); color: var(--text-muted); border-radius: 4px; padding: 8px;">${code}</textarea>
        <div style="display: flex; gap: 12px; justify-content: flex-end;">
          <button class="btn-ghost" id="btn-cancel" style="padding: 6px 16px; border-radius: 6px; cursor:pointer; color: var(--text-secondary);">取消</button>
          <button class="btn-accent-small" id="btn-confirm" style="padding: 6px 16px; font-size:13px;">确定加载</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#btn-cancel')!.addEventListener('click', () => overlay.remove());
    overlay.querySelector('#btn-confirm')!.addEventListener('click', () => {
      onConfirm();
      overlay.remove();
    });
  }

  private async _initShowcase(parent: HTMLElement): Promise<void> {
    const section = document.createElement('section');
    section.className = 'showcase-section showcase-section--collapsed';
    section.innerHTML = `
      <div class="showcase-header">
        <div style="display:flex; align-items:center;">
          <span class="status-dot"></span>
          <span class="showcase-title">${t('app.showcaseTitle')}</span>
        </div>
      </div>
      <div class="showcase-body">
        <div class="showcase-cols">
          <div class="showcase-col showcase-samples">
            <h4 class="showcase-col-title">${t('app.showcaseSamples')}</h4>
            <div class="showcase-list" id="sample-list">Loading...</div>
          </div>
          <div class="showcase-col showcase-music">
            <h4 class="showcase-col-title">${t('app.showcaseMusic')}</h4>
            <div class="showcase-list" id="music-list">Loading...</div>
          </div>
        </div>
        <div class="showcase-player" style="display:none;">
          <button class="player-playpause" id="player-playpause" title="Play/Pause">⏸</button>
          <span class="player-time" id="player-current">00:00</span>
          <input type="range" class="player-progress" id="player-progress" value="0" min="0" max="100" step="0.1">
          <span class="player-time" id="player-duration">00:00</span>
          <div class="player-volume-wrapper" title="Volume">
            <span style="font-size: 14px;">🔊</span>
            <input type="range" class="player-volume" id="player-volume" value="0.8" min="0" max="1" step="0.01">
          </div>
          <button class="player-close" id="player-close" title="Stop & Close">✖</button>
        </div>
      </div>
    `;
    parent.appendChild(section);
    
    // Toggle showcase
    section.querySelector('.showcase-header')?.addEventListener('click', (e) => {
      // Don't toggle if clicking inside player or action buttons
      if ((e.target as HTMLElement).closest('.showcase-player')) return;
      section.classList.toggle('showcase-section--collapsed');
    });

    const playerContainer = section.querySelector('.showcase-player') as HTMLElement;
    const playPauseBtn = section.querySelector('#player-playpause') as HTMLElement;
    const progressSlider = section.querySelector('#player-progress') as HTMLInputElement;
    const currentTimeEl = section.querySelector('#player-current') as HTMLElement;
    const durationEl = section.querySelector('#player-duration') as HTMLElement;
    const volumeSlider = section.querySelector('#player-volume') as HTMLInputElement;
    const closeBtn = section.querySelector('#player-close') as HTMLElement;

    // Set default volume
    this._audioPlayer.volume = parseFloat(volumeSlider.value);

    const formatTime = (seconds: number) => {
      if (isNaN(seconds) || !isFinite(seconds)) return '00:00';
      const m = Math.floor(seconds / 60);
      const s = Math.floor(seconds % 60);
      return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    let isDraggingProgress = false;

    progressSlider.addEventListener('input', () => {
      isDraggingProgress = true;
      currentTimeEl.textContent = formatTime(parseFloat(progressSlider.value));
    });

    progressSlider.addEventListener('change', () => {
      this._audioPlayer.currentTime = parseFloat(progressSlider.value);
      isDraggingProgress = false;
    });

    playPauseBtn.addEventListener('click', () => {
      if (this._audioPlayer.paused) {
        this._audioPlayer.play().catch(console.error);
        playPauseBtn.textContent = '⏸';
      } else {
        this._audioPlayer.pause();
        playPauseBtn.textContent = '▶';
      }
    });

    volumeSlider.addEventListener('input', () => {
      this._audioPlayer.volume = parseFloat(volumeSlider.value);
    });

    closeBtn.addEventListener('click', () => {
      this._audioPlayer.pause();
      this._audioPlayer.currentTime = 0;
      this._updatePlayingUI(null, null);
    });

    this._audioPlayer.addEventListener('timeupdate', () => {
      if (!isDraggingProgress) {
        progressSlider.value = this._audioPlayer.currentTime.toString();
        currentTimeEl.textContent = formatTime(this._audioPlayer.currentTime);
      }
    });

    this._audioPlayer.addEventListener('loadedmetadata', () => {
      progressSlider.max = this._audioPlayer.duration.toString();
      durationEl.textContent = formatTime(this._audioPlayer.duration);
    });

    this._audioPlayer.addEventListener('ended', () => {
      this._updatePlayingUI(null, null);
    });
    this._audioPlayer.addEventListener('pause', () => {
      playPauseBtn.textContent = '▶';
      this._updatePlayingUI(this._currentPlayingSrc, this._currentPlayingBtn);
    });
    this._audioPlayer.addEventListener('play', () => {
      playPauseBtn.textContent = '⏸';
      playerContainer.style.display = 'flex';
    });

    try {
      const res = await fetch('pm/index.json');
      if (!res.ok) throw new Error('Failed to fetch index');
      const data = await res.json();
      
      if (!data.folders || data.folders.length === 0) {
        section.style.display = 'none';
        return;
      }

      const sampleList = section.querySelector('#sample-list') as HTMLElement;
      const musicList = section.querySelector('#music-list') as HTMLElement;
      sampleList.innerHTML = '';
      musicList.innerHTML = '';

      let hasSamples = false;

      const playAudio = (src: string, btn: HTMLElement) => {
        if (this._currentPlayingSrc === src && !this._audioPlayer.paused) {
          this._audioPlayer.pause();
          return;
        }
        
        if (appStore.isPlaying) {
          playbackController.stop();
        }

        this._audioPlayer.src = `pm/${src}`;
        this._audioPlayer.play().catch(console.error);
        this._updatePlayingUI(src, btn);
      };

      const renderMusicList = (folder: any) => {
        musicList.innerHTML = '';
        if (!folder.songs || folder.songs.length === 0) {
          musicList.innerHTML = '<div class="empty-text">No tracks found</div>';
          return;
        }
        for (const song of folder.songs) {
          const item = document.createElement('div');
          item.className = 'showcase-item';
          item.innerHTML = `<button class="btn-play-audio btn-play-music" data-src="${song.path}">▶</button> <span class="item-name">${song.name}</span>`;
          
          const btn = item.querySelector('.btn-play-audio') as HTMLElement;
          if (btn) {
            btn.addEventListener('click', () => playAudio(song.path, btn));
          }
          musicList.appendChild(item);
        }
        
        // Restore playing UI state if the currently playing song is in this list
        if (this._currentPlayingSrc && !this._audioPlayer.paused) {
          const currentBtn = Array.from(musicList.querySelectorAll('.btn-play-audio')).find(b => b.getAttribute('data-src') === this._currentPlayingSrc) as HTMLElement;
          if (currentBtn) {
            this._updatePlayingUI(this._currentPlayingSrc, currentBtn);
          }
        }
      };

      let firstFolder = data.folders.find((f: any) => f.name !== 'common');
      if (!firstFolder && data.folders.length > 0) firstFolder = data.folders[0];

      for (const folder of data.folders) {
        hasSamples = true;
        const item = document.createElement('div');
        item.className = 'showcase-item folder-item';
        if (folder === firstFolder) item.classList.add('active');

        let btnHtml = '';
        if (folder.sample) {
          btnHtml = `<button class="btn-play-audio btn-play-sample" data-src="${folder.sample}">▶</button>`;
        }
        
        const folderDisplayName = folder.name === 'common' ? 'Common (其他)' : folder.name;
        item.innerHTML = `${btnHtml} <span class="item-name" style="flex:1; cursor:pointer;">${folderDisplayName}</span>`;
        
        const btn = item.querySelector('.btn-play-audio') as HTMLElement;
        if (btn) {
          btn.addEventListener('click', (e) => {
            e.stopPropagation(); // prevent folder selection if they just want to play sample
            playAudio(folder.sample, btn);
          });
        }
        
        item.addEventListener('click', () => {
          section.querySelectorAll('.folder-item').forEach(el => el.classList.remove('active'));
          item.classList.add('active');
          renderMusicList(folder);
        });

        if (folder.name === 'common') {
          // Append common outside the scrollable list
          item.style.borderTop = '1px solid rgba(255,255,255,0.1)';
          item.style.marginTop = '4px';
          sampleList.parentElement?.appendChild(item);
        } else {
          sampleList.appendChild(item);
        }
      }

      if (!hasSamples) {
        sampleList.innerHTML = '<div class="empty-text">No samples found</div>';
      } else if (firstFolder) {
        renderMusicList(firstFolder);
      }

    } catch (e) {
      console.warn('Could not load showcase pm data:', e);
      section.style.display = 'none';
    }
  }

  private _updatePlayingUI(src: string | null, btn: HTMLElement | null) {
    this._currentPlayingSrc = src;
    this._currentPlayingBtn = btn;
    
    // Reset all buttons in showcase
    const allBtns = this.root.querySelectorAll('.btn-play-audio');
    allBtns.forEach(b => {
      b.textContent = '▶';
      b.classList.remove('playing');
    });

    if (btn && !this._audioPlayer.paused) {
      btn.textContent = '⏸';
      btn.classList.add('playing');
    }
    
    if (this._audioPlayer.paused && (!src || this._audioPlayer.currentTime === 0)) {
      const playerContainer = this.root.querySelector('.showcase-player') as HTMLElement;
      if (playerContainer) {
          playerContainer.style.display = 'none';
      }
    }
  }

  // ---

  private _initHistoryUI(btn: HTMLButtonElement): void {
    const modal = document.createElement('div');
    modal.className = 'history-modal';
    modal.style.cssText = `
      display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.6); z-index: 1000; justify-content: center; align-items: center;
    `;

    const content = document.createElement('div');
    content.style.cssText = `
      background: var(--color-bg-panel); width: 600px; max-width: 90%; max-height: 80vh;
      border-radius: 8px; display: flex; flex-direction: column; overflow: hidden;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    `;

    const header = document.createElement('div');
    header.style.cssText = 'padding: 16px; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; justify-content: space-between; align-items: center;';
    header.innerHTML = `<strong style="color: var(--color-text-main);">🕒 我的本地发言缓存</strong>
                        <button class="btn-close-modal" style="background: none; border: none; color: #aaa; cursor: pointer; font-size: 20px;">×</button>`;

    const list = document.createElement('div');
    list.style.cssText = 'padding: 16px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 12px;';

    content.append(header, list);
    modal.appendChild(content);
    document.body.appendChild(modal);

    // Render lists
    const renderList = () => {
      list.innerHTML = '';
      const entries = HistoryStore.getHistory();
      if (entries.length === 0) {
        list.innerHTML = `<div style="text-align: center; color: #888; padding: 32px;">暂无本地发言记录。</div>`;
        return;
      }
      entries.forEach(entry => {
        const item = document.createElement('div');
        item.style.cssText = 'background: rgba(255,255,255,0.05); padding: 12px; border-radius: 6px;';

        const time = new Date(entry.timestamp).toLocaleString();
        item.innerHTML = `
          <div style="font-size: 12px; color: #888; margin-bottom: 8px;">${time}</div>
          <div style="color: #ccc; margin-bottom: 12px; white-space: pre-wrap; font-size: 14px;">${entry.text.replace(/544d5802[0-9a-fA-F]+/g, '[代码已折叠]')}</div>
          <div style="display: flex; gap: 8px;">
            <button class="btn-accent-small btn-hist-play" data-code="${entry.code}">▶ 加载此代码</button>
            <button class="btn-danger btn-hist-del" data-id="${entry.id}" style="padding: 4px 8px; font-size: 12px;">🗑 删除记录</button>
          </div>
        `;
        list.appendChild(item);
      });
    };

    btn.addEventListener('click', () => {
      renderList();
      modal.style.display = 'flex';
    });

    header.querySelector('.btn-close-modal')!.addEventListener('click', () => {
      modal.style.display = 'none';
    });

    list.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('btn-hist-play')) {
        const code = target.getAttribute('data-code');
        if (code) {
          const states = ProjectSerializer.deserialize(code);
          if (states) {
            appStore.loadProject(states);
            this.root.dispatchEvent(new CustomEvent('app:project-loaded', { bubbles: true }));
            this._showToast('✓ 代码已加载');
            this._syncCodecTextarea(true);
            modal.style.display = 'none';
          }
        }
      } else if (target.classList.contains('btn-hist-del')) {
        const id = target.getAttribute('data-id');
        if (id) {
          HistoryStore.removeHistory(id);
          renderList();
        }
      }
    });

    window.addEventListener('tmx-history-changed', renderList);
  }

  private _updateTexts(): void {
    const specTitle = this.root.querySelector('.spectrum-title');
    if (specTitle) specTitle.textContent = t('app.spectrumTitle');
    const specToggle = this.root.querySelector('#btn-toggle-spectrum') as HTMLElement;
    if (specToggle) specToggle.title = t('app.toggleTitle');

    const codecTitle = this.root.querySelector('.codec-title');
    if (codecTitle) codecTitle.textContent = t('app.codecTitle');
    const codecToggle = this.root.querySelector('#btn-toggle-codec') as HTMLElement;
    if (codecToggle) codecToggle.title = t('app.toggleTitle');
    
    const resetBtn = this.root.querySelector('#btn-reset-codec');
    if (resetBtn) {
        resetBtn.textContent = t('app.codecReset');
    }

    const copyCodec = this.root.querySelector('#btn-copy-codec') as HTMLElement;
    if (copyCodec) {
      copyCodec.title = t('toolbar.saveTitle'); // reuse
      copyCodec.textContent = t('app.codecCopy');
    }
    const applyCodec = this.root.querySelector('#btn-apply-codec') as HTMLElement;
    if (applyCodec) {
      applyCodec.title = t('toolbar.loadTitle'); // reuse
      applyCodec.textContent = t('app.codecApply');
    }
    const btnLoadMp3 = this.root.querySelector('#btn-load-mp3') as HTMLElement;
    if (btnLoadMp3) {
      btnLoadMp3.textContent = t('app.codecLoadMp3');
    }
    const codecTextarea = this.root.querySelector('#codec-textarea') as HTMLTextAreaElement;
    if (codecTextarea) codecTextarea.placeholder = t('app.codecPlaceholder');

    const descTitle = this.root.querySelector('.desc-title');
    if (descTitle) descTitle.textContent = t('app.descTitle');
    const descToggle = this.root.querySelector('#btn-toggle-desc') as HTMLElement;
    if (descToggle) descToggle.title = t('app.toggleTitle');

    const showcaseTitle = this.root.querySelector('.showcase-title');
    if (showcaseTitle) showcaseTitle.textContent = t('app.showcaseTitle');
    const showcaseSamples = this.root.querySelector('.showcase-samples .showcase-col-title');
    if (showcaseSamples) showcaseSamples.textContent = t('app.showcaseSamples');
    const showcaseMusic = this.root.querySelector('.showcase-music .showcase-col-title');
    if (showcaseMusic) showcaseMusic.textContent = t('app.showcaseMusic');

    const walineTitle = this.root.querySelector('.waline-title');
    if (walineTitle) walineTitle.textContent = t('app.walineTitle');
    
    const btnMyHistory = this.root.querySelector('#btn-my-history');
    if (btnMyHistory) btnMyHistory.textContent = t('app.myHistory');

    // Reload description
    this._loadDescription();
  }


  private _loadDescription(): void {
    const lang = getLang();
    fetch(`description_${lang}.html`)
      .then(res => res.text())
      .then(html => {
        const body = this.root.querySelector('.desc-body') as HTMLElement;
        if (body) body.innerHTML = html;
      })
      .catch(err => console.warn('Failed to load description:', err));
  }

  // ---- Compartment management ----

  private _initCompartments(): void {
    for (const state of appStore.getAll()) {
      this._addPanel(state.config.id);
    }
  }

  private _addPanel(id: string): void {
    if (this.panels.has(id)) return;
    const panel = new CompartmentPanel(id);
    this.panels.set(id, panel);
    this.compartmentsEl.appendChild(panel.el);
    this._bindPanelEvents(panel);

    // Animate in
    requestAnimationFrame(() => panel.el.classList.add('comp--visible'));
  }

  private _removePanel(id: string): void {
    const panel = this.panels.get(id);
    if (panel) {
      panel.destroy();
      panel.el.remove();
      this.panels.delete(id);
    }
  }

  private _bindPanelEvents(panel: CompartmentPanel): void {
    panel.el.addEventListener('compartment:add', (e) => {
      const { afterId } = (e as CustomEvent).detail;
      const newId = appStore.addCompartment(afterId);
    });

    panel.el.addEventListener('compartment:remove', (e) => {
      const { id } = (e as CustomEvent).detail;
      appStore.removeCompartment(id);
    });

    panel.el.addEventListener('compartment:duplicate', (e) => {
      const { newId } = (e as CustomEvent).detail;
      this._addPanel(newId);
    });
  }

  // ---- Global events ----

  private _bindGlobalEvents(): void {
    window.addEventListener('resize', () => {
      this.panels.forEach(p => p.resize());
    });

    this.root.addEventListener('app:compartment-added', (e) => {
      const { id } = (e as CustomEvent).detail;
      this._addPanel(id);
    });

    this.root.addEventListener('app:project-loaded', () => {
      for (const id of [...this.panels.keys()]) {
        this._removePanel(id);
      }
      for (const state of appStore.getAll()) {
        this._addPanel(state.config.id);
      }
      this._syncCodecTextarea(true);
    });

    // PWA Install Logic
    let deferredPrompt: any = null;
    window.addEventListener('beforeinstallprompt', (e) => {
      // Prevent Chrome 67 and earlier from automatically showing the prompt
      e.preventDefault();
      // Stash the event so it can be triggered later.
      deferredPrompt = e;
    });

    this.root.addEventListener('app:install-pwa', async () => {
      if (deferredPrompt) {
        // Show the install prompt
        deferredPrompt.prompt();
        // Wait for the user to respond to the prompt
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          deferredPrompt = null;
        }
      } else {
        // Fallback for browsers that don't support programmatic install prompt
        // (like iOS Safari or many Chinese browsers)
        this._showToast(t('app.pwaFallback'));
      }
    });

    // Drag-and-drop MP3 to load state
    document.body.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    });

    document.body.addEventListener('drop', async (e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      if (!file.name.toLowerCase().endsWith('.mp3')) return;

      try {
        // Only read the first 1MB to avoid memory crash and we know ID3 is at the beginning
        const slice = file.slice(0, 1024 * 1024);
        const buffer = await slice.arrayBuffer();
        const code = Mp3Exporter.extractStateFromMp3(buffer);
        if (code) {
          const states = ProjectSerializer.deserialize(code);
          if (states && states.length > 0) {
            if (appStore.isPlaying) {
              playbackController.stop();
            }
            appStore.loadProject(states);
            this.root.dispatchEvent(new CustomEvent('app:project-loaded', { bubbles: true }));
            this._showToast(t('app.codecApplySuccess'));
          } else {
            this._showToast(t('app.codecInvalid'));
          }
        } else {
          this._showToast(t('app.loadFailed') + ' No ToneMatrix state found in this MP3');
        }
      } catch (err) {
        console.error('Error reading dropped MP3:', err);
      }
    });
  }

  // ---- Store subscription ----

  private _subscribeStore(): void {
    this._storeUnsub = appStore.subscribe(async (event) => {
      if (event.type === 'PLAYBACK_STARTED') {
        if (this._currentPlayingSrc && !this._audioPlayer.paused) {
          this._audioPlayer.pause();
        }
      }

      if (event.type === 'COMPARTMENT_ADDED') {
        this._addPanel(event.compartmentId);
        this._syncCodecTextarea();
      } else if (event.type === 'COMPARTMENT_REMOVED') {
        this._removePanel(event.compartmentId);
        appStore.relabelAll();
        this._syncCodecTextarea();
      } else if (
        event.type === 'GRID_CHANGED' ||
        event.type === 'GRID_CLEARED' ||
        event.type === 'COMPARTMENT_CONFIG_CHANGED' ||
        event.type === 'PROJECT_LOADED'
      ) {
        this._syncCodecTextarea(event.type === 'PROJECT_LOADED');
      } else if (event.type === 'PLAYBACK_STARTED') {
        // Connect visualizer after AudioContext is running
        this._tryConnectVisualizer();
      }
    });
  }

  private _visualizerConnected = false;

  private _tryConnectVisualizer(): void {
    if (this._visualizerConnected) return;
    try {
      const ctx = Tone.getContext().rawContext as AudioContext;
      // Connect analyser to the raw Web Audio destination node
      const dest = (Tone.getDestination() as unknown as { input: AudioNode }).input;
      this.visualizer.connect(ctx, dest ?? ctx.destination);
      this._visualizerConnected = true;
    } catch { /* AudioContext not ready yet */ }
  }

  private _syncCodecTextarea(force = false): void {
    const textarea = this.root.querySelector<HTMLTextAreaElement>('#codec-textarea');
    if (!textarea) return;
    if (force || document.activeElement !== textarea) {
      textarea.value = ProjectSerializer.serialize(appStore.getAll());
    }
  }

  private _showToast(msg: string): void {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast--visible'));
    setTimeout(() => {
      toast.classList.remove('toast--visible');
      setTimeout(() => toast.remove(), 400);
    }, 2500);
  }
}
