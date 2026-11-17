// Bind shared collection navigation, result review, filters, and commands.

// Route collection controls to their own state and service scope.
export function installCollectionEvents({ root, state: store, actions, form }) {
  root.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const { action, id } = button.dataset;
    if (action === 'select-batch') {
      if (!store.uploadBusy) actions.chooseBatch(id);
    } else if (action === 'open-image') actions.openReview(id, button);
    else if (action === 'close-review') actions.closeReview();
    else if (action === 'retry-review') actions.openReview(store.reviewId);
    else if (action === 'refresh-collections') {
      store.collectionNotice = '';
      actions.refreshBatches();
      actions.refreshList();
    } else if (action === 'prev' || action === 'next') {
      store.listQuery.page += action === 'prev' ? -1 : 1;
      actions.refreshList();
    } else if (['export-csv', 'export-json', 'delete-batch', 'delete-all', 'cancel-batch'].includes(action)) actions.collectionAction(action);
  });
  form.onchange = event => { if (event.target.name !== 'search') actions.filtersChanged(); };
  form.onsubmit = event => { event.preventDefault(); actions.filtersChanged(); };
  form.querySelector('[name="search"]').oninput = () => {
    clearTimeout(store.searchTimer);
    store.searchTimer = setTimeout(actions.filtersChanged, 250);
  };
}
