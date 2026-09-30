// animator.js — exploded view, step-by-step install playback and wind blow-off for a DesignModel.
// DOM-free. Per-object state lives in obj.userData.__anim; per-model state in model.group.userData.__anim.
//
// Pose composition (so the three effects can overlap and always restore exactly):
//   blown  → absolute ballistic pose
//   else   → base + explodeOffset·ease(k) + (0, dropHeight, 0);  visible = baseVisible && !hiddenByInstall
// Offsets are given in the model-group frame and converted to each object's parent frame once.
import * as THREE from 'three';

const DROP_H = 2.5;          // install: parts drop in from this height (m)
const DROP_DUR = 0.75;       // install: seconds per object drop (at speed 1)
const DT_MAX = 0.05;
const GRAVITY = 9.81;
const FLUTTER = 0.3;         // blow-off: flutter / lift delay before launch (s)
const FADE_AFTER = 6;        // blow-off: objects still airborne after this (s) shrink away
const UP = new THREE.Vector3(0, 1, 0);

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _box = new THREE.Box3();

const clamp01 = (k) => (k < 0 ? 0 : k > 1 ? 1 : k);
const smoothstep = (k) => { k = clamp01(k); return k * k * (3 - 2 * k); };

// Ease-out-back drop offset (m): falls from DROP_H, overshoots a few cm below the seat and settles.
// The overshoot is scaled down so parts never visibly sink into the roof.
function dropOffset(u) {
  if (u <= 0) return DROP_H;
  if (u >= 1) return 0;
  const c1 = 1.70158, c3 = c1 + 1, w = u - 1;
  const back = 1 + c3 * w * w * w + c1 * w * w;   // easeOutBack, peaks at ≈1.1
  const off = DROP_H * (1 - back);
  return off < 0 ? off * 0.16 : off;              // ≤ 4 cm dip
}

// Deterministic PRNG (mulberry32).
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- per-object state
function vec3Of(e) {
  if (!e) return new THREE.Vector3();
  if (e.isVector3) return e.clone();
  if (Array.isArray(e)) return new THREE.Vector3(e[0] || 0, e[1] || 0, e[2] || 0);
  return new THREE.Vector3(e.x || 0, e.y || 0, e.z || 0);
}

// Matrix taking model-group-frame coordinates to obj.parent's frame (null = identity).
// Requires up-to-date world matrices.
function groupToParent(obj, group) {
  if (!obj.parent || obj.parent === group) return null;
  return new THREE.Matrix4().copy(obj.parent.matrixWorld).invert().multiply(group.matrixWorld);
}

function ensureAnim(obj, group) {
  let a = obj.userData.__anim;
  if (a && a.group === group) return a;
  const toParent = groupToParent(obj, group);
  const dirToParent = toParent ? new THREE.Matrix3().setFromMatrix4(toParent) : null;
  const explode = vec3Of(obj.userData.explode);
  const up = UP.clone();
  if (dirToParent) { explode.applyMatrix3(dirToParent); up.applyMatrix3(dirToParent); }
  a = {
    group,
    basePos: obj.position.clone(),
    baseQuat: obj.quaternion.clone(),
    baseScale: obj.scale.clone(),
    baseVisible: obj.visible,
    toParent,                 // group frame → parent frame (null = identity)
    explodeLocal: explode,    // explode offset in the parent frame
    upLocal: up,              // group +Y in the parent frame
    explodeE: 0,              // eased explode amount currently applied
    drop: 0,                  // install drop height (m)
    hidden: false,            // hidden by the install sequence
    blow: null,               // blow-off state
  };
  obj.userData.__anim = a;
  return a;
}

function applyPose(obj) {
  const a = obj.userData.__anim;
  if (!a) return;
  if (a.blow) { writeBlowPose(obj, a.blow); return; }
  obj.position.copy(a.basePos);
  if (a.explodeE !== 0) obj.position.addScaledVector(a.explodeLocal, a.explodeE);
  if (a.drop !== 0) obj.position.addScaledVector(a.upLocal, a.drop);
  obj.quaternion.copy(a.baseQuat);
  obj.scale.copy(a.baseScale);
  obj.visible = a.baseVisible && !a.hidden;
}

