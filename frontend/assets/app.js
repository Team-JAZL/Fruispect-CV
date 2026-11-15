import { createLiveService } from './api/live.js';
import { readConfig } from './api/config.js';
import { createPreviewService, SCENARIOS } from './preview.js';
import { mountOperator } from './operator.js';
import { createWorkspace } from './workspace.js';
import { escapeHtml as e, icon } from './ui.js';

const config = readConfig();
const mode = config.mode;
const demo = mode === 'design-preview';
const params = new URLSearchParams(location.search);
const scenario = SCENARIOS.some(entry => entry.id === params.get('scenario'))
  ? params.get('scenario') : 'partial';
const service = demo ? createPreviewService(scenario) : createLiveService();
const pairingCode = new URLSearchParams(location.hash.slice(1)).get('connect');
if (pairingCode !== null) history.replaceState(null, '', location.pathname + location.search);
const app = document.querySelector('#app');
const mark = new URL('./mark.svg', import.meta.url).href;
const pages = {
  scan: { label: 'Scan workspace', icon: 'scan' },
  collections: { label: 'Collections', icon: 'folder' },
  operator: { label: 'Operator console', icon: 'tune' },
};
const initialPage = params.get('view');
const selectedScenario = SCENARIOS.find(item => item.id === scenario);
let page = Object.hasOwn(pages, initialPage) ? initialPage
  : demo && scenario !== 'pairing' && selectedScenario?.group === 'Operator' ? 'operator' : 'scan';
let connection = null;
let readyForReads = false;
let needsPairing = false;
let disposeOperator = null;
let workspace = null;
let notifyTimeout;
let connectionSequence = 0;

function scenarios() {
  const groups = [...new Set(SCENARIOS.map(item => item.group ?? 'Preview scenarios'))];
  return groups.map(group => `<optgroup label="${e(group)}">${SCENARIOS
    .filter(item => (item.group ?? 'Preview scenarios') === group)
    .map(item => `<option value="${e(item.id)}"${item.id === scenario ? ' selected' : ''}>${e(item.label)}</option>`)
    .join('')}</optgroup>`).join('');
}

function nav(name) {
  return `<button type="button" class="nav-item" data-page="${name}">${icon(pages[name].icon)}<span>${pages[name].label}</span>${name === 'operator' ? icon('outside', 13) : ''}</button>`;
}

app.innerHTML = `<div class="shell">
  <aside class="sidebar" id="navigation">
    <button class="brand" type="button" data-page="scan" aria-label="Fruispect home">
      <img src="${mark}" alt="" width="42" height="42">
      <span><strong>fruispect<span class="brand-dot">.</span></strong><small>FRUIT QUALITY CHECKER</small></span>
    </button>
    <nav aria-label="Main navigation">
      <div class="nav-group"><p>WORKSPACE</p>${nav('scan')}${nav('collections')}</div>
      <div class="nav-group"><p>OPERATIONS</p>${nav('operator')}</div>
    </nav>
    <div class="sidebar-foot">
      <div class="session-card"><span class="session-icon">${icon(demo ? 'eye' : 'activity', 17)}</span>
        <span><strong>${demo ? 'Preview session' : 'Host session'}</strong><small id="session-caption">${demo ? 'Sample data' : 'Connecting to Fruispect'}</small></span>
      </div>
      <p>Fruispect<span aria-hidden="true"> · </span>Research workspace</p>
    </div>
  </aside>
  <div class="shell-main">
    <header class="topbar">
      <div class="breadcrumb"><button class="icon-button mobile-menu" type="button" aria-label="Toggle navigation" aria-expanded="false" aria-controls="navigation">${icon('menu')}</button>
        <span class="crumb-home">Workspace</span><span class="crumb-home">${icon('chevron', 14)}</span><strong id="crumb-current"></strong>
      </div>
      <div class="top-actions">${demo ? `<span class="preview-label"><i></i> Design preview</span>
        <label class="scenario-label"><span class="sr-only">Preview scenario</span><select id="scenario">${scenarios()}</select></label>`
        : `<span id="connection-chip" class="badge neutral"><i></i> Connecting</span>`}</div>
    </header>
    <main id="main" tabindex="-1" class="main-content">
      <div id="connection-panel"></div>
      <div id="user-workspace"></div>
      <div id="operator-workspace" hidden></div>
    </main>
    <footer class="page-footer"><span>Fruispect</span><span>Fruit recognition and visual quality</span></footer>
  </div>
</div>
<div id="toast" role="status" aria-live="polite" hidden></div>
<dialog id="confirm-dialog" aria-labelledby="confirm-title" aria-describedby="confirm-body">
  <form method="dialog">
    <h2 id="confirm-title"></h2><p id="confirm-body"></p>
    <label id="confirm-input-label" hidden><span></span><input id="confirm-input" autocomplete="off"></label>
    <div class="dialog-actions"><button class="button" value="cancel" autofocus>Go back</button>
    <button class="button danger" id="confirm-apply" value="apply"></button></div>
  </form>
</dialog>`;

