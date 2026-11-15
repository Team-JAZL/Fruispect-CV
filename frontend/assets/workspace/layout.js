// Render the scan workspace and collection page structure.
import { FRUITS } from '../api/contracts.js';
import { icon } from '../ui.js';
import { option } from './components.js';

// Render layout from the current application state.
export function renderLayout(root, {mime, retentionHours}) {
root.innerHTML = `
    <section id="scan-screen">
      <section class="hero">
        <div class="hero-copy"><span class="hero-tag">${icon('leaf', 16)} Visual fruit inspection</span>
          <h1>Check your fruit</h1><p>See the Fruit. Know its Quality.</p>
        </div>
        <div class="hero-art" aria-hidden="true"><span class="hero-frame"></span></div>
      </section>
      <div class="scan-grid">
        <section class="card input-panel" aria-labelledby="input-title">
          <header class="panel-header"><span class="tile-icon green">${icon('upload', 19)}</span>
            <div><h2 id="input-title">Add a photo</h2><p>Choose how to submit a fruit image.</p></div>
          </header>
          <div id="intake-tabs" class="intake-tabs" role="group" aria-label="Photo input modes">
            <button type="button" data-mode="photo">${icon('photo', 17)} Photo</button>
            <button type="button" data-mode="batch">${icon('layers', 17)} Batch</button>
            <button type="button" data-mode="camera">${icon('camera', 17)} Camera</button>
          </div>
          <input id="photo-input" type="file" accept="${mime}" hidden>
          <input id="batch-input" type="file" accept="${mime}" multiple hidden>
          <input id="folder-input" type="file" webkitdirectory multiple hidden>
          <input id="device-input" type="file" accept="image/*" capture="environment" hidden>
          <div id="input-body"></div>
          <div id="selected-files"></div>
          <div id="input-message"></div>
          <div class="input-foot"><p>${icon('info', 15)} One fruit per photo. Visual quality, not food safety.</p>
          <button type="button" class="button primary" id="submit-photos">${icon('scan', 17)} <span>Check fruit</span></button></div>
        </section>
        <section id="inspection-panel" class="card inspection-panel" aria-label="Current check"></section>
      </div>
      <section class="results-section" aria-labelledby="results-title">
        <div class="section-head"><div><h2 id="results-title">Model results</h2><p>Independent predictions from three models.</p></div><div id="results-count"></div></div>
        <div id="result-cards" class="model-grid"></div>
        <p class="confidence-note">${icon('info', 16)} Confidence is a model score, not a guarantee.</p>
      </section>
    </section>
    <section id="collections-screen" hidden aria-labelledby="collections-title">
      <header class="page-heading"><div><h1 id="collections-title">Collections</h1><p>Review photos and results in this browser session.</p></div><button class="button primary" type="button" data-action="new-batch">${icon('plus', 18)} New collection</button></header>
      <div class="collections-grid">
        <section class="card collection-sidebar"><div class="panel-header"><span class="tile-icon green">${icon('folder', 18)}</span><div><h2>Recent collections</h2><p>Up to 30 from this browser</p></div></div><div id="batch-list"></div><p class="retention-note">Photos are typically retained for ${retentionHours} hours. Active work may remain longer. Clearing cookies removes access to this history.</p><div id="collection-delete"></div></section>
        <section class="card collection-content"><div id="collection-heading"></div>
          <form id="collection-filter" hidden aria-label="Photo filters">
            <label class="filter-search">${icon('search', 16)}<span class="sr-only">Search filename</span><input name="search" type="search" placeholder="Search filename"></label>
            <label><span class="sr-only">Sort by</span><select name="sort"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
            <details class="filters"><summary>Filters</summary><div>
              <label>Fruit<select name="fruit"><option value="">Any fruit</option>${FRUITS.map(fruit => option(fruit, fruit)).join('')}</select></label>
              <label>Quality<select name="quality"><option value="">Any quality</option><option>Good</option><option>Bad</option></select></label>
              <label>Check status<select name="status"><option value="">Any status</option><option value="COMPLETED">Has a result</option><option value="TERMINAL">All checks ended</option><option value="QUEUED">Queued</option><option value="RUNNING">Running</option><option value="FAILED">Failed</option><option value="UNAVAILABLE">Unavailable</option><option value="CANCELLED">Cancelled</option></select></label>
              <label>Comparison<select name="agreement"><option value="">Any comparison</option><option value="agreement">Agreement</option><option value="disagreement">Disagreement</option></select></label>
            </div></details>
          </form>
          <div id="collection-notice"></div><div id="collection-list"></div>
        </section>
      </div>
    </section>
    <p class="sr-only" id="scan-announcement" aria-live="polite" aria-atomic="true"></p>`;
}
