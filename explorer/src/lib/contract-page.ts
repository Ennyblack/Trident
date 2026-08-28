import type { ExplorerEventsResponse, Network, SorobanEvent, StreamedEvent } from './types';
import { relativeTime, truncate, stellarExpertBase, tryFormatJson } from './format';

/* ------------------------------------------------------------------ *
 * Page state (derived from the URL — works on first load and after a
 * full-filter navigation)
 * ------------------------------------------------------------------ */

const params = new URLSearchParams(window.location.search);
const network: Network = params.get('network') === 'mainnet' ? 'mainnet' : 'testnet';
const pathParts = window.location.pathname.split('/');
const contractId = decodeURIComponent(pathParts[2] ?? '');
const topic0 = params.get('topic0') ?? '';
const ledgerFrom = params.get('ledgerFrom') ?? '';
const ledgerTo = params.get('ledgerTo') ?? '';
const rangeFiltered = Boolean(ledgerFrom || ledgerTo);

const expertBase = stellarExpertBase(network);

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function eventsApiUrl(): string {
  const p = new URLSearchParams({ network, contractId });
  if (topic0) p.set('topic0', topic0);
  if (ledgerFrom) p.set('ledgerFrom', ledgerFrom);
  if (ledgerTo) p.set('ledgerTo', ledgerTo);
  return `/api/events.json?${p.toString()}`;
}

function eventDetailHref(ev: { contract_id: string; id: string }): string {
  if (!ev.id) return '';
  return `/contract/${encodeURIComponent(ev.contract_id)}/event/${encodeURIComponent(ev.id)}?network=${network}`;
}

function normalizeStreamedEvent(raw: StreamedEvent): SorobanEvent {
  let topics: string[] = [];
  try {
    const parsed = JSON.parse(raw.topics);
    if (Array.isArray(parsed)) topics = parsed.map((t) => String(t));
  } catch {
    topics = [];
  }
  return {
    id: raw.event_id ?? '',
    contract_id: raw.contract_id,
    ledger_sequence: Number(raw.ledger_sequence) || 0,
    ledger_timestamp: raw.ledger_timestamp,
    transaction_hash: raw.transaction_hash ?? '',
    event_index: Number(raw.event_index) || 0,
    event_type: raw.event_type ?? 'contract',
    topics,
    data: raw.data ?? '',
    created_at: raw.ledger_timestamp,
  };
}

function eventRowHtml(e: SorobanEvent): string {
  const href = eventDetailHref(e);
  const topic0Badge = e.topics[0] ?? e.event_type ?? 'event';
  const topic1 = e.topics[1];
  return `
  <tr data-uuid="${esc(e.id)}" data-href="${esc(href)}"
      class="hover:bg-gray-900/60 cursor-pointer transition-colors">
    <td class="px-4 py-3 text-gray-400 whitespace-nowrap text-xs" title="${esc(e.ledger_timestamp)}">${esc(relativeTime(e.ledger_timestamp))}</td>
    <td class="px-4 py-3 font-mono text-gray-300 text-xs">${esc(String(e.ledger_sequence))}</td>
    <td class="px-4 py-3"><span class="px-2 py-0.5 rounded-full text-xs bg-indigo-900/50 text-indigo-300 font-medium">${esc(topic0Badge)}</span></td>
    <td class="px-4 py-3 font-mono text-gray-400 text-xs truncate max-w-[180px] hidden md:table-cell" title="${esc(topic1)}">${topic1 ? esc(truncate(topic1, 12, 8)) : '—'}</td>
    <td class="px-4 py-3 hidden lg:table-cell">
      ${e.transaction_hash
        ? `<a href="${esc(expertBase)}/tx/${esc(e.transaction_hash)}" target="_blank" rel="noopener noreferrer"
             class="font-mono text-xs text-gray-400 hover:text-indigo-300" title="${esc(e.transaction_hash)}">${esc(truncate(e.transaction_hash, 8, 6))}</a>`
        : '<span class="text-gray-600">—</span>'}
    </td>
    <td class="px-4 py-3 hidden xl:table-cell font-mono text-xs text-gray-500 max-w-[200px] truncate" title="${esc(e.data)}">${e.data ? esc(tryFormatJson(e.data).slice(0, 60)) : '—'}</td>
  </tr>`.trim();
}