const connectionPanel = document.querySelector('#connection-panel');
const operatorRoot = document.querySelector('#operator-workspace');
const userRoot = document.querySelector('#user-workspace');
const menuButton = document.querySelector('.mobile-menu');
const sidebar = document.querySelector('.sidebar');
const dialog = document.querySelector('#confirm-dialog');
const confirmInput = document.querySelector('#confirm-input');
const confirmLabel = document.querySelector('#confirm-input-label');
const applyButton = document.querySelector('#confirm-apply');

function notify(message, tone = 'info') {
  const toast = document.querySelector('#toast');
  clearTimeout(notifyTimeout);
  toast.className = `toast ${tone === 'error' ? 'toast-error' : ''}`;
  toast.textContent = message;
  toast.hidden = false;
  notifyTimeout = setTimeout(() => { toast.hidden = true; }, 6500);
}

function confirmAction({ title, body, label = 'Confirm', requireText = '' }) {
  if (dialog.open) return Promise.resolve(false);
  document.querySelector('#confirm-title').textContent = title;
  document.querySelector('#confirm-body').textContent = body;
  confirmLabel.hidden = !requireText;
  confirmLabel.querySelector('span').textContent = requireText ? `Type ${requireText} to confirm` : '';
  confirmInput.value = '';
  applyButton.textContent = label;
  applyButton.disabled = Boolean(requireText);
  confirmInput.oninput = () => { applyButton.disabled = confirmInput.value !== requireText; };
  dialog.returnValue = 'cancel';
  dialog.showModal();
  return new Promise(resolve => dialog.addEventListener('close', () => {
    resolve(dialog.returnValue === 'apply' && (!requireText || confirmInput.value === requireText));
  }, { once: true }));
}

function setConnectionIndicator(label, tone) {
  const chip = document.querySelector('#connection-chip');
  if (chip) {
    chip.className = `badge ${tone}`;
    chip.innerHTML = `<i></i> ${e(label)}`;
  }
  if (!demo) document.querySelector('#session-caption').textContent = label;
}

function showError(message) {
  connectionPanel.innerHTML = `<div class="callout warn" role="status">${icon('alert')}<div><strong>Fruispect connection</strong><p>${e(message)}</p></div><button type="button" class="button small" id="retry-app">Try again</button></div>`;
  connectionPanel.querySelector('#retry-app').onclick = () => { initialize(); };
}

function showPairing(message = '') {
  needsPairing = true;
  readyForReads = false;
  workspace?.setReady(false);
  setConnectionIndicator('Pairing required', 'warn');
  connectionPanel.innerHTML = `<div class="callout warn pairing">${icon('phone')}<div><strong>Pair this phone</strong>
    <p>Enter the pairing code displayed on the host computer.</p>
    <form id="pair-form"><label><span class="sr-only">Pairing code</span><input id="pair-code" autocomplete="one-time-code" required></label>
    <button class="button primary small" type="submit">Pair device</button></form>
    <p id="pair-error" role="status">${e(message)}</p></div></div>`;
  connectionPanel.querySelector('#pair-form').onsubmit = async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      await service.connect(connectionPanel.querySelector('#pair-code').value.trim());
      await initialize(null, true);
    } catch (error) {
      const errorNode = connectionPanel.querySelector('#pair-error');
      if (errorNode) errorNode.textContent = error.message;
    } finally { button.disabled = false; }
  };
}

