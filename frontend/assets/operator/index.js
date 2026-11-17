// Mount operator controllers and dispose their timers and event subscriptions.
import { TABS, TAB_ICONS } from './format.js';
import { icon } from '../ui.js';
import { btn } from './components.js';
import { stopEntrance } from '../motion.js';
import { createOperatorState } from './state.js';
import { installRender } from './render.js';
import { installReads } from './reads.js';
import { installRequests } from './requests.js';
import { installNavigation } from './navigation.js';
import { installCommands } from './commands.js';
import { installEvents } from './events.js';

// Mount operator.
export function mountOperator(root, { service, connection, confirmAction, notify }) {

  const store = createOperatorState(connection);
  const actions = {};
root.innerHTML = `<div class="fo-console">
    <header class="fo-header" data-reveal>
      <div><p class="fo-eyebrow">Fruispect operations</p><h1>Operator console</h1><p class="fo-description">Host status, queues & scan history.</p></div>
      <div class="fo-toolbar"><div class="fo-access" data-access></div>${btn('Refresh current view', 'refresh')}</div>
    </header>
    <nav class="fo-tabs" data-reveal aria-label="Operator console" role="tablist" data-tabs>${TABS.map(([id, label]) => `<button type="button" id="operator-tab-${id}" role="tab" data-action="tab" data-id="${id}" aria-label="${label}" title="${label}" aria-controls="operator-view">${icon(TAB_ICONS[id], 18)}<span>${label}</span></button>`).join('')}</nav>
    <div class="fo-view" id="operator-view" role="tabpanel" tabindex="0" data-view></div>
  </div>`;
  const outlet = root.querySelector('[data-view]');
  const access = root.querySelector('[data-access]');
  const tabs = Array.from(root.querySelector('[data-tabs]').children);
  // Can operate.
  const canOperate = () => store.host.data?.local_operator === true && !store.host.error;
  // Allowed request.
  const allowedRequest = () => (store.tab === 'requests');
  Object.assign(actions, { canOperate, allowedRequest });
  const context = { root, service, confirmAction, notify, state: store, actions, outlet, access, tabs, canOperate, allowedRequest };
  installRender(context);
  installReads(context);
  installRequests(context);
  installNavigation(context);
  installCommands(context);
  installEvents(context);
  root.addEventListener('click', actions.onClick);
  root.addEventListener('keydown', actions.onKeydown);
  root.addEventListener('input', actions.changeFilter);
  root.addEventListener('change', actions.changeFilter);
  root.addEventListener('submit', actions.preventForm);
  root.addEventListener('error', actions.onImageError, true);
  document.addEventListener('visibilitychange', actions.onVisibility);
  const timer = setInterval(actions.poll, 5000);
  if (!connection) actions.refreshHost().then(() => { if (!store.disposed) actions.refreshView(); });
  else actions.refreshView();
  actions.render();
  return () => {
    store.disposed = true;
    clearInterval(timer);
    clearTimeout(store.pendingSearch);
    actions.closeStream();
    stopEntrance(outlet);
    stopEntrance(root);
    for (const [href, timerId] of store.downloads) {
      clearTimeout(timerId);
      URL.revokeObjectURL(href);
    }
    root.removeEventListener('click', actions.onClick);
    root.removeEventListener('keydown', actions.onKeydown);
    root.removeEventListener('input', actions.changeFilter);
    root.removeEventListener('change', actions.changeFilter);
    root.removeEventListener('submit', actions.preventForm);
    root.removeEventListener('error', actions.onImageError, true);
    document.removeEventListener('visibilitychange', actions.onVisibility);
    root.querySelector('.fo-console')?.remove();
  };
}
