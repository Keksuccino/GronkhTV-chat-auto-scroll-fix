// ==UserScript==
// @name         Gronkh.tv Chat Auto-Scroll Fix
// @namespace    https://gronkh.tv/
// @version      0.1.0
// @description  Replace broken auto-scroll with a forced bottom lock and footer toggle.
// @match        https://gronkh.tv/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'tmGronkhAutoScrollEnabled';
  const STYLE_ID = 'tm-gronkh-autoscroll-style';
  const TOGGLE_CLASS = 'tm-gronkh-autoscroll-toggle';
  const TOGGLE_SELECTOR = '.' + TOGGLE_CLASS;

  let autoScrollEnabled = loadSetting();
  let chatRoot = null;
  let scrollEl = null;
  let controlsEl = null;
  let mutationObserver = null;
  let resizeObserver = null;
  let intervalId = null;
  let rafId = null;
  let isForcing = false;

  function loadSetting() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return true;
    return raw === '1' || raw === 'true';
  }

  function saveSetting(value) {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      button.cr-content-float-scroll { display: none !important; }

      ${TOGGLE_SELECTOR} {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.35rem;
        padding: 0.35rem 0.5rem;
        border-radius: 0.5rem;
        border: 1px solid rgba(255, 255, 255, 0.18);
        background: rgba(255, 255, 255, 0.06);
        color: inherit;
        cursor: pointer;
        font-size: 11px;
        line-height: 1;
        white-space: nowrap;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      ${TOGGLE_SELECTOR} .tm-indicator {
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.35);
        box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.15) inset;
        flex: 0 0 auto;
      }

      ${TOGGLE_SELECTOR}[data-enabled="1"] {
        background: rgba(74, 234, 128, 0.16);
        border-color: rgba(74, 234, 128, 0.45);
      }

      ${TOGGLE_SELECTOR}[data-enabled="1"] .tm-indicator {
        background: #4aea80;
      }

      ${TOGGLE_SELECTOR}[data-enabled="0"] {
        opacity: 0.75;
      }
    `;
    document.head.appendChild(style);
  }

  function forceScrollToBottom() {
    if (!scrollEl) return;
    isForcing = true;
    scrollEl.scrollTop = scrollEl.scrollHeight;
    isForcing = false;
  }

  function scheduleForceScroll() {
    if (!autoScrollEnabled || !scrollEl) return;
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      forceScrollToBottom();
    });
  }

  function startAutoScroll() {
    if (intervalId !== null) return;
    intervalId = window.setInterval(() => {
      if (autoScrollEnabled) forceScrollToBottom();
    }, 250);
    forceScrollToBottom();
  }

  function stopAutoScroll() {
    if (intervalId === null) return;
    window.clearInterval(intervalId);
    intervalId = null;
  }

  function setEnabled(value) {
    autoScrollEnabled = value;
    saveSetting(value);
    updateToggle();
    if (autoScrollEnabled) {
      startAutoScroll();
    } else {
      stopAutoScroll();
    }
  }

  function updateToggle() {
    if (!controlsEl) return;
    const toggle = controlsEl.querySelector(TOGGLE_SELECTOR);
    if (!toggle) return;
    toggle.setAttribute('data-enabled', autoScrollEnabled ? '1' : '0');
    toggle.setAttribute('aria-pressed', autoScrollEnabled ? 'true' : 'false');
    const label = autoScrollEnabled ? 'Auto-Scroll: Ein' : 'Auto-Scroll: Aus';
    toggle.setAttribute('title', label);
    toggle.setAttribute('aria-label', label);
  }

  function ensureToggle() {
    if (!controlsEl) return;
    let toggle = controlsEl.querySelector(TOGGLE_SELECTOR);
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = TOGGLE_CLASS;
      toggle.innerHTML = '<span class="tm-label">Auto Scroll</span><span class="tm-indicator" aria-hidden="true"></span>';
      toggle.addEventListener('click', () => setEnabled(!autoScrollEnabled));
      controlsEl.appendChild(toggle);
    }
    updateToggle();
  }

  function cleanupChat() {
    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
    }
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (scrollEl) {
      scrollEl.removeEventListener('scroll', onScroll);
    }
    stopAutoScroll();
    chatRoot = null;
    scrollEl = null;
    controlsEl = null;
  }

  function onScroll() {
    if (!autoScrollEnabled || isForcing) return;
    scheduleForceScroll();
  }

  function setupChat(root) {
    const newScrollEl = root.querySelector('.cr-message-container');
    const newControlsEl = root.querySelector('.cr-controls');
    if (!newScrollEl || !newControlsEl) return;

    if (root === chatRoot && newScrollEl === scrollEl && newControlsEl === controlsEl) {
      return;
    }

    cleanupChat();
    chatRoot = root;
    scrollEl = newScrollEl;
    controlsEl = newControlsEl;

    ensureStyle();
    ensureToggle();

    scrollEl.addEventListener('scroll', onScroll, { passive: true });

    mutationObserver = new MutationObserver(() => {
      if (autoScrollEnabled) scheduleForceScroll();
    });
    mutationObserver.observe(scrollEl, { childList: true, subtree: true, characterData: true });

    if (window.ResizeObserver) {
      resizeObserver = new ResizeObserver(() => {
        if (autoScrollEnabled) scheduleForceScroll();
      });
      resizeObserver.observe(scrollEl);
    }

    if (autoScrollEnabled) {
      startAutoScroll();
    }
  }

  function tryInit() {
    const root = document.querySelector('grnk-chat-replay');
    if (!root) {
      if (chatRoot) cleanupChat();
      return;
    }
    setupChat(root);
  }

  function watchDom() {
    const observer = new MutationObserver(() => {
      tryInit();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    tryInit();
  }

  watchDom();
})();
