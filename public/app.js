import * as THREE from './vendor/three.module.min.js';
import { base, scenarios } from './scenarios.js';
import { buildModel } from './models.js';
import { codeExamples } from './code-examples.js';
import { channelDefaults } from './resilience.js';

const $ = id => document.getElementById(id);
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const compact = matchMedia('(max-width: 1140px)');
const stage = $('scene');
const actors = [
  ['client', '用户 / 前端', 'blue'],
  ['api', 'Payment API', 'blue'],
  ['router', 'Router', 'blue'],
  ['resilience', 'Resilience', 'amber'],
  ['adapter', 'Adapter', 'blue'],
  ['psp', 'PSP', 'blue'],
  ['webhook', 'Webhook', 'green'],
  ['queue', 'Queue / Worker', 'green'],
  ['billing', 'Billing / 权益', 'green'],
  ['store', 'Database', 'amber'],
  ['reconcile', 'Reconciliation', 'amber'],
];
const actorNames = Object.fromEntries(actors.map(([id, name]) => [id, name]));
const providers = { stripe: 'Stripe', paypal: 'PayPal', other: 'Other PSP' };
const actorKey = id => Object.hasOwn(providers, id) ? 'psp' : id;
const actorName = id => providers[id] ?? actorNames[id];
const providerFor = event => providers[event.to] ?? providers[event.from];
const colors = { blue: 0x8aa7f8, green: 0x68dbbb, amber: 0xf5bb77 };
const iconPaths = {
  client: 'M8 21h8a4 4 0 0 0 4-4v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1a4 4 0 0 0 4 4Z M15 6a3 3 0 1 0-6 0 3 3 0 1 0 6 0Z',
  api: 'M3 4h18v13H3z M9 21h6 M12 17v4 M9 8l-2 2.5 2 2.5 M12 13h4',
  router: 'M7 12h5m0 0 5-6m-5 6 5 6 M7 12a2 2 0 1 0-4 0 2 2 0 1 0 4 0 M21 5a2 2 0 1 0-4 0 2 2 0 1 0 4 0 M21 19a2 2 0 1 0-4 0 2 2 0 1 0 4 0',
  resilience: 'M12 2 20 6v5c0 5-3 8-8 11-5-3-8-6-8-11V6z M12 7l-3 6h3l-1 5 4-7h-3z',
  adapter: 'M10 8l2-2a4 4 0 0 1 6 6l-2 2 M8 10l-2 2a4 4 0 0 0 6 6l2-2 M9 15l6-6',
  psp: 'M3 5h18v14H3z M3 10h18 M6 15h4',
  webhook: 'M4 10a3 3 0 1 1 6 0v5a3 3 0 0 0 6 0v-2 M20 9a2 2 0 1 0-4 0 2 2 0 1 0 4 0',
  queue: 'M8 4h8v7H8z M3 13h8v7H3z M13 13h8v7h-8z',
  billing: 'M21 12a9 9 0 1 0-18 0 9 9 0 1 0 18 0 M8 12l3 3 5-6',
  store: 'M4 6a8 3 0 1 0 16 0 8 3 0 1 0-16 0 M4 6v12a8 3 0 0 0 16 0V6 M4 12a8 3 0 0 0 16 0',
  reconcile: 'M16 10a6 6 0 1 0-12 0 6 6 0 1 0 12 0 M14 14l6 6 M7 10h6',
};

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
} catch {
  stage.classList.add('no-webgl');
}
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera();
const models = new Map();
if (renderer) {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  stage.append(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xe7f2ff, 0x657baf, 2.1));
  const key = new THREE.DirectionalLight(0xffffff, 3);
  key.position.set(-4, 7, 8);
  scene.add(key);
  const edge = new THREE.DirectionalLight(0x89a6ff, 1.6);
  edge.position.set(4, 1, -4);
  scene.add(edge);
  for (const [id, , tone] of actors) {
    const entry = buildModel(id, colors[tone]);
    models.set(id, entry);
    scene.add(entry.model);
  }
}
const fallback = document.createElement('div');
fallback.className = 'flat-icons';
fallback.setAttribute('aria-hidden', 'true');
if (!renderer) stage.append(fallback);

