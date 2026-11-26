// Hand-off between the Studio and the Story editor. Small on purpose: the Studio imports only
// this file, never the editor, player or exporter.
//
// The Studio opens the Story editor in a new tab and keeps a listener; the new tab asks its
// opener for the diagram with postMessage and receives it the same way. No browser storage
// is involved, so the hand-off also works between the two offline pages under file://, where
// browsers differ in whether pages in different folders share storage.

/** Sent by the Story editor to its opener when it is ready to receive. */
export const READY = 'blockflow-story-ready';
/** Sent by the Studio in reply: { type, message: { diagram, story?, html?, name? } }. */
export const HANDOFF = 'blockflow-story-handoff';

// Page locations relative to the current page. The web build serves both pages side by side;
// the offline build defines its folder layout (dist-offline/studio/, dist-offline/story/).
/* global __BLOCKFLOW_STORY_PAGE__, __BLOCKFLOW_STUDIO_PAGE__ */
export const STORY_PAGE = typeof __BLOCKFLOW_STORY_PAGE__ !== 'undefined' ? __BLOCKFLOW_STORY_PAGE__ : 'story.html';
export const STUDIO_PAGE = typeof __BLOCKFLOW_STUDIO_PAGE__ !== 'undefined' ? __BLOCKFLOW_STUDIO_PAGE__ : 'index.html';
export const pageUrl = (page, win = window) => new URL(page, win.location.href).href;

/**
 * Opens the Story editor with a Block diagram and, optionally, a story or the text of an
 * exported presentation. Returns false when the browser blocked the tab. The reply waits for
 * the tab's ready message for up to a minute.
 */
export function openInStoryEditor(message, win = window) {
  const tab = win.open(pageUrl(STORY_PAGE, win), '_blank');
  if (!tab) return false;
  const stop = () => {
    win.removeEventListener('message', onMessage);
    win.clearTimeout(timer);
  };
  const onMessage = (event) => {
    if (event.source !== tab || event.data?.type !== READY) return;
    stop();
    tab.postMessage({ type: HANDOFF, message }, '*');
  };
  const timer = win.setTimeout(stop, 60000);
  win.addEventListener('message', onMessage);
  return true;
}

/**
 * In the Story editor: asks the opener for its hand-off. Resolves with the message, or null
 * when the page has no opener, was reloaded, or the opener does not answer in time.
 */
export function receiveHandoff(win = window, timeout = 3000) {
  const opener = win.opener;
  const reload = win.performance?.getEntriesByType?.('navigation')?.[0]?.type === 'reload';
  if (!opener || reload) return Promise.resolve(null);
  return new Promise((resolve) => {
    const done = (value) => {
      win.removeEventListener('message', onMessage);
      win.clearTimeout(timer);
      resolve(value);
    };
    const onMessage = (event) => {
      if (event.source === opener && event.data?.type === HANDOFF) done(event.data.message ?? null);
    };
    const timer = win.setTimeout(() => done(null), timeout);
    win.addEventListener('message', onMessage);
    try {
      opener.postMessage({ type: READY }, '*');
    } catch {
      done(null);
    }
  });
}

// ---------- Story editor ⇄ Waveform editor ----------
// The Story editor opens the Waveform editor with a chapter's waveform (same READY/HANDOFF
// exchange as above, read with receiveHandoff). The Waveform editor sends the edited document
// back to its opener with WAVE_RETURN; the Story editor accepts it only from the tab it opened.

/** Sent by the Waveform editor to its opener: { type, ci, waveform }. */
export const WAVE_RETURN = 'blockflow-wave-return';
/* global __BLOCKFLOW_WAVE_PAGE__ */
export const WAVE_PAGE = typeof __BLOCKFLOW_WAVE_PAGE__ !== 'undefined' ? __BLOCKFLOW_WAVE_PAGE__ : 'wave.html';

/**
 * Opens the Waveform editor with `message` ({ waveform, ci, label }). `onReturn(data)` runs for
 * every WAVE_RETURN the tab sends while this page lives. Returns a stop function, or null when
 * the browser blocked the tab.
 */
export function openInWaveEditor(message, onReturn, win = window) {
  const tab = win.open(pageUrl(WAVE_PAGE, win), '_blank');
  if (!tab) return null;
  const onMessage = (event) => {
    if (event.source !== tab) return;
    if (event.data?.type === READY) tab.postMessage({ type: HANDOFF, message }, '*');
    else if (event.data?.type === WAVE_RETURN) onReturn(event.data);
  };
  win.addEventListener('message', onMessage);
  return () => win.removeEventListener('message', onMessage);
}
