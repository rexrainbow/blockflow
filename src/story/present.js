// Exported presentation page: header, chapter tabs, caption and step list around the shared
// player. The exporter inlines this file after player.js, so it may use only createPlayer.
import { createPlayer } from './player.js';

export function bootPresentation(data, app) {
  const html = (tag, attrs = {}, text) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    return n;
  };
  const header = html('header', { class: 'pp-head' });
  const title = html('h1', {}, data.title || 'Presentation');
  const tabs = html('nav', { class: 'pp-chapters', 'aria-label': 'Chapters' });
  const legend = html('div', { class: 'pp-legend', 'aria-label': 'Line kinds' });
  header.append(title, tabs, legend);
  const stageHost = html('div', { class: 'pp-player' });
  const aside = html('aside', { class: 'pp-side' });
  const caption = html('div', { class: 'pp-caption', 'aria-live': 'polite' });
  const where = html('div', { class: 'pp-where' });
  const heading = html('h2');
  const body = html('p');
  const kinds = html('div', { class: 'pp-kinds' });
  caption.append(where, heading, body, kinds);
  const list = html('nav', { class: 'pp-steps', 'aria-label': 'Steps' });
  aside.append(caption, list);
  const main = html('main', { class: 'pp-main' });
  main.append(stageHost, aside);
  app.replaceChildren(header, main);
  document.title = data.title || 'Presentation';

  const tabButtons = [];
  const stepButtons = [];
  const first = [];
  let flat = 0;
  data.chapters.forEach((ch, ci) => {
    first[ci] = flat;
    const tab = html('button', { type: 'button' }, ch.title || `Chapter ${ci + 1}`);
    const at = flat;
    tab.addEventListener('click', () => player.show(at));
    tabs.append(tab);
    tabButtons.push(tab);
    list.append(html('h3', {}, ch.title || `Chapter ${ci + 1}`));
    (ch.steps ?? []).forEach((s, si) => {
      const i = flat++;
      const b = html('button', { type: 'button' });
      b.append(html('span', { class: 'pp-n' }, String(si + 1)), html('span', {}, s.title || `Step ${si + 1}`));
      b.addEventListener('click', () => player.show(i));
      list.append(b);
      stepButtons.push(b);
    });
  });

  // Data is set after createPlayer returns: the first step callback needs `player`.
  const player = createPlayer(stageHost, {
    onStep(i) {
      const s = player.steps[i];
      const ch = data.chapters[s.ci];
      where.textContent = `${ch.title || `Chapter ${s.ci + 1}`} · Step ${s.si + 1} / ${ch.steps.length}`;
      heading.textContent = s.title || `Step ${s.si + 1}`;
      body.textContent = s.body ?? '';
      const used = [...new Set(s.scope ? player.steps.filter((p) => p.ci === s.ci).flatMap((p) => p.hops.map((h) => h.kind)) : s.hops.map((h) => h.kind))];
      kinds.replaceChildren(...used.map((k) => html('span', { class: `pp-kind pp-${k}` }, player.kindLabel(k))));
      stepButtons.forEach((b, j) => {
        b.setAttribute('aria-current', String(j === i));
        b.classList.toggle('pp-done', j < i);
      });
      tabButtons.forEach((b, ci) => b.setAttribute('aria-current', String(ci === s.ci)));
      stepButtons[i]?.scrollIntoView({ block: 'nearest' });
      try {
        history.replaceState(null, '', '#step-' + (i + 1));
      } catch {
        /* file:// pages in some browsers refuse history updates */
      }
    },
  });
  for (const k of ['event', 'level', 'data', 'control']) {
    const item = html('span', { class: `pp-legend-item pp-${k}` });
    item.append(html('i'), document.createTextNode(player.kindLabel(k)));
    legend.append(item);
  }
  const start = Number((/^#step-(\d+)$/.exec(location.hash) ?? [])[1]) - 1;
  player.setData(data, { index: start > 0 ? start : 0, instant: true });

  addEventListener('keydown', (e) => {
    if (e.target.closest?.('select, input, textarea')) return;
    if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.();
      return e.preventDefault();
    }
    if (player.key(e)) e.preventDefault();
  });
  return player;
}