const fields = [
  ['checkout', 'Checkout'], ['payment', 'Payment'], ['invoice', 'Invoice'],
  ['subscription', 'Subscription'], ['entitlement', 'Entitlement'],
];
const counters = [
  ['intents', '订阅意图'], ['sessions', 'PSP 对象'], ['inbox', 'Inbox'],
  ['pending', 'Outbox 待发'], ['credits', 'Credits 入账'],
];
const fieldViews = new Map();
const counterViews = new Map();
function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}
for (const [id, name] of fields) {
  const card = element('div', 'state-card');
  const nodes = element('div', 'state-nodes');
  card.append(element('h4', '', name), nodes);
  $('status').append(card);
  fieldViews.set(id, { card, nodes });
}
for (const [id, name] of counters) {
  const value = element('b', '');
  const item = element('span', 'metric');
  item.append(element('span', '', name), value);
  $('metrics').append(item);
  counterViews.set(id, value);
}
function stateTone(value) {
  if (/^(SUCCEEDED|PAID|ACTIVE|GRANTED|COMPLETED)$/.test(value)) return 'green';
  if (/^(FAILED|PAST_DUE)$/.test(value)) return 'pink';
  if (/^(UNKNOWN|RETRY_PENDING|GRACE_PERIOD)$/.test(value)) return 'amber';
  return 'blue';
}
function stateNode(value, className) {
  const node = element('span', 'state-node ' + className, value);
  node.dataset.tone = stateTone(value);
  return node;
}

