// Present host-only upload attribution with explicit browser reporting limits.
import { escapeHtml as e } from '../ui.js';

// Summarize the reported device alongside a browser-session identifier.
export function sourceSummary(source) {
  if (!source) return 'Upload device details were not recorded.';
  return [source.brand, source.model, source.platform, source.browser, `Device ${source.device_id}`].filter(Boolean).join(' · ');
}

// Render recorded source details without implying verified hardware identity.
export function sourceDetails(source) {
  if (!source) return '<p class="retention-note">Upload device details were not recorded for this scan.</p>';
  const rows = [
    ['Device ID', source.device_id], ['Brand', source.brand], ['Phone / model', source.model],
    ['Operating system', source.platform], ['Browser', source.browser],
    ['Connection', source.connection_type], ['Network address', source.remote_address || (source.connection_type === 'tunnel' ? 'Unavailable through phone tunnel' : null)],
    ['MAC address', 'Unavailable to web browsers'], ['User agent', source.user_agent],
  ];
  return `<section class="upload-source" aria-label="Upload device"><h3>Upload device</h3><dl>${rows.map(([label, value]) => `<div><dt>${e(label)}</dt><dd>${e(value || 'Not reported')}</dd></div>`).join('')}</dl>
    <p>Device ID identifies this browser session. Device details are browser-reported; brand is inferred when recognizable. They do not verify a person or physical device.</p></section>`;
}
