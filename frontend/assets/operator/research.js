// Render saved research metrics and links to validated research figures.
import { MODELS } from '../api/contracts.js';
import { nf, html, record, present, number, display, duration, score, words, modelName, localURL } from './format.js';
import { btn, empty, notice, stateNotice, sectionHead, fields, metric } from './components.js';

// Convert saved research column names into readable labels.
export function researchLabel(key) {
  if (key === 'model_key') return 'Model';
  const label = words(String(key).replace(/([a-z])([A-Z])/g, '$1 $2'));
  return label.replace(/\bf1\b/gi, 'F1').replace(/\bcpu\b/gi, 'CPU').replace(/\bgpu\b/gi, 'GPU');
}

// Format a recorded metric according to its units and missing-data state.
export function researchValue(key, value) {
  if (key === 'model_key' && present(value)) return modelName(value);
  const numeric = number(value);
  if (numeric === null) {
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return display(value);
  }
  if (/(percent|pct)(_|$)/i.test(key)) return nf.format(numeric) + '%';
  if (/accuracy|acc$|precision|recall|f1/i.test(key) && numeric >= 0 && numeric <= 1) return score(numeric);
  if (/(^|_)ms$/i.test(key)) return duration(numeric);
  if (/(^|_)mb$/i.test(key)) return nf.format(numeric) + ' MB';
  return nf.format(numeric);
}