let scenario = scenarios[0], step = 0, state = { ...base, ...channelDefaults }, before = state;
let pending = false, playing = false, paused = false;
let elapsed = 0, previous, frameId = 0;
let activeDots = [], visibleActors = [];
const flightMs = 950, dwellMs = 2150;
const currentEvent = () => scenario.steps[step - 1];
function eventTone(event) {
  if (/Timeout|未送达/.test(event.op) || event.kind === 'blocked') return 'pink';
  if ([event.from, event.to].includes('reconcile')) return 'amber';
  if ([event.from, event.to].some(id => ['webhook', 'queue', 'billing'].includes(id))) return 'green';
  return 'blue';
}
function drawIcons(ratio = 0) {
  if (!renderer) return;
  const active = currentEvent();
  const source = active && actorKey(active.from);
  const target = active && actorKey(active.to);
  const pulse = pending && !reduce.matches ? Math.sin(ratio * Math.PI) : 0;
  for (const [id, entry] of models) {
    const selected = id === source || id === target;
    entry.primary.emissiveIntensity = selected ? .27 + pulse * .09 : .08;
    entry.sculpture.position.y = selected ? pulse * .09 : 0;
  }
  renderer.render(scene, camera);
}
function resizeScene() {
  if (!renderer || !visibleActors.length || !stage.clientWidth) return;
  const width = stage.clientWidth, height = stage.clientHeight;
  camera.left = -width / 2;
  camera.right = width / 2;
  camera.top = height / 2;
  camera.bottom = -height / 2;
  camera.near = 1;
  camera.far = 2000;
  camera.position.set(0, 0, 400);
  camera.updateProjectionMatrix();
  for (const [id, entry] of models) {
    const index = visibleActors.indexOf(id);
    entry.model.visible = index !== -1;
    if (index === -1) continue;
    entry.model.position.set(((index + .5) / visibleActors.length - .5) * width, 0, 0);
    entry.model.scale.setScalar(Math.min(height * .54, width / visibleActors.length * .63));
  }
  renderer.setSize(width, height, false);
  drawIcons();
}
function renderActors() {
  const event = currentEvent() ?? scenario.steps[0];
  const endpoints = [actorKey(event.from), actorKey(event.to)];
  visibleActors = actors.map(([id]) => id).filter(id => !compact.matches || endpoints.includes(id));
  const diagram = stage.parentElement;
  diagram.style.setProperty('--columns', visibleActors.length);
  const groups = compact.matches ? [['本步参与者', visibleActors.length]] :
    [['应用', 3], ['支付渠道容错层', 1], ['支付渠道', 2], ['异步处理', 3], ['存储与补偿', 2]];
  $('actorGroups').replaceChildren(...groups.map(([name, span]) => {
    const group = element('span', '', name);
    group.style.gridColumn = 'span ' + span;
    return group;
  }));
  const provider = providerFor(event) ?? state.provider;
  $('actors').replaceChildren();
  fallback.replaceChildren();
  for (const id of visibleActors) {
    const label = element('span', 'actor', id === 'psp' ? (provider ?? 'PSP') : actorNames[id]);
    label.setAttribute('role', 'listitem');
    label.dataset.active = String(step > 0 && endpoints.includes(id));
    $('actors').append(label);
    if (!renderer) {
      const icon = element('span', 'flat-icon');
      icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="' + iconPaths[id] + '"/></svg>';
      fallback.append(icon);
    }
  }
  resizeScene();
}
function renderTimeline() {
  const timeline = $('timeline');
  const headingProvider = providerFor(currentEvent() ?? scenario.steps[0]) ?? state.provider;
  timeline.replaceChildren();
  activeDots = [];
  $('jumpToStep').disabled = step === 0;
  for (const [index, event] of scenario.steps.entries()) {
    const active = step > 0 && index === step - 1;
    const row = element('div', 'sequence-row');
    row.dataset.active = String(active);
    row.dataset.preview = String(index >= step);
    row.dataset.tone = eventTone(event);
    const a = compact.matches ? .18 : (visibleActors.indexOf(actorKey(event.from)) + .5) / visibleActors.length;
    const b = compact.matches ? .82 : (visibleActors.indexOf(actorKey(event.to)) + .5) / visibleActors.length;
    const lost = /Timeout|未送达/.test(event.op) || event.kind === 'blocked';
    const endAt = lost && event.to !== 'resilience' ? a + (b - a) * .68 : b;
    row.style.setProperty('--start', (a * 100) + '%');
    row.style.setProperty('--end', (endAt * 100) + '%');
    row.style.setProperty('--width', (Math.abs(endAt - a) * 100) + '%');
    row.style.setProperty('--left', (Math.min(a, endAt) * 100) + '%');
    row.dataset.direction = b >= a ? 'right' : 'left';
    row.dataset.lost = String(lost);
    const operation = element('button', 'operation');
    operation.type = 'button';
    operation.append(element('span', 'ordinal', String(index + 1).padStart(2, '0')));
    const eventProvider = providerFor(event);
    if (!compact.matches && eventProvider && eventProvider !== headingProvider && !event.op.includes(eventProvider)) {
      operation.append(element('span', 'message-provider', eventProvider));
    }
    operation.append(element('code', '', event.op));
    operation.setAttribute('aria-label', `第 ${index + 1} 步，${actorName(event.from)} 到 ${actorName(event.to)}，${event.op}`);
    operation.onclick = () => {
      goTo(index + 1);
      timeline.querySelector('[data-active=true] .operation')?.focus({ preventScroll: true });
    };
    row.append(operation, element('div', 'message-line'), element('span', 'terminus', lost ? '×' : ''));
    if (compact.matches) {
      const endpoints = element('div', 'message-endpoints');
      endpoints.append(element('span', '', actorName(event.from)), element('span', '', actorName(event.to)));
      row.append(endpoints);
    }
    if (active) operation.setAttribute('aria-current', 'step');
    if (active && pending && !reduce.matches) {
      const dotCount = scenario.id === 'duplicates' && event.op.startsWith('重投') ? 3 : 1;
      for (let i = 0; i < dotCount; i++) {
        const dot = element('span', 'message-dot');
        row.append(dot);
        activeDots.push({ dot, from: a, to: endAt });
      }
    }
    timeline.append(row);
  }
}
function renderChannels() {
  $('channelPanel').hidden = !scenario.resilience;
  if (!scenario.resilience) return;

  for (const provider of ['stripe', 'paypal']) {
    const breaker = state[provider + 'Breaker'];
    const used = state[provider + 'Used'];
    const limit = state[provider + 'Limit'];
    const card = $(provider + 'Channel');
    card.dataset.breaker = breaker;
    card.querySelector('.breaker').textContent = breaker;
    card.querySelector('.health').textContent = breaker === 'CLOSED' && used < limit ? 'Healthy' : 'Degraded';
    card.querySelector('.utilization').textContent = `${used} / ${limit}`;
    const meter = card.querySelector('meter');
    meter.max = limit;
    meter.value = used;
  }
  $('healthWindow').textContent = state.failureWindow;
  $('healthCooldown').textContent = state.cooldown;
  $('healthProbes').textContent = state.probes;
}
function renderState() {
  renderChannels();
  let changes = 0;
  for (const [id, { card, nodes }] of fieldViews) {
    const changed = before[id] !== state[id];
    changes += Number(changed);
    card.dataset.changed = String(changed);
    nodes.replaceChildren();
    if (changed) nodes.append(stateNode(before[id], 'old'), element('span', 'state-arrow', '→'));
    nodes.append(stateNode(state[id], 'current'));
  }
  $('stateNote').textContent = pending ? '等待交互结果' :
    !step ? '初始状态' : changes ? `${changes} 项状态迁移` : '本步无状态迁移';
  for (const [id, node] of counterViews) {
    node.textContent = state[id];
    node.dataset.changed = String(before[id] !== state[id]);
  }
}
function renderControls() {
  $('play').textContent = playing ? '暂停' : paused ? '继续播放' :
    step === scenario.steps.length && !pending ? '重播演示' : step ? '继续播放' : '播放演示';
  $('previous').disabled = !step;
  $('next').disabled = step === scenario.steps.length;
  $('progress').textContent = `${step} / ${scenario.steps.length}`;
}
function render() {
  const event = currentEvent();
  $('result').textContent = event?.result ?? scenario.summary;
  $('caption').textContent = event?.note ?? '点击任意步骤查看，或用「下一步」从第一条交互开始。';
  renderActors();
  renderTimeline();
  renderState();
  renderControls();
}
function commit() {
  if (!pending) return;
  pending = false;
  const provider = state.provider;
  state = { ...state, ...currentEvent().patch };
  if (state.provider !== provider) {
    renderActors();
    renderTimeline();
  }
  renderState();
  renderControls();
  for (const { dot } of activeDots) dot.remove();
  activeDots = [];
}
function next() {
  if (step === scenario.steps.length) return false;
  commit();
  before = state;
  step++;
  pending = true;
  elapsed = 0;
  if (reduce.matches) commit();
  render();
  requestFrame();
  return true;
}
function goTo(index) {
  state = { ...base, ...channelDefaults, ...scenario.initial };
  for (const event of scenario.steps.slice(0, Math.max(0, index - 1))) state = { ...state, ...event.patch };
  before = state;
  step = index;
  if (step) state = { ...state, ...currentEvent().patch };
  playing = paused = pending = false;
  elapsed = 0;
  previous = undefined;
  render();
}
function renderCode() {
  const { title, point, source } = codeExamples[scenario.id];
  $('codeScenario').textContent = scenario.name;
  $('codeTitle').textContent = title;
  $('codePoint').textContent = point;
  const fragment = document.createDocumentFragment();
  const tokens = /(?<comment>\/\/[^\n]*)|(?<string>"[^"\n]*")|(?<keyword>\b(?:async|await|function|const|return|if|throw|new|interface|type|try|catch)\b)|(?<number>\b\d+\b)/g;
  let offset = 0;
  for (const match of source.matchAll(tokens)) {
    const category = Object.keys(match.groups).find(key => match.groups[key] !== undefined);
    fragment.append(source.slice(offset, match.index), element('span', 'ts-' + category, match[0]));
    offset = match.index + match[0].length;
  }
  fragment.append(source.slice(offset));
  $('scenarioCode').replaceChildren(fragment);
  $('codeScroll').scrollTo(0, 0);
  $('copyCode').textContent = '复制代码';
}
const clipboard = navigator.clipboard;
if (clipboard?.writeText) {
  $('copyCode').hidden = false;
  $('copyCode').onclick = async () => {
    const selected = scenario;
    try {
      await clipboard.writeText(codeExamples[selected.id].source);
      if (scenario === selected) $('copyCode').textContent = '已复制';
    } catch {
      if (scenario === selected) $('copyCode').textContent = '复制失败，请手动选取';
    }
  };
}
function select(index) {
  scenario = scenarios[index];
  Array.from($('scenarios').children).forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
  $('scenarioTitle').textContent = scenario.title;
  renderCode();
  goTo(0);
}
function requestFrame() {
  if (!frameId && !paused && (playing || pending)) frameId = requestAnimationFrame(frame);
}
function frame(timestamp) {
  frameId = 0;
  if (paused) return;
  elapsed += previous === undefined ? 0 : Math.min(timestamp - previous, 90);
  previous = timestamp;
  const ratio = Math.min(1, elapsed / flightMs);
  for (const [index, { dot, from, to }] of activeDots.entries()) {
    const position = Math.max(0, ratio - index * .055);
    dot.style.left = (100 * (from + (to - from) * position)) + '%';
  }
  if (pending && elapsed >= flightMs) commit();
  drawIcons(ratio);
  if (playing && elapsed >= flightMs + dwellMs && !next()) {
    playing = false;
    renderControls();
  }
  if (!playing && !pending) previous = undefined;
  requestFrame();
}

