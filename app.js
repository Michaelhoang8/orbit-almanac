import { fixture, validate, trajectoryCSV } from './core.js';
const $ = (id) => document.getElementById(id),
  ns = 'http://www.w3.org/2000/svg';
const colors = [
  '#e3b470',
  '#76b6d5',
  '#d9dce4',
  '#ba8ecb',
  '#93bd9f',
  '#df8c7c',
  '#b4a3d8',
  '#a6bcc1',
];
const methodNames = { euler: 'Explicit Euler', verlet: 'Velocity Verlet', rk4: 'Classical RK4' },
  methodColors = { euler: '#dd8d79', verlet: '#d4b776', rk4: '#7baacb' };
let draft = fixture(),
  result = null,
  worker = null,
  busy = false,
  revision = 0,
  frame = 0,
  playing = false,
  animation = null,
  lastTick = 0;
const el = (tag, text) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  return n;
};
const num = (n) => Number(n.toFixed(4)).toLocaleString(),
  sci = (n) => n.toExponential(3);
function status(text) {
  $('status').textContent = text;
  $('settings-status').textContent = text;
}
function stop() {
  playing = false;
  if (animation !== null) cancelAnimationFrame(animation);
  animation = null;
  $('play').textContent = 'Play trajectory';
}
function controls() {
  for (const n of document.querySelectorAll('button,input,select')) n.disabled = busy;
  $('cancel').disabled = !busy;
  $('settings-close').disabled = false;
  $('analysis-close').disabled = false;
  $('analysis-open').disabled = busy || !result;
  $('add').disabled = busy || draft.bodies.length >= 8;
  for (const n of document.querySelectorAll('[data-remove]'))
    n.disabled = busy || draft.bodies.length === 1;
}
function invalidate() {
  stop();
  revision++;
  worker?.terminate();
  worker = null;
  busy = false;
  result = null;
  $('results').hidden = true;
  controls();
  status('Initial conditions changed. Compare again to refresh trajectories.');
}
function editor() {
  for (const key of ['dt', 'steps', 'softening']) $(key).value = draft[key];
  $('body-count').textContent = `/ ${draft.bodies.length}`;
  $('bodies').replaceChildren();
  draft.bodies.forEach((body, index) => {
    const row = el('tr');
    for (const key of ['id', 'mass', 'x', 'y', 'vx', 'vy']) {
      const cell = el('td'),
        input = el('input');
      input.type = key === 'id' ? 'text' : 'number';
      input.value = body[key];
      if (key !== 'id') input.step = 'any';
      input.setAttribute('aria-label', `Body ${index + 1} ${key}`);
      input.addEventListener('input', () => {
        body[key] =
          key === 'id' ? input.value : input.value.trim() === '' ? NaN : Number(input.value);
        invalidate();
      });
      cell.append(input);
      row.append(cell);
    }
    const cell = el('td'),
      remove = el('button', 'Remove');
    remove.dataset.remove = 'true';
    remove.setAttribute('aria-label', `Remove body ${index + 1}`);
    remove.addEventListener('click', () => {
      if (draft.bodies.length > 1) {
        draft.bodies.splice(index, 1);
        invalidate();
        editor();
      }
    });
    cell.append(remove);
    row.append(cell);
    $('bodies').append(row);
  });
  controls();
}
function run(candidate = draft) {
  invalidate();
  let value;
  try {
    value = validate(candidate);
  } catch (e) {
    status(e.message);
    return;
  }
  const ticket = revision,
    w = new Worker('worker.js', { type: 'module' });
  worker = w;
  busy = true;
  controls();
  status('Integrating the same scenario with three numerical methods…');
  w.onmessage = ({ data }) => {
    if (ticket !== revision) return;
    w.terminate();
    worker = null;
    busy = false;
    if (data.error) {
      status(data.error);
      controls();
      return;
    }
    result = data.result;
    draft = structuredClone(result.scenario);
    editor();
    frame = result.runs[0].samples.length - 1;
    render();
    $('settings-panel').close();
    status(
      `Compared ${draft.steps.toLocaleString()} steps per method over ${num(draft.steps * draft.dt)} time units. Diagnostics checked every step.`,
    );
  };
  w.onerror = () => {
    if (ticket === revision) {
      w.terminate();
      worker = null;
      busy = false;
      controls();
      status('Integration worker failed. Compare again to retry.');
    }
  };
  w.postMessage(value);
}
function svg(tag, attrs, text) {
  const n = document.createElementNS(ns, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
}
function render() {
  if (!result) return;
  $('results').hidden = false;
  const run = result.runs.find((r) => r.method === $('method').value),
    sample = run.samples[frame];
  $('frame').max = run.samples.length - 1;
  $('frame').value = frame;
  $('time').textContent = `t = ${num(sample.time)} / step ${sample.step}`;
  $('energy').textContent = sci(sample.energyDrift);
  $('momentum').textContent = `(${sci(sample.diagnostics.px)}, ${sci(sample.diagnostics.py)})`;
  $('com').textContent = `(${num(sample.diagnostics.cx)}, ${num(sample.diagnostics.cy)})`;
  $('legend').textContent = result.scenario.bodies
    .map(
      (b, i) =>
        `${b.id} / ${['amber', 'blue', 'pearl', 'purple', 'green', 'coral', 'lilac', 'gray'][i]}`,
    )
    .join(' · ');
  const all = result.runs.flatMap((r) => r.samples.flatMap((s) => s.bodies)),
    xs = all.map((b) => b.x),
    ys = all.map((b) => b.y),
    minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys),
    cx = (minX + maxX) / 2,
    cy = (minY + maxY) / 2,
    scale = Math.min(300 / Math.max(1, maxX - minX), 300 / Math.max(1, maxY - minY)),
    x = (v) => 200 + (v - cx) * scale,
    y = (v) => 200 - (v - cy) * scale;
  for (const orbitRun of result.runs) {
    const run = orbitRun,
      sample = run.samples[frame],
      root = $(run.method === 'verlet' ? 'orbit' : 'orbit-' + run.method);
    $('drift-' + run.method).textContent = sci(sample.energyDrift);
    root.replaceChildren();
    root.setAttribute(
      'aria-label',
      `${methodNames[run.method]} trajectories at time ${num(sample.time)}. Bright trails show up to 15 most recent recorded positions.`,
    );
    for (let i = 0; i <= 4; i++) {
      const px = 50 + i * 75,
        py = 50 + i * 75;
      root.append(
        svg('line', { x1: px, x2: px, y1: 35, y2: 350, stroke: '#333431' }),
        svg('line', { x1: 35, x2: 350, y1: py, y2: py, stroke: '#333431' }),
        svg(
          'text',
          { x: px, y: 375, 'font-size': 10, 'text-anchor': 'middle', fill: '#787b70' },
          num(cx + (px - 200) / scale),
        ),
        svg(
          'text',
          { x: 30, y: py + 3, 'font-size': 10, 'text-anchor': 'end', fill: '#787b70' },
          num(cy - (py - 200) / scale),
        ),
      );
    }
    sample.bodies.forEach((b, i) => {
      const line = run.samples
        .slice(0, frame + 1)
        .map((s) => `${x(s.bodies[i].x)},${y(s.bodies[i].y)}`)
        .join(' ');
      root.append(
        svg('polyline', {
          points: line,
          fill: 'none',
          stroke: colors[i],
          'stroke-width': 1.3,
          opacity: 0.3,
        }),
        svg('polyline', {
          points: run.samples
            .slice(Math.max(0, frame - 14), frame + 1)
            .map((s) => `${x(s.bodies[i].x)},${y(s.bodies[i].y)}`)
            .join(' '),
          fill: 'none',
          stroke: colors[i],
          'stroke-width': 2,
          'stroke-linecap': 'round',
          opacity: 0.95,
        }),
        svg('circle', {
          cx: x(b.x),
          cy: y(b.y),
          r: 12 + Math.min(4, Math.sqrt(b.mass)),
          fill: colors[i],
          opacity: 0.06,
        }),
        svg('circle', {
          cx: x(b.x),
          cy: y(b.y),
          r: 7 + Math.min(4, Math.sqrt(b.mass)),
          fill: colors[i],
          opacity: 0.12,
        }),
        svg('circle', {
          cx: x(b.x),
          cy: y(b.y),
          r: 3 + Math.min(4, Math.sqrt(b.mass)),
          fill: colors[i],
          stroke: '#fff4',
          'stroke-width': 0.8,
        }),
      );
    });
  }
  const chart = $('energy-plot');
  chart.replaceChildren();
  const maxDrift = Math.max(
      ...result.runs.flatMap((r) => r.samples.map((s) => Math.abs(s.energyDrift))),
    ),
    top = Math.max(-15, Math.ceil(Math.log10(Math.max(maxDrift, 1e-16)))),
    time = result.scenario.steps * result.scenario.dt,
    px = (t) => 65 + (t / time) * 900,
    py = (d) => 175 - ((Math.log10(Math.max(Math.abs(d), 1e-16)) + 16) / (top + 16)) * 150;
  for (let i = 0; i <= 4; i++) {
    const yy = 25 + i * 37.5,
      exp = top - (i * (top + 16)) / 4;
    chart.append(
      svg('line', { x1: 65, x2: 965, y1: yy, y2: yy, stroke: '#29414f' }),
      svg(
        'text',
        { x: 55, y: yy + 3, 'text-anchor': 'end', 'font-size': 10, fill: '#6b8da0' },
        `10^${Number(exp.toFixed(1))}`,
      ),
    );
  }
  for (const r of result.runs)
    chart.append(
      svg('polyline', {
        points: r.samples.map((s) => `${px(s.time)},${py(s.energyDrift)}`).join(' '),
        fill: 'none',
        stroke: methodColors[r.method],
        'stroke-width': 1.8,
      }),
    );
  chart.append(
    svg('line', {
      x1: px(sample.time),
      x2: px(sample.time),
      y1: 20,
      y2: 180,
      stroke: '#718996',
      'stroke-dasharray': '4 4',
    }),
    svg('text', { x: 65, y: 199, 'font-size': 10, fill: '#6b8da0' }, '0'),
    svg(
      'text',
      { x: 965, y: 199, 'text-anchor': 'end', 'font-size': 10, fill: '#6b8da0' },
      `t = ${num(time)}`,
    ),
  );
  $('ledger').replaceChildren();
  for (const r of result.runs) {
    const row = el('tr');
    for (const value of [
      methodNames[r.method],
      sci(r.peakEnergyDrift),
      sci(r.peakMomentumDrift),
      sci(r.peakCOMError),
      r.samples.length,
    ])
      row.append(el('td', value));
    $('ledger').append(row);
  }
  controls();
}
function tick(now) {
  if (!playing || !result) return;
  if (now - lastTick >= 50) {
    lastTick = now;
    frame++;
    if (frame >= result.runs[0].samples.length) {
      frame = result.runs[0].samples.length - 1;
      stop();
      render();
      return;
    }
    render();
  }
  animation = requestAnimationFrame(tick);
}
$('play').addEventListener('click', () => {
  if (playing) {
    stop();
    return;
  }
  if (!result) return;
  if (frame === result.runs[0].samples.length - 1) frame = 0;
  playing = true;
  $('play').textContent = 'Pause';
  lastTick = 0;
  render();
  animation = requestAnimationFrame(tick);
});
$('frame').addEventListener('input', () => {
  stop();
  frame = Number($('frame').value);
  render();
});
$('method').addEventListener('change', () => {
  stop();
  render();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stop();
});
for (const key of ['dt', 'steps', 'softening'])
  $(key).addEventListener('input', () => {
    draft[key] = $(key).value.trim() === '' ? NaN : Number($(key).value);
    invalidate();
  });
