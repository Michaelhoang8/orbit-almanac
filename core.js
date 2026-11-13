export const METHODS = ['euler', 'verlet', 'rk4'];
export function validate(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).sort().join(',') !== 'bodies,dt,softening,steps'
  )
    throw Error('A scenario needs bodies, dt, softening, and steps.');
  if (
    !Number.isFinite(input.dt) ||
    input.dt < 0.0001 ||
    input.dt > 0.1 ||
    !Number.isInteger(input.steps) ||
    input.steps < 1 ||
    input.steps > 20000 ||
    !Number.isFinite(input.softening) ||
    input.softening < 0.001 ||
    input.softening > 1
  )
    throw Error('Use dt 0.0001–0.1, 1–20,000 steps, and softening 0.001–1.');
  if (!Array.isArray(input.bodies) || !input.bodies.length || input.bodies.length > 8)
    throw Error('Use 1–8 bodies.');
  const ids = new Set();
  for (const b of input.bodies) {
    if (
      !b ||
      typeof b !== 'object' ||
      Object.keys(b).sort().join(',') !== 'id,mass,vx,vy,x,y' ||
      typeof b.id !== 'string' ||
      !/^[A-Za-z][A-Za-z0-9_-]{0,15}$/.test(b.id) ||
      ids.has(b.id)
    )
      throw Error('Bodies need distinct simple IDs and mass, x, y, vx, vy fields.');
    ids.add(b.id);
    for (const key of ['mass', 'x', 'y', 'vx', 'vy'])
      if (!Number.isFinite(b[key])) throw Error('Body values must be finite.');
    if (
      b.mass < 0.001 ||
      b.mass > 100 ||
      Math.abs(b.x) > 100 ||
      Math.abs(b.y) > 100 ||
      Math.abs(b.vx) > 20 ||
      Math.abs(b.vy) > 20
    )
      throw Error(
        'Mass must be 0.001–100, coordinates within ±100, and initial velocities within ±20.',
      );
  }
  return structuredClone(input);
}
export function acceleration(bodies, softening) {
  const a = bodies.map(() => ({ x: 0, y: 0 }));
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++) {
      const dx = bodies[j].x - bodies[i].x,
        dy = bodies[j].y - bodies[i].y,
        factor = 1 / (dx * dx + dy * dy + softening * softening) ** 1.5;
      a[i].x += bodies[j].mass * dx * factor;
      a[i].y += bodies[j].mass * dy * factor;
      a[j].x -= bodies[i].mass * dx * factor;
      a[j].y -= bodies[i].mass * dy * factor;
    }
  return a;
}
export function diagnostics(bodies, softening) {
  let kinetic = 0,
    potential = 0,
    px = 0,
    py = 0,
    angular = 0,
    cx = 0,
    cy = 0,
    mass = 0;
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    kinetic += 0.5 * b.mass * (b.vx * b.vx + b.vy * b.vy);
    px += b.mass * b.vx;
    py += b.mass * b.vy;
    angular += b.mass * (b.x * b.vy - b.y * b.vx);
    cx += b.mass * b.x;
    cy += b.mass * b.y;
    mass += b.mass;
    for (let j = i + 1; j < bodies.length; j++)
      potential -=
        (b.mass * bodies[j].mass) /
        Math.sqrt((b.x - bodies[j].x) ** 2 + (b.y - bodies[j].y) ** 2 + softening * softening);
  }
  return {
    kinetic,
    potential,
    energy: kinetic + potential,
    px,
    py,
    angular,
    cx: cx / mass,
    cy: cy / mass,
    mass,
  };
}
export function advance(bodies, dt, softening, method) {
  if (!METHODS.includes(method)) throw Error('Unknown integrator.');
  const a = acceleration(bodies, softening);
  if (method === 'euler')
    return bodies.map((b, i) => ({
      ...b,
      x: b.x + dt * b.vx,
      y: b.y + dt * b.vy,
      vx: b.vx + dt * a[i].x,
      vy: b.vy + dt * a[i].y,
    }));
  if (method === 'verlet') {
    const next = bodies.map((b, i) => ({
        ...b,
        x: b.x + dt * b.vx + 0.5 * dt * dt * a[i].x,
        y: b.y + dt * b.vy + 0.5 * dt * dt * a[i].y,
      })),
      last = acceleration(next, softening);
    return next.map((b, i) => ({
      ...b,
      vx: b.vx + 0.5 * dt * (a[i].x + last[i].x),
      vy: b.vy + 0.5 * dt * (a[i].y + last[i].y),
    }));
  }
  const derivative = (state) => {
    const acc = acceleration(state, softening);
    return state.map((b, i) => ({ x: b.vx, y: b.vy, vx: acc[i].x, vy: acc[i].y }));
  };
  const offset = (k, factor) =>
    bodies.map((b, i) => ({
      ...b,
      x: b.x + dt * factor * k[i].x,
      y: b.y + dt * factor * k[i].y,
      vx: b.vx + dt * factor * k[i].vx,
      vy: b.vy + dt * factor * k[i].vy,
    }));
  const k1 = bodies.map((b, i) => ({ x: b.vx, y: b.vy, vx: a[i].x, vy: a[i].y })),
    k2 = derivative(offset(k1, 0.5)),
    k3 = derivative(offset(k2, 0.5)),
    k4 = derivative(offset(k3, 1));
  return bodies.map((b, i) => {
    const next = { ...b };
    for (const key of ['x', 'y', 'vx', 'vy'])
      next[key] += (dt / 6) * (k1[i][key] + 2 * k2[i][key] + 2 * k3[i][key] + k4[i][key]);
    return next;
  });
}
export function simulate(input, method) {
  const scenario = validate(input);
  if (!METHODS.includes(method)) throw Error('Unknown integrator.');
  let bodies = scenario.bodies;
  const initial = diagnostics(bodies, scenario.softening),
    energyScale = initial.kinetic + Math.abs(initial.potential) || 1,
    stride = Math.max(1, Math.ceil(scenario.steps / 500)),
    samples = [];
  let peakEnergyDrift = 0,
    peakMomentumDrift = 0,
    peakCOMError = 0;
  const record = (step, d) =>
    samples.push({
      step,
      time: step * scenario.dt,
      bodies: structuredClone(bodies),
      diagnostics: d,
      energyDrift: (d.energy - initial.energy) / energyScale,
    });
  record(0, initial);
  for (let step = 1; step <= scenario.steps; step++) {
    bodies = advance(bodies, scenario.dt, scenario.softening, method);
    if (
      bodies.some((b) =>
        ['x', 'y', 'vx', 'vy'].some((k) => !Number.isFinite(b[k]) || Math.abs(b[k]) > 1000000),
      )
    )
      throw Error(
        `${method}: integration exceeded the numerical bounds. Reduce the time step or separate nearby bodies.`,
      );
    const d = diagnostics(bodies, scenario.softening),
      time = step * scenario.dt;
    peakEnergyDrift = Math.max(peakEnergyDrift, Math.abs(d.energy - initial.energy) / energyScale);
    peakMomentumDrift = Math.max(
      peakMomentumDrift,
      Math.hypot(d.px - initial.px, d.py - initial.py),
    );
    peakCOMError = Math.max(
      peakCOMError,
      Math.hypot(
        d.cx - initial.cx - (initial.px / initial.mass) * time,
        d.cy - initial.cy - (initial.py / initial.mass) * time,
      ),
    );
    if (step % stride === 0 || step === scenario.steps) record(step, d);
  }
  return {
    method,
    initial,
    energyScale,
    peakEnergyDrift,
    peakMomentumDrift,
    peakCOMError,
    stride,
    samples,
  };
}
export function compare(input) {
  const scenario = validate(input);
  return { scenario, runs: METHODS.map((method) => simulate(scenario, method)) };
}
export function trajectoryCSV(result) {
  const rows = ['method,step,time,body,mass,x,y,vx,vy,energy,normalized_energy_drift'];
  for (const run of result.runs)
    for (const s of run.samples)
      for (const b of s.bodies)
        rows.push(
          [
            run.method,
            s.step,
            s.time,
            b.id,
            b.mass,
            b.x,
            b.y,
            b.vx,
            b.vy,
            s.diagnostics.energy,
            s.energyDrift,
          ].join(','),
        );
  return rows.join('\r\n') + '\r\n';
}
export function fixture(kind = 'binary') {
  const softening = 0.05,
    v = Math.sqrt(2 / (4 + softening * softening) ** 1.5);
  let bodies;
  if (kind === 'binary')
    bodies = [
      { id: 'Amber', mass: 1, x: -1, y: 0, vx: 0, vy: -v },
      { id: 'Blue', mass: 1, x: 1, y: 0, vx: 0, vy: v },
    ];
  else if (kind === 'trio')
    bodies = [
      { id: 'Amber', mass: 1, x: -1, y: 0, vx: 0.1, vy: -0.35 },
      { id: 'Blue', mass: 1, x: 1, y: 0, vx: 0.1, vy: 0.35 },
      { id: 'Pearl', mass: 0.2, x: 0, y: 1.6, vx: -1, vy: 0 },
    ];
  else if (kind === 'drift') bodies = [{ id: 'Solo', mass: 1, x: -2, y: 0, vx: 0.3, vy: 0.1 }];
  else throw Error('Unknown scenario.');
  return { bodies, dt: 0.02, steps: 1000, softening };
}
