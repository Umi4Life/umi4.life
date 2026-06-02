(function () {
  "use strict";

  var STATE_KEY = "umi4life:meting-player";
  var UNLOCK_KEY = "umi4life:meting-autoplay";
  var MUTED_HINT_ATTR = "data-umi-muted-hint";
  var LEGACY_ROOT_ID = "umi-persistent-meting-root";
  var CANONICAL_ATTR = "data-umi-canonical";
  var DEFAULT_VOLUME = 0.3;
  var saveTimer = null;
  var observer = null;

  function destroyAPlayer(ap) {
    if (!ap) return;
    try {
      if (typeof ap.destroy === "function") ap.destroy();
    } catch (_) {}
  }

  function unwrapLegacyRoot() {
    var root = document.getElementById(LEGACY_ROOT_ID);
    if (!root) return;

    var container = document.querySelector(".sidebar-wrapper-container");
    var wrapper = container && container.querySelector(".sidebar-wrapper");
    var metings = root.querySelectorAll("meting-js");

    for (var i = 0; i < metings.length; i++) {
      if (wrapper && wrapper.parentNode === container) {
        container.insertBefore(metings[i], wrapper.nextSibling);
      } else if (container) {
        container.appendChild(metings[i]);
      }
    }

    root.remove();
  }

  function pickKeeper(all) {
    var keeper = document.querySelector("meting-js[" + CANONICAL_ATTR + '="true"]');
    if (keeper) return keeper;

    for (var i = 0; i < all.length; i++) {
      if (all[i].aplayer && all[i].aplayer.audio && !all[i].aplayer.audio.paused) {
        return all[i];
      }
    }

    for (var j = 0; j < all.length; j++) {
      if (all[j].aplayer) return all[j];
    }

    return all[0] || null;
  }

  function trimExtraAPlayersInMeting(meting) {
    if (!meting) return;

    var nodes = meting.querySelectorAll(":scope > .aplayer");
    for (var i = nodes.length - 1; i >= 1; i--) {
      var node = nodes[i];
      if (window.aplayers) {
        for (var a = 0; a < window.aplayers.length; a++) {
          if (window.aplayers[a].template === node) {
            destroyAPlayer(window.aplayers[a]);
            break;
          }
        }
      }
      node.remove();
    }
  }

  function dedupeGlobalAPlayers(keeperAp) {
    if (!window.aplayers || !window.aplayers.length) return;

    var list = window.aplayers.slice();
    for (var i = 0; i < list.length; i++) {
      var ap = list[i];
      if (ap === keeperAp) continue;
      destroyAPlayer(ap);
      var idx = window.aplayers.indexOf(ap);
      if (idx > -1) window.aplayers.splice(idx, 1);
    }
  }

  function removeOrphanAPlayers(keeper) {
    var allPlayers = document.querySelectorAll(".aplayer");
    for (var i = 0; i < allPlayers.length; i++) {
      var node = allPlayers[i];
      if (keeper && keeper.contains(node)) continue;
      node.remove();
    }
  }

  function dedupeMeting() {
    unwrapLegacyRoot();

    var all = document.querySelectorAll("meting-js");
    if (!all.length) return null;

    var keeper = pickKeeper(all);
    if (!keeper) return null;

    keeper.setAttribute(CANONICAL_ATTR, "true");

    for (var j = 0; j < all.length; j++) {
      var el = all[j];
      if (el !== keeper) {
        destroyAPlayer(el.aplayer);
        el.remove();
      }
    }

    var keeperAp = keeper.aplayer || null;
    trimExtraAPlayersInMeting(keeper);
    dedupeGlobalAPlayers(keeperAp);
    removeOrphanAPlayers(keeper);

    return keeper;
  }

  function getMetingEl() {
    return document.querySelector("meting-js[" + CANONICAL_ATTR + '="true"]');
  }

  function getAPlayer() {
    var el = getMetingEl();
    if (el && el.aplayer) return el.aplayer;
    return null;
  }

  function isUnlocked() {
    return !!localStorage.getItem(UNLOCK_KEY);
  }

  function getConfiguredVolume(ap) {
    var meting = getMetingEl();
    if (meting) {
      var parsed = parseFloat(meting.getAttribute("volume"));
      if (!isNaN(parsed)) return parsed;
    }
    if (ap && typeof ap.volume === "function") {
      var current = ap.volume();
      if (typeof current === "number" && current > 0) return current;
    }
    return DEFAULT_VOLUME;
  }

  function isPausedFromStorage() {
    var raw = sessionStorage.getItem(STATE_KEY);
    if (!raw) return false;
    try {
      return JSON.parse(raw).paused === true;
    } catch (_) {
      return false;
    }
  }

  function setMutedHint(show) {
    var meting = getMetingEl();
    if (!meting) return;
    if (show && !isUnlocked()) {
      meting.setAttribute(MUTED_HINT_ATTR, "true");
    } else {
      meting.removeAttribute(MUTED_HINT_ATTR);
    }
  }

  function runPlay(ap) {
    var result = ap.play();
    if (result && typeof result.then === "function") {
      return result;
    }
    return Promise.resolve();
  }

  function playMuted(ap) {
    if (!ap || !ap.audio) return Promise.resolve(false);
    ap.audio.muted = true;
    setMutedHint(true);
    return runPlay(ap)
      .then(function () {
        return true;
      })
      .catch(function () {
        return false;
      });
  }

  function attemptPlay(ap) {
    if (!ap || !ap.audio) return Promise.resolve(false);
    if (isPausedFromStorage()) return Promise.resolve(false);

    if (isUnlocked()) {
      ap.audio.muted = false;
      if (typeof ap.volume === "function") {
        ap.volume(getConfiguredVolume(ap), true);
      }
      setMutedHint(false);
      return runPlay(ap)
        .then(function () {
          return true;
        })
        .catch(function () {
          return playMuted(ap);
        });
    }

    return playMuted(ap);
  }

  function unlockAudio(ap) {
    ap = ap || getAPlayer();
    if (!ap || !ap.audio) return;

    localStorage.setItem(UNLOCK_KEY, "1");
    ap.audio.muted = false;
    if (typeof ap.volume === "function") {
      ap.volume(getConfiguredVolume(ap), true);
    }
    setMutedHint(false);

    if (ap.audio.paused && !isPausedFromStorage()) {
      var result = ap.play();
      if (result && typeof result.catch === "function") {
        result.catch(function () {});
      }
    }
    saveState();
  }

  function schedulePlayRetries(ap) {
    if (!ap || ap.__umiRetryBound) return;
    ap.__umiRetryBound = true;

    function maybePlay() {
      if (!ap.audio) return;
      if (isPausedFromStorage()) return;
      if (!ap.audio.paused) return;
      attemptPlay(ap);
    }

    [0, 300, 800, 1500, 3000].forEach(function (ms) {
      window.setTimeout(maybePlay, ms);
    });

    ap.on("canplay", maybePlay);
    ap.on("loadeddata", maybePlay);
    ap.on("listswitch", maybePlay);
  }

  function installUnlockListeners(ap) {
    if (window.__umiUnlockListeners) return;
    window.__umiUnlockListeners = true;

    function onGesture() {
      if (isUnlocked()) return;
      unlockAudio(getAPlayer() || ap);
    }

    document.addEventListener("click", onGesture, { passive: true });
    document.addEventListener("keydown", onGesture, { passive: true });
    document.addEventListener("touchstart", onGesture, { passive: true });

    document.addEventListener(
      "click",
      function (e) {
        var target = e.target;
        if (!target || !target.closest) return;
        if (
          target.closest(
            'meting-js[' + CANONICAL_ATTR + '="true"] .aplayer-icon',
          )
        ) {
          if (!isUnlocked()) {
            unlockAudio(getAPlayer() || ap);
          }
        }
      },
      { passive: true },
    );
  }

  function saveState() {
    var ap = getAPlayer();
    if (!ap || !ap.list || !ap.audio) return;
    try {
      sessionStorage.setItem(
        STATE_KEY,
        JSON.stringify({
          index: ap.list.index,
          time: ap.audio.currentTime || 0,
          paused: ap.audio.paused,
          volume: typeof ap.volume === "function" ? ap.volume() : undefined,
        }),
      );
    } catch (_) {}
  }

  function restoreState(ap) {
    var raw = sessionStorage.getItem(STATE_KEY);

    function afterRestore() {
      if (!isPausedFromStorage()) {
        attemptPlay(ap);
      }
    }

    if (!raw) {
      afterRestore();
      return;
    }

    var state;
    try {
      state = JSON.parse(raw);
    } catch (_) {
      afterRestore();
      return;
    }

    function apply() {
      if (!ap.list || !ap.list.audios || !ap.list.audios.length) return;

      if (
        typeof state.index === "number" &&
        state.index >= 0 &&
        state.index < ap.list.audios.length &&
        state.index !== ap.list.index
      ) {
        ap.list.switch(state.index);
      }

      if (typeof state.time === "number" && state.time > 0) {
        if (typeof ap.seek === "function") {
          ap.seek(state.time);
        } else if (ap.audio) {
          ap.audio.currentTime = state.time;
        }
      }

      if (typeof state.volume === "number" && typeof ap.volume === "function") {
        ap.volume(state.volume, true);
      }

      if (!state.paused) {
        afterRestore();
      } else {
        setMutedHint(false);
      }
    }

    if (ap.list.audios && ap.list.audios.length) {
      apply();
    } else {
      ap.on("loadeddata", apply);
      ap.on("listswitch", apply);
    }
  }

  function bindLifecycle(ap) {
    if (ap.__umiPersistentBound) return;
    ap.__umiPersistentBound = true;

    ap.on("play", function () {
      if (isUnlocked()) setMutedHint(false);
      saveState();
    });
    ap.on("pause", saveState);
    ap.on("listswitch", saveState);
    ap.on("timeupdate", function () {
      if (saveTimer) return;
      saveTimer = window.setTimeout(function () {
        saveTimer = null;
        saveState();
      }, 2000);
    });

    window.addEventListener("pagehide", saveState);
    window.addEventListener("beforeunload", saveState);

    installUnlockListeners(ap);
    restoreState(ap);
    schedulePlayRetries(ap);

    if (isUnlocked()) {
      setMutedHint(false);
    }
  }

  function resumeAfterPjax() {
    var ap = getAPlayer();
    if (!ap) return;
    if (isPausedFromStorage()) return;
    if (!ap.audio.paused) return;
    attemptPlay(ap);
  }

  function cleanup() {
    dedupeMeting();
    var ap = getAPlayer();
    if (ap && !ap.__umiPersistentBound) {
      bindLifecycle(ap);
    }
    return ap;
  }

  function waitForAPlayer(attempt) {
    cleanup();
    var ap = getAPlayer();
    if (ap && ap.list) {
      bindLifecycle(ap);
      return;
    }
    if (attempt > 100) return;
    window.setTimeout(function () {
      waitForAPlayer(attempt + 1);
    }, 150);
  }

  function scheduleCleanup() {
    var delays = [0, 50, 150, 300, 600, 1000, 2000];
    delays.forEach(function (ms) {
      window.setTimeout(function () {
        cleanup();
        resumeAfterPjax();
      }, ms);
    });
  }

  function watchDom() {
    if (observer) return;

    observer = new MutationObserver(function () {
      if (document.querySelectorAll("meting-js").length > 1) {
        scheduleCleanup();
      }
    });

    var container = document.querySelector(".sidebar-wrapper-container");
    if (container) {
      observer.observe(container, { childList: true, subtree: true });
    }
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      watchDom();
      waitForAPlayer(0);
    });
  } else {
    watchDom();
    waitForAPlayer(0);
  }

  window.addEventListener("pjax:send", saveState);
  window.addEventListener("pjax:success", scheduleCleanup);
  window.addEventListener("pjax:complete", scheduleCleanup);
})();
