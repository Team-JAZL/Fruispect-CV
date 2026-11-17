// Coordinate the welcome animation, page entrances, and encouraging robot helper.
import { icon } from './ui.js';
import { animatePage } from './motion.js';

export { animatePage } from './motion.js';

const robot = new URL('./robot.png', import.meta.url).href;
const messages = [
  'One fruit, one clear photo. You’ve got this!',
  'A little light goes a long way. Try a bright spot for your next photo.',
  'Small checks, smarter choices. Let’s get to know your fruit.',
  'Keep the whole fruit in the frame and hold your camera steady.',
  'Curious about a result? Your Collections have the full model comparison.',
  'Every model has its own perspective. Compare all three in Collections.',
  'Your next discovery is one photo away!',
];

// Mount a nonblocking welcome screen and a keyboard accessible floating helper.
export function mountExperience(app) {
  const startup = document.querySelector('#welcome-screen');
  const progress = document.querySelector('#welcome-progress');
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const minimum = reduced ? 150 : 1800;
  const began = performance.now();
  let ready = false;
  let messageIndex = 0;
  let welcomeTimer;
  let messageTimer;
  let exitTimer;
  const companion = document.createElement('aside');
  companion.className = 'robot-companion';
  companion.setAttribute('aria-label', 'Fruispect helper');
  companion.innerHTML = `<div id="robot-speech" class="robot-speech" hidden><div class="robot-speech-head"><strong>A little encouragement</strong><button type="button" class="icon-button" data-robot="close" aria-label="Close tip">${icon('close', 16)}</button></div><p id="robot-message" role="status"></p><button type="button" class="text-button" data-robot="next">Another tip ${icon('arrow', 15)}</button></div>
    <button type="button" class="robot-button" data-robot="toggle" aria-label="Talk to the Fruispect helper" aria-controls="robot-speech" aria-expanded="false"><img src="${robot}" alt="" width="88" height="88"><span class="robot-greeting">Need a little boost?</span></button>`;
  document.body.append(companion);
  const speech = companion.querySelector('#robot-speech');
  const toggle = companion.querySelector('[data-robot="toggle"]');

  // Display a tip and keep the helper's expanded state synchronized.
  function showSpeech(open) {
    speech.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) companion.querySelector('#robot-message').textContent = messages[messageIndex];
  }

  // Advance welcome progress while connection work runs independently.
  function tickWelcome() {
    const elapsed = performance.now() - began;
    if (!ready && elapsed >= 5000) ready = true;
    progress.value = ready && elapsed >= minimum ? 100 : Math.min(92, 15 + elapsed / minimum * 72);
    if (!ready || elapsed < minimum) return;
    clearInterval(welcomeTimer);
    clearInterval(messageTimer);
    startup.classList.add('is-leaving');
    exitTimer = setTimeout(() => {
      startup.remove();
      app.inert = false;
      companion.inert = false;
      animatePage(app.querySelector('.shell-main'));
    }, reduced ? 0 : 260);
  }

  companion.addEventListener('click', event => {
    const action = event.target.closest('[data-robot]')?.dataset.robot;
    if (action === 'toggle') showSpeech(speech.hidden);
    else if (action === 'next') { messageIndex = (messageIndex + 1) % messages.length; showSpeech(true); }
    else if (action === 'close') { showSpeech(false); toggle.focus(); }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !speech.hidden) { showSpeech(false); toggle.focus(); }
  });
  document.addEventListener('pointerdown', event => { if (!companion.contains(event.target)) showSpeech(false); });
  document.addEventListener('click', event => {
    const summary = event.target.closest('summary');
    const details = summary?.parentElement;
    if (!details || details.open) return;
    requestAnimationFrame(() => { if (details.isConnected && details.open) animatePage(details); });
  });
  if (startup && progress) {
    startup.hidden = false;
    app.inert = true;
    companion.inert = true;
    welcomeTimer = setInterval(tickWelcome, 80);
    messageTimer = setInterval(() => {
      messageIndex = (messageIndex + 1) % messages.length;
      startup.querySelector('#welcome-message').textContent = messages[messageIndex];
    }, 1800);
  }
  window.addEventListener('pagehide', () => {
    clearInterval(welcomeTimer);
    clearInterval(messageTimer);
    clearTimeout(exitTimer);
    startup?.remove();
    app.inert = false;
    companion.inert = false;
    showSpeech(false);
  });
  return {
    // Mark connection setup complete while allowing the welcome motion to settle.
    ready() { ready = true; },
  };
}
