import test from 'node:test';
import assert from 'node:assert/strict';
import {
  METHODS,
  validate,
  acceleration,
  diagnostics,
  advance,
  simulate,
  compare,
  trajectoryCSV,
  fixture,
} from '../core.js';
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
test('isolated motion is exactly linear to floating-point tolerance for every integrator', () => {
  const s = fixture('drift');
  for (const method of METHODS) {
    const r = simulate(s, method),
      last = r.samples.at(-1);
    near(last.bodies[0].x, 4);
    near(last.bodies[0].y, 2);
    near(last.diagnostics.energy, r.initial.energy);
    assert.equal(r.peakEnergyDrift, 0);
    near(r.peakCOMError, 0);
  }
});
test('pair forces balance and analytic softened force has the expected magnitude', () => {
  const b = [
      { id: 'A', mass: 2, x: 0, y: 0, vx: 0, vy: 0 },
      { id: 'B', mass: 3, x: 3, y: 4, vx: 0, vy: 0 },
    ],
    a = acceleration(b, 0.2),
    den = (25 + 0.04) ** 1.5;
  near(a[0].x, 9 / den);
  near(a[0].y, 12 / den);
  near(2 * a[0].x + 3 * a[1].x, 0);
  near(2 * a[0].y + 3 * a[1].y, 0);
});
test('potential gradient agrees with the implemented acceleration', () => {
  const b = fixture('trio').bodies,
    a = acceleration(b, 0.05),
    h = 1e-5;
  for (let i = 0; i < b.length; i++)
    for (const axis of ['x', 'y']) {
      const plus = structuredClone(b),
        minus = structuredClone(b);
      plus[i][axis] += h;
      minus[i][axis] -= h;
      const gradient =
        (diagnostics(plus, 0.05).potential - diagnostics(minus, 0.05).potential) / (2 * h);
      near(-gradient / b[i].mass, a[i][axis], 1e-8);
    }
});
test('softened circular orbit matches the analytic trajectory and converges at expected orders', () => {
  const s = fixture(),
    omega = s.bodies[1].vy;
  for (const [method, min, max] of [
    ['euler', 1.7, 2.3],
    ['verlet', 3.7, 4.3],
    ['rk4', 13, 19],
  ]) {
    const errors = [0.1, 0.05].map((dt) => {
      const r = simulate({ ...s, dt, steps: Math.round(1 / dt) }, method),
        b = r.samples.at(-1).bodies[1];
      return Math.hypot(b.x - Math.cos(omega), b.y - Math.sin(omega));
    });
    assert.ok(
      errors[0] / errors[1] > min && errors[0] / errors[1] < max,
      `${method} ratio ${errors[0] / errors[1]}`,
    );
  }
});
test('velocity Verlet is reversible under a step followed by its negative', () => {
  const b = fixture('trio').bodies,
    next = advance(b, 0.01, 0.05, 'verlet'),
    back = advance(next, -0.01, 0.05, 'verlet');
  for (let i = 0; i < b.length; i++)
    for (const k of ['x', 'y', 'vx', 'vy']) near(back[i][k], b[i][k], 1e-12);
});
test('closed systems conserve momentum and center-of-mass motion numerically', () => {
  const s = { ...fixture('trio'), steps: 1500, dt: 0.005 };
  for (const method of METHODS) {
    const r = simulate(s, method);
    assert.ok(r.peakMomentumDrift < 1e-11);
    assert.ok(r.peakCOMError < 1e-11);
  }
});
test('comparison exposes Euler energy drift and records peaks beyond sampled frames', () => {
  const r = compare(fixture()),
    [e, v, k] = r.runs;
  assert.ok(e.peakEnergyDrift > v.peakEnergyDrift * 100);
  assert.ok(e.peakEnergyDrift > k.peakEnergyDrift * 100);
  for (const run of r.runs) {
    assert.ok(
      run.peakEnergyDrift >= Math.max(...run.samples.map((s) => Math.abs(s.energyDrift))) - 1e-15,
    );
    assert.equal(run.samples[0].step, 0);
    assert.equal(run.samples.at(-1).step, 1000);
  }
});
test('stationary isolated body has finite zero drift with an explicit normalization scale', () => {
  const s = fixture('drift');
  s.bodies[0].vx = 0;
  s.bodies[0].vy = 0;
  const r = simulate(s, 'rk4');
  assert.equal(r.energyScale, 1);
  assert.equal(r.peakEnergyDrift, 0);
  assert.equal(r.peakMomentumDrift, 0);
});
test('overlapping initial bodies remain finite under softening', () => {
  const s = fixture();
  s.bodies.forEach((b) => {
    b.x = 0;
    b.y = 0;
    b.vx = 0;
    b.vy = 0;
  });
  const r = simulate({ ...s, steps: 10 }, 'verlet');
  assert.ok(Number.isFinite(r.initial.energy));
  assert.equal(r.peakEnergyDrift, 0);
});
test('invalid scenarios and numerical blow-up fail with bounded diagnostics', () => {
  const s = fixture();
  for (const bad of [
    { ...s, dt: 0 },
    { ...s, softening: 0 },
    { ...s, steps: 20001 },
    { ...s, bodies: [] },
    { ...s, bodies: [s.bodies[0], s.bodies[0]] },
    { ...s, extra: 1 },
  ])
    assert.throws(() => validate(bad));
  const close = {
    ...s,
    dt: 0.1,
    softening: 0.001,
    steps: 20,
    bodies: [
      { id: 'A', mass: 100, x: 0, y: 0, vx: 0, vy: 0 },
      { id: 'B', mass: 100, x: 0.001, y: 0, vx: 0, vy: 0 },
    ],
  };
  assert.throws(() => simulate(close, 'euler'), /numerical bounds/);
  assert.throws(() => simulate(s, 'unknown'));
});
test('sample count stays bounded and exports preserve final time and source data', () => {
  const s = { ...fixture('drift'), steps: 20000, dt: 0.0001 },
    before = JSON.stringify(s),
    run = simulate(s, 'verlet');
  assert.ok(run.samples.length <= 501);
  assert.equal(run.samples.at(-1).time, 2);
  assert.equal(JSON.stringify(s), before);
  const csv = trajectoryCSV({ runs: [run] });
  assert.ok(csv.startsWith('method,step,time,body'));
  assert.ok(csv.includes('verlet,20000,2,Solo,1,'));
});