function skeletonHtml(): string {
  const rows = Array.from(
    { length: 8 },
    () => `
    <div class="px-4 py-4 flex items-center gap-4">
      <div class="h-3 w-16 rounded bg-gray-800 animate-pulse"></div>
      <div class="h-3 w-12 rounded bg-gray-800 animate-pulse"></div>
      <div class="h-3 flex-1 rounded bg-gray-800 animate-pulse"></div>
      <div class="h-3 w-24 rounded bg-gray-800 animate-pulse hidden sm:block"></div>
    </div>`,
  ).join('');
  return `
    <div class="rounded-lg border border-gray-800" aria-hidden="true">
      <div class="divide-y divide-gray-800">${rows}</div>
    </div>
    <p class="sr-only" role="status">Loading events…</p>`;
}

/* ------------------------------------------------------------------ *
 * State panels (honest + actionable, no raw error strings)
 * ------------------------------------------------------------------ */

type PanelAction =
  | { label: string; action: 'retry' | 'reconnect' | 'clear-filters'; kind: 'primary' | 'ghost' }
  | { label: string; href: string; kind: 'primary' | 'ghost'; external?: boolean };

const icon = (glyph: string) => `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="1.5" class="w-9 h-9 mx-auto" aria-hidden="true">${glyph}</svg>`;

const ICONS: Record<string, string> = {
  no_events:
    '<path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />',
  not_indexed:
    '<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />',
  invalid_contract:
    '<path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />',
  api_unreachable:
    '<path stroke-linecap="round" stroke-linejoin="round" d="M3 7v6a4 4 0 014 4h10a4 4 0 014-4V7a4 4 0 00-4-4H7a4 4 0 00-4 4z" /><path stroke-linecap="round" stroke-linejoin="round" d="M12 11v4m0 0h.01" />',
  not_found:
    '<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />',
};

function panelHtml(opts: {
  icon: string;
  title: string;
  message: string;
  actions?: PanelAction[];
}): string {
  const buttons = (opts.actions ?? [])
    .map((a) => {
      const cls =
        a.kind === 'primary'
          ? 'px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors'
          : 'px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white text-sm font-medium transition-colors';
      if ('action' in a) {
        return `<button type="button" data-panel-action="${esc(a.action)}" class="${cls}">${esc(a.label)}</button>`;
      }
      const ext = a.external ? 'target="_blank" rel="noopener noreferrer"' : '';
      return `<a href="${esc(a.href)}" ${ext} class="${cls}">${esc(a.label)}</a>`;
    })
    .join('');
  return `
    <div class="rounded-xl border border-gray-800 bg-gray-900/60 px-6 py-12 text-center" role="status">
      <div class="text-indigo-300">${icon(opts.icon)}</div>
      <h3 class="text-base font-semibold text-white mt-4">${esc(opts.title)}</h3>
      <p class="text-sm text-gray-400 max-w-xl mx-auto mt-2 leading-relaxed">${esc(opts.message)}</p>
      ${buttons ? `<div class="mt-7 flex flex-wrap items-center justify-center gap-3">${buttons}</div>` : ''}
    </div>`;
}

function renderNoEvents(filtered: boolean): void {
  root().innerHTML = panelHtml(
    filtered
      ? {
          icon: ICONS.no_events,
          title: 'No events match your filters',
          message:
            'No events for this contract match the current topic or ledger filters. Clear the filters to see everything Trident has indexed for this contract.',
          actions: [
            { label: 'Clear filters', kind: 'primary', action: 'clear-filters' },
            { label: 'Back to search', kind: 'ghost', href: '/?network=' + network },
          ],
        }
      : {
          icon: ICONS.no_events,
          title: 'No events yet',
          message:
            'Trident has not recorded any events for this contract yet. If this contract was just deployed, its events will appear here as soon as it emits one — you are watching this contract live, so nothing will be missed.',
          actions: [
            { label: 'View on Stellar Expert', kind: 'ghost', href: `${expertBase}/contract/${encodeURIComponent(contractId)}`, external: true },
            { label: 'Back to search', kind: 'ghost', href: '/?network=' + network },
          ],
        },
  );
}