function showPage(next, { focus = true, write = true } = {}) {
  if (!Object.hasOwn(pages, next)) next = 'scan';
  if (next !== page && page === 'operator') {
    disposeOperator?.();
    disposeOperator = null;
  }
  page = next;
  if (write) {
    const url = new URL(location.href);
    if (next === 'scan') url.searchParams.delete('view');
    else url.searchParams.set('view', next);
    if (url.href !== location.href) history.pushState(null, '', url);
  }
  document.querySelector('#crumb-current').textContent = pages[next].label;
  for (const item of document.querySelectorAll('nav [data-page]')) {
    if (item.dataset.page === next) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
  userRoot.hidden = next === 'operator';
  operatorRoot.hidden = next !== 'operator';
  workspace?.setPage(next);
  if (next === 'operator' && !disposeOperator) {
    if (readyForReads || connection && !needsPairing) {
      disposeOperator = mountOperator(operatorRoot, {
        service, connection, mode, confirmAction, notify, scenario,
      }) ?? (() => {});
    } else {
      operatorRoot.innerHTML = `<div class="empty"><h1>Operator console</h1><p>${needsPairing ? 'Pair this browser to continue.' : 'Waiting for the host connection.'}</p></div>`;
    }
  }
  sidebar.classList.remove('mobile-open');
  menuButton.setAttribute('aria-expanded', 'false');
  if (focus) document.querySelector('#main').focus({ preventScroll: true });
}

async function initialize(code = null, pairedNow = false) {
  const requestId = ++connectionSequence;
  try {
    connection = await service.connection();
    if (requestId !== connectionSequence) return;
    if (code) {
      try { await service.connect(code); }
      catch (error) { showPairing(error.message); showPage(page, { focus: false, write: false }); return; }
      return initialize(null, true);
    }
    if (!pairedNow && (connection.requires_pairing && connection.paired !== true)) {
      showPairing();
    } else {
      needsPairing = false;
      readyForReads = true;
      connectionPanel.replaceChildren();
      setConnectionIndicator('Host connected', 'good');
      workspace.setReady(true);
    }
  } catch (error) {
    if (requestId !== connectionSequence) return;
    if (error.status === 401) showPairing();
    else {
      setConnectionIndicator('Host unavailable', 'warn');
      showError(error.message || 'The host could not be reached.');
    }
  }
  showPage(page, { focus: false, write: false });
}

workspace = createWorkspace(userRoot, {
  service, config, mode, scenario, scenarioLabel: selectedScenario?.label, confirmAction, notify,
  onNavigate: showPage, onPairing: showPairing,
});

document.querySelector('#scenario')?.addEventListener('change', event => {
  const url = new URL(location.href);
  const option = SCENARIOS.find(item => item.id === event.target.value);
  url.searchParams.set('scenario', event.target.value);
  const group = String(option?.group ?? '');
  const admin = /operator|admin|research|connection/i.test(group)
    || /operator|admin|research|reset|tunnel|queues|request|offline/i.test(event.target.value);
  if (admin && option?.id !== 'pairing') url.searchParams.set('view', 'operator');
  else url.searchParams.delete('view');
  location.assign(url);
});

app.addEventListener('click', event => {
  const target = event.target.closest('[data-page]');
  if (target) showPage(target.dataset.page);
});
menuButton.addEventListener('click', () => {
  const open = sidebar.classList.toggle('mobile-open');
  menuButton.setAttribute('aria-expanded', String(open));
});
window.addEventListener('popstate', () => {
  showPage(new URLSearchParams(location.search).get('view') ?? 'scan', { write: false });
});
window.addEventListener('pagehide', () => {
  disposeOperator?.();
  disposeOperator = null;
});
window.addEventListener('pageshow', event => {
  if (event.persisted) showPage(page, { focus: false, write: false });
});
showPage(page, { focus: false, write: false });
initialize(pairingCode);