function writeBlowPose(obj, b) {
  _v.copy(b.scale).multiplyScalar(b.shrink);
  if (!b.toParent) {
    obj.position.copy(b.pos);
    obj.quaternion.copy(b.quat);
    obj.scale.copy(_v);
  } else {
    _m.compose(b.pos, b.quat, _v).premultiply(b.toParent);
    _m.decompose(obj.position, obj.quaternion, obj.scale);
  }
  obj.visible = b.visible;
}

// Bounding box of obj's subtree expressed in obj's own frame.
function localBox(obj) {
  obj.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
  const box = new THREE.Box3();
  obj.traverse((o) => {
    if (!o.geometry) return;
    let gb;
    if (o.isInstancedMesh) { if (!o.boundingBox) o.computeBoundingBox(); gb = o.boundingBox; }
    else { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); gb = o.geometry.boundingBox; }
    if (!gb || gb.isEmpty()) return;
    _box.copy(gb).applyMatrix4(_m2.multiplyMatrices(inv, o.matrixWorld));
    box.union(_box);
  });
  if (box.isEmpty()) box.set(new THREE.Vector3(-0.05, -0.05, -0.05), new THREE.Vector3(0.05, 0.05, 0.05));
  return box;
}

// Lowest y (group frame) of a local box posed with (pos, quat, scale).
function lowestY(box, pos, quat, scale) {
  let min = Infinity;
  for (let i = 0; i < 8; i++) {
    _v2.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z)
      .multiply(scale).applyQuaternion(quat);
    if (_v2.y < min) min = _v2.y;
  }
  return pos.y + min;
}

// ---------------------------------------------------------------- model helpers
function modelState(model) {
  const u = model.group.userData;
  if (!u.__anim) u.__anim = { explodeK: 0 };
  return u.__anim;
}

function uniq(list) { return [...new Set(list.filter((o) => o && o.isObject3D))]; }

function explodeObjects(model) {
  const out = [];
  for (const p of model.parts || []) out.push(...(p.objects || []));
  for (const s of model.installSteps || []) out.push(...(s.objects || []));
  return uniq(out);
}