function renderNotIndexed(): void {
  root().innerHTML = panelHtml({
    icon: ICONS.not_indexed,
    title: 'Contract not indexed yet',
    message:
      `This contract is emitting events on the Stellar ${network} network, but Trident has not indexed any of them yet. ` +
      'Indexing may be catching up — retry in a moment, or check back shortly. In the meantime you can inspect the contract directly on Stellar Expert.',
    actions: [
      { label: 'Retry', kind: 'primary', action: 'retry' },
      { label: 'View on Stellar Expert', kind: 'ghost', href: `${expertBase}/contract/${encodeURIComponent(contractId)}`, external: true },
      { label: 'Back to search', kind: 'ghost', href: '/?network=' + network },
    ],
  });
}

function renderInvalidContract(): void {
  root().innerHTML = panelHtml({
    icon: ICONS.invalid_contract,
    title: "That doesn't look like a Stellar contract address",
    message:
      'A Soroban contract address is a 56-character string starting with the letter C (for example C…). The address you searched for does not have the right format, so it cannot be a contract. Double-check for typos, copy the full address, and search again.',
    actions: [
      { label: 'Back to search', kind: 'primary', href: '/?network=' + network },
      { label: 'Explore Stellar Expert', kind: 'ghost', href: expertBase, external: true },
    ],
  });
}

const UNREACHABLE_COPY: Record<string, { title: string; message: string }> = {
  rate_limited: {
    title: 'Slow down — rate limit reached',
    message:
      'You are browsing faster than the explorer allows. This resets on its own in a moment, no action needed.',
  },
  unauthorized: {
    title: 'Explorer is not configured',
    message:
      'The explorer data key is missing. This is a configuration problem on our side, not your connection.',
  },
  network: {
    title: 'Could not reach the indexer',
    message:
      'We could not reach the Trident indexer from the explorer. Check your connection, then retry.',
  },
  timeout: {
    title: 'The indexer is taking too long',
    message: 'The Trident indexer did not answer in time. Please retry.',
  },
  down: {
    title: 'The indexer is temporarily unavailable',
    message:
      'The Trident indexer is down right now. This is temporary — try again in a moment.',
  },
};

function renderUnreachable(reason?: string): void {
  const copy = UNREACHABLE_COPY[reason ?? 'down'] ?? UNREACHABLE_COPY.down;
  root().innerHTML = panelHtml({
    icon: ICONS.api_unreachable,
    title: copy.title,
    message: copy.message,
    actions: [
      { label: 'Retry', kind: 'primary', action: 'retry' },
      { label: 'Back to search', kind: 'ghost', href: '/?network=' + network },
    ],
  });
}

function renderNotFound(): void {
  root().innerHTML = panelHtml({
    icon: ICONS.not_found,
    title: 'Nothing found at this address',
    message:
      'We could not find any data at this address. It may have been removed or never existed.',
    actions: [{ label: 'Back to search', kind: 'primary', href: '/?network=' + network }],
  });
}

/* ------------------------------------------------------------------ *
 * Table + pagination rendering
 * ------------------------------------------------------------------ */

function tableShellHtml(): string {
  return `
    <div class="overflow-x-auto rounded-lg border border-gray-800">
      <table class="w-full text-sm">
        <thead class="bg-gray-900 text-xs text-gray-400 uppercase tracking-wide">
          <tr>
            <th class="px-4 py-3 text-left">Time</th>
            <th class="px-4 py-3 text-left">Ledger</th>
            <th class="px-4 py-3 text-left">Type</th>
            <th class="px-4 py-3 text-left hidden md:table-cell">Topic 1</th>
            <th class="px-4 py-3 text-left hidden lg:table-cell">Tx Hash</th>
            <th class="px-4 py-3 text-left hidden xl:table-cell">Data</th>
          </tr>
        </thead>
        <tbody id="events-tbody" class="divide-y divide-gray-800"></tbody>
      </table>
    </div>`;
}