$('run').addEventListener('click', () => run());
$('cancel').addEventListener('click', () => {
  revision++;
  worker?.terminate();
  worker = null;
  busy = false;
  controls();
  status('Integration cancelled.');
});
$('example').addEventListener('change', () => {
  draft = fixture($('example').value);
  editor();
  run();
});
$('add').addEventListener('click', () => {
  if (draft.bodies.length >= 8) return;
  let n = 1;
  while (draft.bodies.some((b) => b.id === `Body${n}`)) n++;
  draft.bodies.push({ id: `Body${n}`, mass: 0.2, x: 2, y: 1, vx: -0.2, vy: 0.2 });
  invalidate();
  editor();
});
function download(name, data, type = 'application/json') {
  const u = URL.createObjectURL(new Blob([data], { type })),
    a = el('a');
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
$('save').addEventListener('click', () => {
  if (result) download('orbit-scenario.json', JSON.stringify(result.scenario, null, 2));
});
$('csv').addEventListener('click', () => {
  if (result) download('orbit-trajectories.csv', trajectoryCSV(result), 'text/csv;charset=utf-8');
});
$('report').addEventListener('click', () => {
  if (result) download('orbit-diagnostics.json', JSON.stringify(result, null, 2));
});
$('file').addEventListener('change', async () => {
  const f = $('file').files[0];
  if (!f) return;
  stop();
  const ticket = ++revision;
  busy = true;
  controls();
  try {
    if (f.size > 100000) throw Error('Scenario files are limited to 100 KB.');
    const candidate = validate(JSON.parse(await f.text()));
    if (ticket !== revision) return;
    busy = false;
    run(candidate);
  } catch (e) {
    if (ticket === revision) {
      busy = false;
      controls();
      status(`Scenario rejected: ${e.message}`);
    }
  } finally {
    $('file').value = '';
  }
});
editor();
run();

for (const name of ['settings', 'analysis']) {
  $(name + '-open').addEventListener('click', () => {
    stop();
    $(name + '-panel').showModal();
  });
  $(name + '-close').addEventListener('click', () => $(name + '-panel').close());
}