// ---------------------------------------------------------------- animator
export function createAnimator() {
  const installs = new Map();   // model → install playback
  const flying = new Set();     // objects with an active blow-off simulation
  const tweens = new Map();     // model → explode tween (re-explode after an install)

  // Update world matrices and snapshot base transforms of every animated object while at rest,
  // so nested objects (e.g. panels inside a wind-loose plate group) get correct frames.
  function prepare(model) {
    const g = model.group;
    g.updateWorldMatrix(true, true);
    for (const o of explodeObjects(model)) ensureAnim(o, g);
    for (const o of uniq(model.windLoose || [])) ensureAnim(o, g);
  }

  // ---- exploded view
  function applyExplode(model, e) {
    for (const obj of explodeObjects(model)) {
      const a = ensureAnim(obj, model.group);
      a.explodeE = e;
      applyPose(obj);
    }
  }

  /** k ∈ [0,1]. While an install plays the view stays collapsed; k is re-applied when it ends. */
  function setExplode(model, k) {
    if (!model || !model.group) return;
    prepare(model);
    const ms = modelState(model);
    ms.explodeK = clamp01(Number.isFinite(k) ? k : 0);
    tweens.delete(model);
    if (installs.has(model)) return;
    applyExplode(model, smoothstep(ms.explodeK));
  }

  // After an install, ease back to the remembered explode amount.
  function restoreExplode(model) {
    const k = modelState(model).explodeK;
    if (k > 0) tweens.set(model, { t: 0, dur: 0.6, to: smoothstep(k) });
  }

  // ---- install sequence
  function stopOne(inst) {
    for (const st of inst.plan) {
      for (const o of st.objects) { const a = o.userData.__anim; if (a) { a.hidden = false; a.drop = 0; applyPose(o); } }
    }
    installs.delete(inst.model);
    applyExplode(inst.model, smoothstep(modelState(inst.model).explodeK));
  }

  function stopInstall(model) {
    if (model) { const inst = installs.get(model); if (inst) stopOne(inst); return; }
    for (const inst of [...installs.values()]) stopOne(inst);
  }

  function playInstall(model, { speed = 1, onStep, onDone } = {}) {
    if (!model || !model.group) return;
    stopInstall(model);
    resetBlowOff(model);
    prepare(model);
    tweens.delete(model);
    applyExplode(model, 0);   // show the real assembly, not the exploded arrangement
    const sp = Number.isFinite(speed) && speed > 0 ? speed : 1;
    const steps = model.installSteps || [];
    let cum = 0;
    const plan = steps.map((step) => {
      const objects = uniq(step.objects || []);
      const n = objects.length;
      const D = Math.min(4, 1.2 + 0.25 * n) / sp;
      const drop = Math.min(DROP_DUR / sp, D * 0.8);
      const stagger = n > 1 ? Math.max(0, Math.min(0.25 / sp, (D - drop - 0.15 / sp) / (n - 1))) : 0;
      const minutes = Number.isFinite(step.minutes) ? step.minutes : 0;
      const entry = { step, objects, D, drop, stagger, minutes, cumMin: cum };
      cum += minutes;
      return entry;
    });
    for (const st of plan) {
      for (const o of st.objects) {
        const a = ensureAnim(o, model.group);
        a.hidden = true; a.drop = DROP_H;
        applyPose(o);
      }
    }
    const inst = { model, plan, i: 0, t: 0, totalMin: cum, onStep, onDone };
    installs.set(model, inst);
    if (plan.length && onStep) onStep(0, plan[0].step, 0, cum);
  }

  function updateInstall(inst, dt) {
    inst.t += dt;
    while (inst.i < inst.plan.length) {
      const st = inst.plan[inst.i];
      const done = inst.t >= st.D;
      st.objects.forEach((o, j) => {
        const a = o.userData.__anim;
        const u = done ? 1 : (inst.t - j * st.stagger) / st.drop;
        a.hidden = u < 0;
        a.drop = u < 0 ? DROP_H : dropOffset(Math.min(1, u));
        applyPose(o);
      });
      const frac = Math.min(1, inst.t / st.D);
      if (inst.onStep) inst.onStep(inst.i, st.step, st.cumMin + st.minutes * frac, inst.totalMin);
      if (!done) return;
      inst.t -= st.D;
      inst.i++;
    }
    installs.delete(inst.model);
    restoreExplode(inst.model);
    if (inst.onDone) inst.onDone();
  }

  function updateTween(model, tw, dt) {
    tw.t += dt;
    const f = smoothstep(tw.t / tw.dur);
    applyExplode(model, tw.to * f);
    if (tw.t >= tw.dur) { applyExplode(model, tw.to); tweens.delete(model); }
  }

  // ---- wind blow-off
  function resetBlowOff(model) {
    if (!model || !model.group) return;
    for (const o of uniq(model.windLoose || [])) {
      const a = o.userData.__anim;
      if (!a || !a.blow) continue;
      a.blow = null;
      flying.delete(o);
      applyPose(o);
    }
  }

  function blowOff(model, { windDirDeg = 270, V = 30 } = {}) {
    if (!model || !model.group) return;
    stopInstall(model);
    resetBlowOff(model);
    const loose = uniq(model.windLoose || []);
    if (!loose.length || !(V > 0)) return;
    prepare(model);
    const group = model.group;

    // Downwind direction (wind FROM windDirDeg, meteorological) in the model-group frame.
    const rad = ((Number.isFinite(windDirDeg) ? windDirDeg : 270) * Math.PI) / 180;
    group.getWorldQuaternion(_q2).invert();
    const downwind = new THREE.Vector3(-Math.sin(rad), 0, Math.cos(rad)).applyQuaternion(_q2);
    downwind.y = 0; downwind.normalize();
    const across = new THREE.Vector3().crossVectors(UP, downwind).normalize();   // tumble axis

    const rand = rng(0x51f1 + loose.length * 131);
    loose.forEach((obj, j) => {
      const a = ensureAnim(obj, group);
      a.hidden = false; a.drop = 0;
      applyPose(obj);                                   // current composed pose (incl. explode)
      // Pose in the group frame.
      _m.compose(obj.position, obj.quaternion, obj.scale);
      if (a.toParent) _m.premultiply(_m2.copy(a.toParent).invert());
      const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3();
      _m.decompose(pos, quat, scale);

      const r = [rand(), rand(), rand(), rand(), rand()];
      const vel = new THREE.Vector3()
        .addScaledVector(downwind, 0.22 * V * (0.8 + 0.4 * r[0]))
        .addScaledVector(UP, 0.17 * V * (0.8 + 0.4 * r[1]));
      const axis = across.clone()
        .addScaledVector(downwind, (r[2] - 0.5) * 0.8)
        .addScaledVector(UP, (r[3] - 0.5) * 0.8).normalize();
      const omega = axis.multiplyScalar(0.09 * V * (0.7 + 0.6 * r[4]) * (r[2] < 0.5 ? -1 : 1));

      a.blow = {
        t: 0,
        delay: FLUTTER + Math.min(0.4, 0.05 * j),
        pos, quat, scale, shrink: 1, visible: a.baseVisible,
        startPos: pos.clone(), startQuat: quat.clone(),
        vel, omega, across: across.clone(),
        wind: downwind.clone().multiplyScalar(0.35 * V),
        toParent: a.toParent,
        box: localBox(obj),
        landed: false, age: 0,
      };
      flying.add(obj);
    });
  }

  function stepBlow(obj, dt) {
    const a = obj.userData.__anim;
    const b = a && a.blow;
    if (!b) { flying.delete(obj); return; }
    b.t += dt;

    if (b.t < b.delay) {
      // flutter: small lift + rocking about the across-wind axis
      const f = b.t / b.delay;
      b.pos.copy(b.startPos).addScaledVector(UP, 0.06 * f * f);
      _q.setFromAxisAngle(b.across, 0.08 * f * Math.sin(b.t * Math.PI * 18));
      b.quat.copy(_q).multiply(b.startQuat);
      writeBlowPose(obj, b);
      return;
    }

    if (!b.landed) {
      b.age += dt;
      // linear drag toward the wind velocity + reduced gravity (sheets glide a little)
      _v.subVectors(b.wind, b.vel).multiplyScalar(0.8 * dt);
      b.vel.add(_v);
      b.vel.y -= GRAVITY * 0.75 * dt;
      b.pos.addScaledVector(b.vel, dt);
      const w = b.omega.length();
      if (w > 1e-6) { _q.setFromAxisAngle(_v.copy(b.omega).divideScalar(w), w * dt); b.quat.premultiply(_q).normalize(); }
      b.omega.multiplyScalar(Math.exp(-0.15 * dt));

      if (lowestY(b.box, b.pos, b.quat, b.scale) <= 0) {
        land(b);
      } else if (b.age > FADE_AFTER) {
        b.shrink = Math.max(0, b.shrink - dt / 0.5);
        if (b.shrink <= 0) { b.visible = false; flying.delete(obj); }
      }
    } else {
      // slide to rest on the ground
      const k = Math.exp(-5 * dt);
      b.vel.x *= k; b.vel.z *= k;
      b.pos.x += b.vel.x * dt; b.pos.z += b.vel.z * dt;
      if (b.vel.x * b.vel.x + b.vel.z * b.vel.z < 1e-4) flying.delete(obj);
    }
    writeBlowPose(obj, b);
  }

  // Lie flat on the ground: keep the heading, top up or upside down depending on how it tumbled.
  function land(b) {
    _q.copy(b.quat).multiply(_q2.copy(b.startQuat).invert());   // rotation relative to the start pose
    const x = _v.set(1, 0, 0).applyQuaternion(_q);
    const yaw = Math.abs(x.y) > 0.99 ? 0 : Math.atan2(-x.z, x.x);
    const flip = _v2.set(0, 1, 0).applyQuaternion(_q).y < 0;
    _q.setFromAxisAngle(UP, yaw);
    if (flip) _q.multiply(_q2.setFromAxisAngle(_v.set(1, 0, 0), Math.PI));
    b.quat.copy(_q).multiply(b.startQuat);
    b.pos.y -= lowestY(b.box, b.pos, b.quat, b.scale) - 0.003;
    b.vel.y = 0;
    b.vel.multiplyScalar(0.5);
    b.omega.set(0, 0, 0);
    b.landed = true;
  }

  // ---- frame update
  function update(dt) {
    dt = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), DT_MAX) : 0;
    for (const inst of [...installs.values()]) updateInstall(inst, dt);
    for (const [model, tw] of [...tweens]) updateTween(model, tw, dt);
    for (const obj of [...flying]) stepBlow(obj, dt);
  }

  function isInstalling(model) { return model ? installs.has(model) : installs.size > 0; }
  function isBlown(model) { return !!model && uniq(model.windLoose || []).some((o) => o.userData.__anim && o.userData.__anim.blow); }
  /** True while anything is moving (lets the caller skip idle overlay refreshes). */
  function busy() { return installs.size > 0 || tweens.size > 0 || flying.size > 0; }

  return { playInstall, stopInstall, setExplode, blowOff, resetBlowOff, update, isInstalling, isBlown, busy };
}