function renderPagination(hasMore: boolean, nextCursor: string | null): void {
  const zone = document.getElementById('pagination-zone');
  if (!zone) return;
  if (!hasMore || !nextCursor) {
    zone.innerHTML = '';
    return;
  }
  zone.innerHTML = `
    <div class="mt-4 flex items-center justify-between">
      <span></span>
      <div class="flex items-center gap-3">
        <span id="load-more-error" class="text-xs text-red-400 hidden" role="alert"></span>
        <button type="button" id="load-more-btn"
          class="px-5 py-2 rounded bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium transition-colors">
          Load more
        </button>
      </div>
    </div>`;
  state.nextCursor = nextCursor;
}

function populateTopicFilter(events: SorobanEvent[]): void {
  const select = document.getElementById('topic0-filter') as HTMLSelectElement | null;
  if (!select) return;
  const distinct = [...new Set(events.map((e) => e.topics[0] ?? e.event_type))].sort();
  const current = select.value || topic0;
  select.innerHTML =
    '<option value="">All types</option>' +
    distinct.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  select.value = current;
}

function renderTable(events: SorobanEvent[], hasMore: boolean, nextCursor: string | null): void {
  const zone = root();
  zone.innerHTML = tableShellHtml() + '<div id="pagination-zone"></div>';
  const tbody = document.getElementById('events-tbody');
  if (tbody) {
    tbody.innerHTML = events.map(eventRowHtml).join('');
  }
  renderedUuids = new Set(events.filter((e) => e.id).map((e) => e.id));
  populateTopicFilter(events);
  renderPagination(hasMore, nextCursor);
}

/* ------------------------------------------------------------------ *
 * Fetch / render orchestration
 * ------------------------------------------------------------------ */

const SESSION_STATE = {
  status: 'loading' as string,
};

function root(): HTMLElement {
  return document.getElementById('events-root') as HTMLElement;
}

let renderedUuids = new Set<string>();
let busy = false;

async function refresh(): Promise<void> {
  if (busy) return;
  busy = true;
  root().innerHTML = skeletonHtml();
  try {
    const res = await fetch(eventsApiUrl());
    const data = (await res.json()) as ExplorerEventsResponse;
    if (
      !res.ok &&
      data.status !== 'api_unreachable' &&
      data.status !== 'invalid_contract' &&
      data.status !== 'not_found'
    ) {
      // Non-JSON or unexpected failure — treat like an unreachable API.
      renderUnreachable('down');
      SESSION_STATE.status = 'api_unreachable';
      return;
    }
    SESSION_STATE.status = data.status;
    switch (data.status) {
      case 'ok':
        renderTable(data.events ?? [], data.has_more, data.next_cursor);
        break;
      case 'no_events':
        renderNoEvents(Boolean(data.filtered));
        break;
      case 'not_indexed':
        renderNotIndexed();
        break;
      case 'invalid_contract':
        renderInvalidContract();
        break;
      case 'api_unreachable':
        renderUnreachable(data.reason);
        break;
      case 'not_found':
        renderNotFound();
        break;
      default:
        renderUnreachable('down');
    }
  } catch {
    renderUnreachable('network');
    SESSION_STATE.status = 'api_unreachable';
  } finally {
    busy = false;
  }
}

async function loadMore(): Promise<void> {
  const btn = document.getElementById('load-more-btn') as HTMLButtonElement | null;
  if (!btn || !state.nextCursor) return;
  btn.disabled = true;
  btn.textContent = 'Loading…';

  const p = new URLSearchParams({ network, contractId });
  if (topic0) p.set('topic0', topic0);
  if (ledgerFrom) p.set('ledgerFrom', ledgerFrom);
  if (ledgerTo) p.set('ledgerTo', ledgerTo);
  p.set('cursor', state.nextCursor);

  try {
    const res = await fetch(`/api/events.json?${p.toString()}`);
    const data = (await res.json()) as ExplorerEventsResponse;
    if (!res.ok) throw new Error('load-more failed');

    const tbody = document.getElementById('events-tbody');
    if (tbody && data.events?.length) {
      const fragment = data.events.map(eventRowHtml).join('');
      tbody.insertAdjacentHTML('beforeend', fragment);
      for (const ev of data.events) if (ev.id) renderedUuids.add(ev.id);
    }

    if (data.has_more && data.next_cursor) {
      state.nextCursor = data.next_cursor;
      btn.textContent = 'Load more';
      btn.disabled = false;
    } else {
      btn.remove();
    }
  } catch {
    const errElt = document.getElementById('load-more-error');
    if (errElt) {
      errElt.textContent = "Couldn't load more — check your connection and try again.";
      errElt.classList.remove('hidden');
    }
    btn.textContent = 'Load more';
    btn.disabled = false;
  }
}

