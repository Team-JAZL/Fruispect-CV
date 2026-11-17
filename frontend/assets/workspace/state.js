// Create isolated state for input, camera, collections, and upload workflows.
import { makeKey } from './components.js';

// Create independent gallery state for personal or host collection access.
export function createCollectionState() {
  return {
    page: 'collections',
    ready: false,
    started: false,
    batchId: null,
    selectedId: null,
    reviewId: null,
    reviewLoading: false,
    reviewError: '',
    activeBatch: null,
    batches: [],
    list: { images: [], page: 1, limit: 20, total: 0 },
    listQuery: { page: 1, limit: 20, sort: 'newest' },
    loadSequence: 0,
    collectionLoading: false,
    collectionNotice: '',
    listSequence: 0,
    batchesSequence: 0,
    userNotice: '',
    uploadBusy: false,
    uploadGroup: null,
    cursors: new Map(),
    streamStatus: '',
    watchStop: undefined,
    refreshTimer: undefined,
    eventImages: new Set(),
    cache: new Map(),
    searchTimer: undefined,
  };
}

// Extend personal collections with scan intake, uploads, and camera state.
export function createWorkspaceState() {
  return {
    ...createCollectionState(),
    page: 'scan',
    inputMode: 'photo',
    selected: [],
    selectionPage: 1,
    uploadStatus: '',
    completedAdmission: null,
    newBatchKey: makeKey(),
    retryAt: 0,
    cameraStream: null,
    captureBusy: false,
    cameraSequence: 0,
    cameraError: '',
    cameraId: '',
    cameras: [],
    autoTimer: undefined,
    lastDeviceError: '',
    lastLiveAnnouncement: '',
  };
}