// Render saved tabular or nested research records without manufacturing values.
export function researchData(value) {
  if (Array.isArray(value)) {
    if (!value.length) return '<p class="fo-muted">No saved data available.</p>';
    if (value.every((row) => record(row) && Object.values(row).every((item) => !record(item) && !Array.isArray(item)))) {
      const columns = [...new Set(value.flatMap((row) => Object.keys(row)))];
      if (!columns.length) return '<p class="fo-muted">No saved data available.</p>';
      return `<div class="fo-table-wrap" role="region" aria-label="Saved research data" tabindex="0"><table class="fo-table"><thead><tr>${columns.map((key) => `<th scope="col">${html(researchLabel(key))}</th>`).join('')}</tr></thead><tbody>${value.map((row) => `<tr>${columns.map((key) => `<td>${html(researchValue(key, row[key]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    }
    return `<ul class="fo-research-values">${value.map((row) => `<li>${researchData(row)}</li>`).join('')}</ul>`;
  }
  if (!record(value)) return `<p>${html(display(value))}</p>`;
  const entries = Object.entries(value);
  if (!entries.length) return '<p class="fo-muted">No saved data available.</p>';
  const leaf = entries.filter(([, item]) => !record(item) && !Array.isArray(item));
  const nested = entries.filter(([, item]) => record(item) || Array.isArray(item));
  return `${leaf.length ? fields(leaf.map(([key, item]) => [researchLabel(key), researchValue(key, item)])) : ''}${nested.map(([key, item]) => `<div class="fo-research-group"><h4>${html(modelName(key) === key ? researchLabel(key) : modelName(key))}</h4>${researchData(item)}</div>`).join('')}`;
}

// Match the saved CSV model display name to its application model key.
export function researchRow(models, key) {
  const name = modelName(key);
  return models?.find(model => model.model === name);
}

// Render recorded fruit, quality, and joint accuracy without inventing missing values.
export function researchModel(model, data) {
  if (!data) return `<article class="fo-card fo-research-model"><h3>${html(model.name)}</h3>${empty('No saved evaluation for this model')}</article>`;
  const values = [
    ['Fruit accuracy', data.fruit_accuracy],
    ['Quality accuracy', data.quality_accuracy],
    ['Joint accuracy', data.joint_accuracy],
  ];
  return `<article class="fo-card fo-research-model"><h3>${html(model.name)}</h3>
    <div class="fo-research-metrics">${values.map(([label, value]) => metric(label, researchValue('accuracy', value))).join('')}</div>
    <details class="fo-disclosure" data-disclosure="research-${html(model.key)}"><summary>Saved metrics and model metadata</summary>${researchData(data)}</details>
  </article>`;
}

// Describe missing saved artifacts without substituting sample measurements.
export function unavailableResearch(value) {
  if (!value || (Array.isArray(value) && !value.length) || (record(value) && !Object.keys(value).length)) return '';
  if (value === true) return notice('Some saved research data is unavailable.', 'warn');
  return `<div class="fo-research-unavailable">${notice('Some saved research data is unavailable.', 'warn')}${researchData(value)}</div>`;
}

// Render links to existing research figures from the current catalog.
export function researchFigures(resource) {
  const data = resource.data;
  const figures = data?.figures ?? [];
  return `<section class="fo-section">
    ${sectionHead('Saved Research Artifact', 'Open available PNG or PDF files from the host.')}
    ${stateNotice(resource, 'research figures')}${unavailableResearch(data?.unavailable)}
    ${figures.length ? `<div class="fo-model-grid">${figures.map((figure) => {
          const png = localURL(figure.png);
          const pdf = localURL(figure.pdf);
          const title = figure.title ?? 'Research figure';
      return `<article class="fo-card fo-figure">${png ? `<a class="fo-figure-image" href="${html(png)}" ${png.startsWith('data:') ? 'download="fruispect-figure.png"' : 'target="_blank" rel="noopener noreferrer"'}><img src="${html(png)}" alt="${html(title)}" loading="lazy" decoding="async"></a>` : '<div class="fo-figure-image fo-muted">PNG preview unavailable</div>'}
        <div class="fo-figure-copy"><h3>${html(title)}</h3>${figure.note ? `<p>${html(figure.note)}</p>` : ''}
        ${typeof figure.provenance === 'string' ? `<p class="fo-caption">${html(figure.provenance)}</p>` : ''}
        <div class="fo-actions">${[[png, 'PNG'], [pdf, 'PDF']].map(([url, type]) => url ? `<a class="fo-btn" href="${html(url)}" ${url.startsWith('data:') ? 'download="fruispect-figure.png"' : 'target="_blank" rel="noopener noreferrer"'}>${url.startsWith('data:') ? 'Download' : 'Open'} ${type}</a>` : `<span class="fo-caption">${type} unavailable</span>`).join('')}</div></div></article>`;
    }).join('')}</div>` : !resource.error ? empty(resource.loading ? 'Loading saved figures…' : 'No research figures available') : ''}
  </section>`;
}

// Render recorded evaluation metrics, experiment provenance, and figure links.
export function researchView(summary, figures) {
  const data = summary.data;
  return `<div class="fo-stack">
    ${sectionHead('Research', 'Saved evaluation results and experiment artifacts.', btn('Refresh research', 'refresh'))}
    ${stateNotice(summary, 'research summary')}
    ${summary.loading && !data ? empty('Loading saved research…') : ''}
    ${data ? `<section class="fo-section">${sectionHead('Held-out Test', 'Metrics from the saved test set. Uploaded photos are unlabeled.')}
      <div class="fo-model-grid">${MODELS.map((model) => researchModel(model, researchRow(data.models, model.key))).join('')}</div>
      ${unavailableResearch(data.unavailable)}
    </section>
    <div class="fo-research-pair">
      <section class="fo-card fo-research-section">${sectionHead('Quality by fruit', 'Saved per-fruit visual-quality evaluation.')}${researchData(data.quality_by_fruit)}</section>
      <section class="fo-card fo-research-section">${sectionHead('Controlled Stress Test', 'Saved results under controlled photographic conditions.')}${researchData(data.stress)}</section>
    </div>
    <section class="fo-card fo-research-section">${sectionHead('Saved benchmarks and provenance', 'Saved benchmark timing describes the evaluation run.')}
      ${researchData({ 'Metrics source': data.metrics_source, Provenance: data.provenance, Manifest: data.manifest, 'Training versions': data.training_versions, ...(data.benchmark ? { Benchmark: data.benchmark } : {}) })}
    </section>` : !summary.error && !summary.loading ? empty('No saved evaluation available') : ''}
    ${researchFigures(figures)}
  </div>`;
}
