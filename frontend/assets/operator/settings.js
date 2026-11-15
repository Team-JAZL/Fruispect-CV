// Render storage controls, phone diagnostics, and local reset actions.
import { html, present, number, count, upper, connectionURL } from './format.js';
import { badge, btn, notice, stateNotice, sectionHead, metric } from './components.js';

// Settings view.
export function settingsView({ settings, host, local, busy, cleanupMessage }) {
  const stats = settings.data;
  const value = host.data;
  const status = upper(value?.status);
  const ready = status === 'READY';
  const publicLink = connectionURL(value?.public_url);
  const connectLink = ready && local ? connectionURL(value?.connect_url) : '';
  const pairing = ready && local ? value?.pair_code : null;
  const copy = connectLink || publicLink;
  const canDelete = number(stats?.collections) > 0;
  const busyLabel = {
    retry: 'Requesting retry…', reset: 'Resetting…', 'delete-collections': 'Deleting…',
  }[busy];
  return `<div class="fo-stack">
    ${sectionHead('Settings', 'Manage phone access and retained scan data.', btn('Refresh settings', 'refresh'))}
    ${cleanupMessage ? notice(cleanupMessage, 'good') : ''}
    ${stateNotice(host, 'connection status')}${stateNotice(settings, 'data totals')}
    <section class="fo-card fo-settings-card">
      ${sectionHead('Phone connection', value?.message ?? 'Phone access uses the host’s optional HTTPS link.', badge(status))}
      ${host.loading && !value ? '<p class="fo-muted">Checking connection status…</p>' : ''}
      ${value?.error_code ? notice('Connection code: ' + value.error_code, 'warn') : ''}
      ${publicLink ? `<div class="fo-connection-value"><span class="fo-caption">Public URL</span><a href="${html(publicLink)}" target="_blank" rel="noopener noreferrer">${html(publicLink)}</a></div>` : ''}
      ${present(pairing) ? `<div class="fo-connection-value"><span class="fo-caption">Pairing code</span><code>${html(pairing)}</code></div>` : ''}
      ${connectLink ? `<div class="fo-connection-value"><span class="fo-caption">Automatic pairing link</span><input type="text" readonly aria-label="Automatic pairing link" data-pair-link value="${html(connectLink)}"></div>` : ''}
      <div class="fo-actions">
        ${copy ? btn(connectLink ? 'Copy pairing link' : 'Copy public link', 'copy', { variant: 'primary' }) : ''}
        ${local ? btn(busy === 'retry' ? busyLabel : 'Retry phone connection', 'retry', { disabled: Boolean(busy) || status === 'STARTING' }) : ''}
      </div>
      <p class="fo-card-note">${html(!ready ? 'You can still scan on the host when the phone link is unavailable.' : value?.requires_pairing === true ? 'Phones must pair before accessing protected scans.' : 'The host supplies the current connection status and link.')}</p>
      ${!local ? '<p class="fo-card-note">Pairing credentials and connection retry require direct localhost access.</p>' : ''}
    </section>
    <div class="fo-settings-grid">
      <section class="fo-card fo-settings-card">
        ${sectionHead('This browser', 'Delete collections owned by the current browser session.')}
        <div class="fo-settings-metrics">${metric('Collections', count(stats?.collections))}${metric('Photos', count(stats?.photos))}</div>
        ${btn(busy === 'delete-collections' ? busyLabel : 'Delete browser collections', 'delete-collections', { variant: 'danger', disabled: Boolean(busy) || !canDelete })}
      </section>
      <section class="fo-card fo-settings-card fo-settings-danger">
        ${sectionHead('Global scan reset', 'Clear scan data from every browser. Research, models, and connection configuration are preserved.', badge('', ('Localhost only')))}
        ${local ? `<div class="fo-settings-metrics">${metric('All collections', count(stats?.all_collections))}${metric('All photos', count(stats?.all_photos))}</div>
        ${btn(busy === 'reset' ? busyLabel : 'Reset all scan data', 'reset', { variant: 'danger', disabled: Boolean(busy) })}` : '<p class="fo-card-note">Open Fruispect directly on the host to use this control.</p>'}
      </section>
    </div>
  </div>`;
}