const state = { nextCursor: null as string | null };

/* ------------------------------------------------------------------ *
 * Live stream (SSE) with automatic reconnect + Last-Event-ID
 * ------------------------------------------------------------------ */

const MAX_RECONNECT_ATTEMPTS = 10;

let source: EventSource | null = null;
let reconnectAttempts = 0;
let caughtUpUntil = 0;

function streamStatusMarkup(): void {
  const pill = document.getElementById('stream-status');
  if (!pill) return;
  const status = pill.dataset.status ?? '';
  let dot: string;
  let label: string;
  let hint: string;
  switch (status) {
    case 'connecting':
      dot = 'bg-amber-400 animate-pulse';
      label = 'Connecting to live feed';
      hint = 'Setting up a real-time connection to this contract.';
      break;
    case 'open':
      dot = 'bg-green-500';
      label = 'Live';
      hint = 'Streaming new events for this contract in real time.';
      break;
    case 'reconnecting':
      dot = 'bg-amber-400 animate-pulse';
      label = 'Reconnecting…';
      hint =
        reconnectAttempts > 1
          ? `Connection dropped — retrying automatically (attempt ${reconnectAttempts}). No events will be skipped.`
          : 'Connection dropped — retrying automatically. No events will be skipped.';
      break;
    case 'off':
      dot = 'bg-red-500';
      label = 'Live feed unavailable';
      hint =
        'The live feed could not be restored automatically. Reconnect anytime to resume — your place in the stream is remembered.';
      break;
    case 'paused-filter':
      dot = 'bg-gray-500';
      label = 'Live updates paused';
      hint = 'Ledger-range filters stop the live feed. Clear them to watch this contract live.';
      break;
    default:
      return;
  }
  const actions =
    status === 'off'
      ? '<button type="button" data-panel-action="reconnect" class="ml-2 px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 text-xs text-gray-300 hover:text-white transition-colors">Reconnect</button>'
      : '';
  pill.innerHTML = `
    <span class="inline-flex items-center gap-2 text-xs font-medium
      ${status === 'connecting' || status === 'reconnecting' ? 'text-amber-300' : status === 'open' ? 'text-green-300' : status === 'off' ? 'text-red-300' : 'text-gray-400'}">
      <span class="inline-block w-2 h-2 rounded-full ${dot}"></span>
      ${label}
    </span>
    ${actions}`;
  pill.setAttribute('aria-label', label + ' — ' + hint);
  pill.title = hint;
}

function setStreamStatus(status: 'connecting' | 'open' | 'reconnecting' | 'off' | 'paused-filter'): void {
  const pill = document.getElementById('stream-status');
  if (!pill) return;
  pill.dataset.status = status;
  streamStatusMarkup();
}

function showNotice(message: string, persistent = false): void {
  const zone = document.getElementById('stream-notice');
  if (!zone) return;
  zone.innerHTML = `
    <div class="rounded-lg border border-amber-800/60 bg-amber-900/20 px-4 py-3 text-sm text-amber-200 flex items-start gap-3" role="status">
      <span class="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse mt-1.5 shrink-0" aria-hidden="true"></span>
      <span>${esc(message)}</span>
    </div>`;
  if (!persistent) {
    setTimeout(() => {
      if (zone.dataset.current === message) zone.innerHTML = '';
    }, 7000);
  }
}

function clearNotice(): void {
  const zone = document.getElementById('stream-notice');
  if (zone) zone.innerHTML = '';
}

function streamUrl(): string {
  const p = new URLSearchParams({ network, contractId });
  if (topic0) p.set('topic0', topic0);
  return `/api/events/stream?${p.toString()}`;
}

