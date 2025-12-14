// ==UserScript==
// @name         gronkh.tv Chat Auto-Scroll Fix
// @namespace    https://gronkh.tv/
// @version      0.2.0
// @description  Keeps chat pinned to the bottom when you’re at the bottom; stops auto-scrolling when you scroll up.
// @match        https://gronkh.tv/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    // How close to the bottom counts as "at bottom"
    bottomThresholdPx: 200,

    // How often we rescan the DOM for chat containers (SPA / lazy mount)
    rescanIntervalMs: 1500,

    // A scroll event within this window after a user input is considered "user initiated"
    userIntentWindowMs: 1200,

    // While pinned, periodically enforce bottom (handles sites that fight your scroll position)
    pinnedEnforceIntervalMs: 500,

    // Enable with: localStorage.setItem('gronkhTvAutoScrollFixDebug','1')
    debugStorageKey: 'gronkhTvAutoScrollFixDebug',
  };

  const stateByScrollEl = new WeakMap();
  const attached = new WeakSet();
  const attachedStrong = new Set();

  function debugEnabled() {
    try {
      return localStorage.getItem(CONFIG.debugStorageKey) === '1';
    } catch {
      return false;
    }
  }

  function log(...args) {
    if (!debugEnabled()) return;
    // eslint-disable-next-line no-console
    console.log('[gronkh.tv autoscroll fix]', ...args);
  }

  function isScrollable(el) {
    if (!el || !(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    const overflowY = style.overflowY;
    if (overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'overlay') return false;
    return el.scrollHeight - el.clientHeight > 20;
  }

  function distFromBottomPx(scrollEl) {
    return scrollEl.scrollHeight - (scrollEl.scrollTop + scrollEl.clientHeight);
  }

  function isNearBottom(scrollEl) {
    return distFromBottomPx(scrollEl) <= CONFIG.bottomThresholdPx;
  }

  function findNearestScrollableAncestor(el) {
    let cur = el;
    while (cur && cur !== document.documentElement) {
      if (isScrollable(cur)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  function findMessageContainer(scrollEl) {
    // Known replay-chat DOM: .cr-scroll-container > .cr-message-container
    const direct = scrollEl.querySelector(':scope > .cr-message-container');
    if (direct) return direct;

    const byClass = scrollEl.querySelector('.cr-message-container');
    if (byClass) return byClass;

    // Fallback: find an inner element with lots of message nodes.
    const candidate = scrollEl.querySelector('.cr-message-box')?.parentElement;
    if (candidate) return candidate;

    return scrollEl;
  }

  function scrollToBottom(scrollEl) {
    try {
      scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: 'auto' });
    } catch {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }
  }

  function setFloatButtonHidden(scrollEl, hidden) {
    // Known replay-chat "resume autoscroll" button
    const btn = scrollEl.querySelector('button.cr-content-float-scroll');
    if (!btn) return;
    btn.style.display = hidden ? 'none' : '';
  }

  function scheduleStickyScroll(scrollEl) {
    const st = stateByScrollEl.get(scrollEl);
    if (!st || !st.pinned) return;
    if (st.scrollScheduled) return;
    st.scrollScheduled = true;

    // Two frames: one for DOM insert, one for image/line-wrap reflow in many cases.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        st.scrollScheduled = false;
        if (!st.pinned) return;
        setFloatButtonHidden(scrollEl, true);
        scrollToBottom(scrollEl);
        // If something else moved us away from bottom, keep pinned and enforce again.
        if (!isNearBottom(scrollEl)) {
          requestAnimationFrame(() => {
            if (!st.pinned) return;
            setFloatButtonHidden(scrollEl, true);
            scrollToBottom(scrollEl);
          });
        }
      });
    });
  }

  function attachToScrollEl(scrollEl, reason) {
    if (!scrollEl || attached.has(scrollEl)) return;
    if (!isScrollable(scrollEl)) return;

    attached.add(scrollEl);
    attachedStrong.add(scrollEl);
    const messageContainer = findMessageContainer(scrollEl);

    // Prevent scroll anchoring from nudging the viewport away from the bottom when images/emotes load.
    try {
      scrollEl.style.overflowAnchor = 'none';
      if (messageContainer && messageContainer !== scrollEl) messageContainer.style.overflowAnchor = 'none';
    } catch {
      // ignore
    }

    const st = {
      pinned: isNearBottom(scrollEl),
      hasUserInteracted: false,
      scrollScheduled: false,
      lastUserIntentTs: 0,
      enforceTimer: null,
      teardown: [],
    };
    stateByScrollEl.set(scrollEl, st);

    log('attach', { reason, scrollEl, messageContainer });

    const markUserIntent = () => {
      st.hasUserInteracted = true;
      st.lastUserIntentTs = Date.now();
    };

    const onScroll = () => {
      const nearBottom = isNearBottom(scrollEl);
      const userIntent = Date.now() - st.lastUserIntentTs <= CONFIG.userIntentWindowMs;

      if (userIntent) {
        st.hasUserInteracted = true;
        st.pinned = nearBottom;
        setFloatButtonHidden(scrollEl, st.pinned);
        return;
      }

      // Ignore non-user scroll events while pinned. Some site logic (or layout shifts)
      // can move the scroll position slightly and then "disable" autoscroll.
      if (st.pinned) {
        setFloatButtonHidden(scrollEl, true);
        if (!nearBottom) scheduleStickyScroll(scrollEl);
        return;
      }

      // If something else brought us to bottom, resume.
      if (nearBottom) {
        st.pinned = true;
        setFloatButtonHidden(scrollEl, true);
      }
    };

    const onAutoScrollButtonClick = (ev) => {
      const target = ev.target instanceof Element ? ev.target : null;
      if (!target) return;
      const btn = target.closest('button');
      if (!btn) return;
      const text = (btn.textContent || '').trim();
      if (!text) return;
      if (!/Automatisch\\s+Scrollen/i.test(text)) return;
      // User explicitly asked to resume autoscroll.
      st.hasUserInteracted = true;
      st.pinned = true;
      st.lastUserIntentTs = Date.now();
      setFloatButtonHidden(scrollEl, true);
      scheduleStickyScroll(scrollEl);
    };

    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    scrollEl.addEventListener('wheel', markUserIntent, { passive: true });
    scrollEl.addEventListener('touchstart', markUserIntent, { passive: true });
    scrollEl.addEventListener('pointerdown', markUserIntent, { passive: true });
    scrollEl.addEventListener('keydown', markUserIntent, { passive: true });

    // Capture clicks inside the chat area to detect "Automatisch Scrollen" usage.
    scrollEl.addEventListener('click', onAutoScrollButtonClick, { capture: true });

    st.teardown.push(() => scrollEl.removeEventListener('scroll', onScroll));
    st.teardown.push(() => scrollEl.removeEventListener('wheel', markUserIntent));
    st.teardown.push(() => scrollEl.removeEventListener('touchstart', markUserIntent));
    st.teardown.push(() => scrollEl.removeEventListener('pointerdown', markUserIntent));
    st.teardown.push(() => scrollEl.removeEventListener('keydown', markUserIntent));
    st.teardown.push(() => scrollEl.removeEventListener('click', onAutoScrollButtonClick, true));

    const mo = new MutationObserver(() => {
      // If the user is at the bottom, keep it pinned.
      scheduleStickyScroll(scrollEl);
    });
    mo.observe(messageContainer, { childList: true, subtree: true, characterData: true });
    st.teardown.push(() => mo.disconnect());

    // Image/emote loads can change scrollHeight without DOM mutations.
    const onLoadCapture = (ev) => {
      if (!st.pinned) return;
      const t = ev.target;
      if (!(t instanceof Element)) return;
      if (t.tagName !== 'IMG' && t.tagName !== 'VIDEO') return;
      scheduleStickyScroll(scrollEl);
    };
    messageContainer.addEventListener('load', onLoadCapture, true);
    st.teardown.push(() => messageContainer.removeEventListener('load', onLoadCapture, true));

    // Initial “fix”: if the page loaded with chat at the top (common broken state),
    // jump to the bottom once unless the user already interacted.
    setTimeout(() => {
      if (!document.contains(scrollEl)) return;
      if (st.hasUserInteracted) return;
      if (scrollEl.scrollTop > 10) return;
      st.pinned = true;
      setFloatButtonHidden(scrollEl, true);
      scrollToBottom(scrollEl);
    }, 600);

    // Also keep pinned on viewport resize/layout changes.
    let ro = null;
    if ('ResizeObserver' in window) {
      ro = new ResizeObserver(() => scheduleStickyScroll(scrollEl));
      try {
        ro.observe(scrollEl);
        ro.observe(messageContainer);
      } catch {
        // ignore
      }
    }
    if (ro) st.teardown.push(() => ro.disconnect());

    // Periodic enforcement: if the site flips its own "autoscroll enabled" flag off,
    // it often stops sticking even though the user never scrolled up.
    st.enforceTimer = window.setInterval(() => {
      if (!document.contains(scrollEl)) return;
      if (!st.pinned) {
        setFloatButtonHidden(scrollEl, false);
        return;
      }
      setFloatButtonHidden(scrollEl, true);
      if (!isNearBottom(scrollEl)) scrollToBottom(scrollEl);
    }, CONFIG.pinnedEnforceIntervalMs);
    st.teardown.push(() => window.clearInterval(st.enforceTimer));
  }

  function scanAndAttach(reason) {
    // Cleanup detached elements to avoid leaked observers/listeners in SPA navigation.
    for (const el of attachedStrong) {
      if (document.contains(el)) continue;
      attachedStrong.delete(el);
      const st = stateByScrollEl.get(el);
      if (!st) continue;
      for (const fn of st.teardown) {
        try {
          fn();
        } catch {
          // ignore
        }
      }
      stateByScrollEl.delete(el);
    }

    // Known replay-chat structure.
    document.querySelectorAll('grnk-chat-replay .cr-scroll-container').forEach((el) => {
      attachToScrollEl(el, reason || 'scan:replay');
    });

    // Fallback: find the "Automatisch Scrollen" button and attach to its scrollable ancestor.
    const buttons = Array.from(document.querySelectorAll('button')).filter((b) =>
      /Automatisch\\s+Scrollen/i.test((b.textContent || '').trim()),
    );
    for (const btn of buttons) {
      const scrollEl = findNearestScrollableAncestor(btn);
      attachToScrollEl(scrollEl, reason || 'scan:button');
    }
  }

  function setupSpaRescan() {
    // Light rescan loop; avoids depending on framework internals.
    setInterval(() => scanAndAttach('interval'), CONFIG.rescanIntervalMs);

    // Also rescan on DOM mutations (throttled).
    let pending = false;
    const mo = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      setTimeout(() => {
        pending = false;
        scanAndAttach('dom');
      }, 250);
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  // Boot
  scanAndAttach('boot');
  setupSpaRescan();
})();
