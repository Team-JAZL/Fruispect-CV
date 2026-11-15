// Create isolated state for input, camera, collections, and upload workflows.
import { makeKey } from './components.js';

// Create workspace state for the current browser session.
export function createWorkspaceState() {
  return {
    page: 'scan',
    inputMode: 'photo',
    ready: false,
    started: false,
    selected: [],
    selectionPage: 1,
    batchId: null,
    selectedId: null,
    activeBatch: null,
    batches: [],
    list: { images: [], page: 1, limit: 20, total: 0 },
    listQuery: { page: 1, limit: 20, sort: 'newest' },
    loadSequence: 0,
    collectionLoading: false,
    collectionNotice: '',
    listSequence: 0,
    userNotice: '',
    uploadStatus: '',
    completedAdmission: null,
    uploadBusy: false,
    newBatchKey: makeKey(),
    uploadGroup: null,
    retryAt: 0,
    cursors: new Map(),
    streamStatus: '',
    watchStop: undefined,
    refreshTimer: undefined,
    eventImages: new Set(),
    cache: new Map(),
    cameraStream: null,
    cameraSequence: 0,
    cameraError: '',
    cameraId: '',
    cameras: [],
    autoTimer: undefined,
    lastDeviceError: '',
    lastLiveAnnouncement: '',
    searchTimer: undefined
  };
}