function startStream(): void {
  const pill = document.getElementById('stream-status');
  if (!pill) return;

  if (rangeFiltered) {
    setStreamStatus('paused-filter');
    return;
  }

  stopStream();

  source = new EventSource(streamUrl());
  setStreamStatus('connecting');

  source.addEventListener('open', () => {
    reconnectAttempts = 0;
    const wasDropped = SESSION_STATE.status === 'stream_reconnecting';
    setStreamStatus('open');
    clearNotice();
    // If we just recovered from a drop, flag the next-seen event as the
    // "caught up" marker so the visitor knows nothing was skipped.
    caughtUpUntil = wasDropped ? Date.now() + 3000 : 0;
    SESSION_STATE.status = 'ok';
  });

  source.addEventListener('message', (ev: MessageEvent<string>) => {
    handleStreamMessage(ev);
  });

  source.addEventListener('gap', () => {
    // The upstream buffer was too old to resume exactly (Last-Event-ID fell
    // out of retention). Refresh history so nothing looks silently missing.
    showNotice(
      'The live feed could not resume from exactly where it stopped, so we refreshed recent history to make sure nothing is missing.',
    );
    void refresh();
  });

  source.onerror = () => {
    if (source?.readyState === EventSource.CLOSED) return;
    SESSION_STATE.status = 'stream_reconnecting';
    reconnectAttempts += 1;
    setStreamStatus('reconnecting');
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      stopStream();
      setStreamStatus('off');
    }
  };
}

function stopStream(): void {
  if (source) {
    source.onerror = null;
    source.close();
    source = null;
  }
}

function handleStreamMessage(ev: MessageEvent<string>): void {
  let raw: StreamedEvent;
  try {
    raw = JSON.parse(ev.data as string) as StreamedEvent;
  } catch {
    return;
  }
  const event = normalizeStreamedEvent(raw);
  if (!event.contract_id || !event.id) return;

  const justCaughtUp = Date.now() <= caughtUpUntil;

  // The table may not be shown yet (e.g. the visitor landed on an empty
  // contract). First live event → bring in the full table.
  if (SESSION_STATE.status !== 'ok' && SESSION_STATE.status !== 'stream_reconnecting') {
    void refresh();
    return;
  }

  const zone = root();
  const tbody = document.getElementById('events-tbody');
  if (zone && tbody) {
    if (renderedUuids.has(event.id)) return;
    renderedUuids.add(event.id);
    tbody.insertAdjacentHTML('afterbegin', eventRowHtml(event));
    // Trim the table to a bounded number of live rows so a long session
    // doesn't balloon the DOM.
    const rows = tbody.querySelectorAll('tr[data-uuid]');
    while (rows.length > 250) rows[rows.length - 1].remove();
  }

  if (justCaughtUp) {
    showNotice(
      `Live feed restored — showing the latest events, including anything that arrived while you were disconnected.`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * Wire-up
 * ------------------------------------------------------------------ */

function bindCopyButton(): void {
  const copyBtn = document.getElementById('copy-address') as HTMLButtonElement | null;
  if (!copyBtn) return;
  copyBtn.addEventListener('click', async () => {
    const addr = copyBtn.dataset.address ?? '';
    try {
      await navigator.clipboard.writeText(addr);
      const orig = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        copyBtn.textContent = orig;
      }, 1500);
    } catch {
      /* clipboard unavailable */
    }
  });
}

function bindRowClicks(): void {
  const zone = root();
  zone.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const button = target.closest<HTMLButtonElement>('button[data-panel-action]');
    if (button) {
      const action = button.dataset.panelAction;
      if (action === 'retry') void refresh();
      if (action === 'reconnect') startStream();
      if (action === 'clear-filters') {
        window.location.href =
          window.location.pathname + '?network=' + network;
      }
      return;
    }
    if (target.closest('a')) return;
    const row = target.closest<HTMLTableRowElement>('tr[data-href]');
    if (row?.dataset.href) {
      window.location.href = row.dataset.href;
    }
  });
}

function bindLoadMore(): void {
  const zone = root();
  zone.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('#load-more-btn') || target.id === 'load-more-btn') {
      void loadMore();
    }
  });
}

function init(): void {
  root().innerHTML = skeletonHtml();
  bindCopyButton();
  bindRowClicks();
  bindLoadMore();
  void refresh().then(() => {
    if (SESSION_STATE.status === 'ok' || SESSION_STATE.status === 'no_events' || SESSION_STATE.status === 'not_indexed') {
      startStream();
    }
  });
}

init();