// Manage camera streams, still capture, and queue-aware automatic sampling.
import { MODELS } from '../api/contracts.js';
import { option } from './components.js';
import { openDialog } from '../motion.js';

// Connect camera behavior to shared state and actions.
export function installCamera(context) {
  const { service, notify, onPairing, state: store, actions, $, intake, limits, maxPixels } = context;

  // Update camera preview, device choices, and capture controls from stream state.
  function refreshCamera() {
    const video = $('camera-video');
    if (!video) return;
    video.hidden = !store.cameraStream;
    $('camera-placeholder').hidden = Boolean(store.cameraStream);
    video.srcObject = store.cameraStream;
    if (store.cameraStream) video.play().catch(() => {});
    const cameraView = $('camera-view');
    if (store.cameraStream && !cameraView.open) openDialog(cameraView);
    else if (!store.cameraStream && cameraView.open) cameraView.close();
    intake.querySelector('[data-action="start-camera"]').hidden = Boolean(store.cameraStream);
    intake.querySelector('[data-action="stop-camera"]').hidden = !store.cameraStream;
    intake.querySelector('[data-action="capture"]').disabled = !store.cameraStream || store.captureBusy;
    $('auto-option').hidden = !store.cameraStream;
    $('camera-picker').hidden = !store.cameraStream || store.cameras.length < 2;
    $('camera-select').innerHTML = store.cameras.map((device, index) => option(device.deviceId, device.label || `Camera ${index + 1}`, store.cameraId)).join('');
    $('camera-select').onchange = event => actions.startCamera(event.target.value);
    $('auto-capture').onchange = event => {
      clearInterval(store.autoTimer);
      if (event.target.checked) store.autoTimer = setInterval(actions.autoCapture, limits.autoCaptureIntervalMs ?? 5000);
    };
  }

  // Release camera tracks and stop automatic sampling.
  function stopCamera(render = true) {
    store.cameraSequence++;
    clearInterval(store.autoTimer);
    store.cameraStream?.getTracks().forEach(track => track.stop());
    store.cameraStream = null;
    const video = $('camera-video');
    if (video) video.srcObject = null;
    if ($('camera-view')?.open) $('camera-view').close();
    if (render) {
      const auto = $('auto-capture');
      if (auto) auto.checked = false;
      actions.refreshCamera();
    }
  }

  // Open the selected camera and discard streams from obsolete requests.
  async function startCamera(device = store.cameraId) {
    actions.stopCamera();
    store.cameraError = '';
    store.lastDeviceError = '';

    if ((!navigator.mediaDevices?.getUserMedia) || !window.isSecureContext) {
      store.cameraError = 'This page cannot open the camera. Use HTTPS or localhost, or choose a file.';
      actions.renderIntakeState();
      return;
    }
    const sequence = store.cameraSequence;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
          audio: false, video: device ? { deviceId: { exact: device } } : { facingMode: { ideal: 'environment' } },
        });
      if (sequence !== store.cameraSequence || document.hidden || store.page !== 'scan') {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      store.cameraStream = stream;
      store.cameraId = stream.getVideoTracks()[0]?.getSettings().deviceId || device;
      try { store.cameras = (await navigator.mediaDevices.enumerateDevices()).filter(entry => entry.kind === 'videoinput'); }
      catch { store.cameras = []; }
      if (sequence === store.cameraSequence) actions.refreshCamera();
    } catch (error) {
      if (sequence !== store.cameraSequence) return;
      store.cameraError = error.name === 'NotAllowedError' ? 'Camera access was denied. You can still choose a file.' : 'Camera is unavailable. Try another camera or choose a file.';
    }
    actions.renderIntakeState();
  }

  // Capture a bounded still image and optionally submit it automatically.
  async function capture(auto = false) {
    const video = $('camera-video');
    if (store.uploadBusy || store.captureBusy || !store.cameraStream || !video?.videoWidth || !video?.videoHeight) return;
    const sequence = store.cameraSequence;
    store.captureBusy = true;
    intake.querySelector('[data-action="capture"]').disabled = true;
    try {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, Math.sqrt(maxPixels / (video.videoWidth * video.videoHeight)));
      canvas.width = Math.max(1, Math.floor(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.floor(video.videoHeight * scale));
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .9));
      if (!blob || sequence !== store.cameraSequence || store.page !== 'scan' || document.hidden || store.uploadBusy) return;
      if (auto && store.selected.some(item => ['selected', 'retry'].includes(item.status))) return;
      actions.addFiles([new File([blob], `fruit-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`, { type: 'image/jpeg' })]);
      if (auto) actions.submit();
      else {
        actions.stopCamera();
        $('submit-photos').focus();
      }
    } catch {
      store.cameraError = 'The photo could not be captured. Try again or choose a file.';
      actions.stopCamera();
      actions.renderIntakeState();
    } finally {
      store.captureBusy = false;
      const shutter = intake.querySelector('[data-action="capture"]');
      if (shutter) shutter.disabled = !store.cameraStream;
    }
  }

  // Capture only while the current model queues have available capacity.
  async function autoCapture() {
    if (document.hidden || store.page !== 'scan' || store.uploadBusy || !store.ready || !store.cameraStream
      || store.selected.some(item => ['selected', 'retry'].includes(item.status))) return;
    try {
      const { lanes } = await service.queues();
      const values = Array.isArray(lanes) ? lanes : Object.values(lanes ?? {});
      if (values.length !== MODELS.length || values.some(lane => lane.state !== 'READY' || lane.queue_depth > (limits.autoCaptureQueueDepth ?? 20))) return;
      await actions.capture(true);
    } catch (error) {
      if (error.status === 401) onPairing(error.message);
      else if (error.message !== store.lastDeviceError) {
        store.lastDeviceError = error.message;
        notify('Auto-capture is waiting for the host.', 'info');
      }
    }
  }

  Object.assign(actions, { refreshCamera, stopCamera, startCamera, capture, autoCapture });
}