scenarios.forEach(({ name, resilience }, index) => {
  const button = element('button', '', name);
  button.type = 'button';
  if (resilience) button.classList.add('resilience-choice');
  button.onclick = () => select(index);
  $('scenarios').append(button);
});
function togglePlay() {
  if (playing) {
    playing = false;
    paused = true;
  } else {
    if (!paused && step === scenario.steps.length && !pending) goTo(0);
    paused = false;
    playing = true;
    previous = undefined;
    if (!step) next();
  }
  renderControls();
  requestFrame();
}
function stepForward() {
  playing = paused = false;
  previous = undefined;
  next();
}
$('play').onclick = togglePlay;
$('previous').onclick = () => goTo(Math.max(0, step - 1));
$('next').onclick = stepForward;
$('reset').onclick = () => goTo(0);
$('jumpToStep').onclick = () => {
  const current = $('timeline').querySelector('.operation[aria-current=step]');
  current?.scrollIntoView({ block: 'center' });
  current?.focus({ preventScroll: true });
};
document.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey ||
      event.target.closest?.('input, select, textarea, pre, [contenteditable]')) return;
  if (event.key === 'ArrowRight' && step < scenario.steps.length) stepForward();
  else if (event.key === 'ArrowLeft' && step) goTo(step - 1);
  else if (event.key === ' ' && !event.target.closest?.('button, a, summary')) togglePlay();
  else return;
  event.preventDefault();
});
const requested = new URLSearchParams(location.search).get('demo');
select(Math.max(0, scenarios.findIndex(({ id }) => id === requested)));
compact.addEventListener('change', render);
reduce.addEventListener('change', () => {
  if (reduce.matches) commit();
  render();
});
new ResizeObserver(resizeScene).observe(stage);
