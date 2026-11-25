// animator.js — exploded view, step-by-step install AND disassemble playback for a DesignModel.
// DOM-free. Per-object state lives in obj.userData.__anim; per-model state in model.group.userData.__anim.
//
// Optional per-object hints (userData): dropH (m, default 2.4) and dropEase ('back' | 'smooth').
// Optional per-step fields: holdSec (minimum step duration), dropSec (per-object move duration).
// Optional model.disassembleSteps = [{ title, minutes, objects, reveal, holdSec, dropSec }]: a custom teardown.
//   `objects` lift away; `reveal` objects (e.g. B's drill holes left in the roof) appear during that step and
//   stay visible until the model is restored or installed again. Without it, teardown = reversed install.
import * as THREE from 'three';

const DROP_H = 2.4;          // install/disassemble lift height (m)
const DROP_DUR = 0.72;       // seconds per object move (at speed 1)
const REVEAL_STAGGER = 0.22; // seconds between revealed objects of one step
const DT_MAX = 0.05;
const UP = new THREE.Vector3(0, 1, 0);

const clamp01 = (k) => (k < 0 ? 0 : k > 1 ? 1 : k);
const smoothstep = (k) => { k = clamp01(k); return k * k * (3 - 2 * k); };

function dropOffset(u, H = DROP_H, ease = 'back') {
  if (u <= 0) return H;
  if (u >= 1) return 0;
  if (ease === 'smooth') return H * (1 - smoothstep(u));
  const c1 = 1.70158, c3 = c1 + 1, w = u - 1;
  const back = 1 + c3 * w * w * w + c1 * w * w;
  const off = H * (1 - back);
  return off < 0 ? off * 0.14 : off;
}

function liftOffset(u, H = DROP_H) {
  if (u <= 0) return 0;
  if (u >= 1) return H;
  return H * smoothstep(u);
}

function vec3Of(e) {
  if (!e) return new THREE.Vector3();
  if (e.isVector3) return e.clone();
  if (Array.isArray(e)) return new THREE.Vector3(e[0] || 0, e[1] || 0, e[2] || 0);
  return new THREE.Vector3(e.x || 0, e.y || 0, e.z || 0);
}

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
  const h = Number(obj.userData.dropH);
  a = {
    group,
    basePos: obj.position.clone(),
    baseQuat: obj.quaternion.clone(),
    baseScale: obj.scale.clone(),
    baseVisible: obj.visible,
    toParent,
    explodeLocal: explode,
    upLocal: up,
    dropH: Number.isFinite(h) && h > 0 ? h : DROP_H,
    ease: obj.userData.dropEase === 'smooth' ? 'smooth' : 'back',
    explodeE: 0,
    drop: 0,
    hidden: false,
  };
  obj.userData.__anim = a;
  return a;
}

function applyPose(obj) {
  const a = obj.userData.__anim;
  if (!a) return;
  obj.position.copy(a.basePos);
  if (a.explodeE !== 0) obj.position.addScaledVector(a.explodeLocal, a.explodeE);
  if (a.drop !== 0) obj.position.addScaledVector(a.upLocal, a.drop);
  obj.quaternion.copy(a.baseQuat);
  obj.scale.copy(a.baseScale);
  obj.visible = a.baseVisible && !a.hidden;
}

function modelState(model) {
  const u = model.group.userData;
  if (!u.__anim) u.__anim = { explodeK: 0 };
  return u.__anim;
}

function uniq(list) { return [...new Set((list || []).filter((o) => o && o.isObject3D))]; }

function explodeObjects(model) {
  const out = [];
  for (const p of model.parts || []) out.push(...(p.objects || []));
  for (const s of model.installSteps || []) out.push(...(s.objects || []));
  return uniq(out);
}

/** Teardown sequence of a model: its custom disassembleSteps, or the install steps in reverse. */
export function disassemblySequence(model) {
  const custom = model && Array.isArray(model.disassembleSteps) ? model.disassembleSteps : null;
  if (custom && custom.length) return custom.map((s) => ({ ...s }));
  return [...(model?.installSteps || [])].reverse().map((s) => ({ ...s, title: `해체 · ${s.title}` }));
}

/** Objects that only exist after teardown (shown by `reveal`), e.g. B's drill holes. */
export function revealObjects(model) {
  const out = [];
  for (const s of model?.disassembleSteps || []) out.push(...(s.reveal || []));
  return uniq(out);
}

function setRevealed(model, on) { for (const o of revealObjects(model)) o.visible = !!on; }

export function createAnimator() {
  const playbacks = new Map(); // model -> active install or disassemble playback
  const tweens = new Map();    // model -> explode tween

  function prepare(model) {
    const g = model.group;
    g.updateWorldMatrix(true, true);
    for (const o of explodeObjects(model)) ensureAnim(o, g);
  }

  function applyExplode(model, e) {
    for (const obj of explodeObjects(model)) {
      const a = ensureAnim(obj, model.group);
      a.explodeE = e;
      applyPose(obj);
    }
  }

  function setExplode(model, k) {
    if (!model || !model.group) return;
    prepare(model);
    const ms = modelState(model);
    ms.explodeK = clamp01(Number.isFinite(k) ? k : 0);
    tweens.delete(model);
    if (playbacks.has(model)) return;
    applyExplode(model, smoothstep(ms.explodeK));
  }

  function restoreExplode(model) {
    const k = modelState(model).explodeK;
    if (k > 0) tweens.set(model, { t: 0, dur: 0.6, to: smoothstep(k) });
  }

  function restoreAssembled(model) {
    if (!model || !model.group) return;
    playbacks.delete(model);
    prepare(model);
    for (const o of explodeObjects(model)) {
      const a = o.userData.__anim;
      if (a) { a.hidden = false; a.drop = 0; applyPose(o); }
    }
    setRevealed(model, false);
    applyExplode(model, smoothstep(modelState(model).explodeK));
  }

  function stopOne(pb) {
    for (const st of pb.plan) {
      for (const o of st.objects) {
        const a = o.userData.__anim;
        if (!a) continue;
        if (pb.mode === 'disassemble') {
          a.hidden = true;
          a.drop = a.dropH;
        } else {
          a.hidden = false;
          a.drop = 0;
        }
        applyPose(o);
      }
      if (pb.mode === 'disassemble') for (const o of st.reveal) o.visible = true;
    }
    if (pb.mode === 'install') setRevealed(pb.model, false);
    playbacks.delete(pb.model);
    if (pb.mode === 'install') applyExplode(pb.model, smoothstep(modelState(pb.model).explodeK));
  }

  function stopInstall(model) {
    if (model) { const pb = playbacks.get(model); if (pb) stopOne(pb); return; }
    for (const pb of [...playbacks.values()]) stopOne(pb);
  }

  function buildPlan(steps, sp) {
    let cum = 0;
    return steps.map((step) => {
      const objects = uniq(step.objects || []);
      const reveal = uniq(step.reveal || []);
      const n = objects.length;
      const hold = Number.isFinite(step.holdSec) && step.holdSec > 0 ? step.holdSec / sp : 0;
      const D = Math.max(hold, Math.min(3.5, 1.1 + 0.14 * n) / sp);
      const moveSec = Number.isFinite(step.dropSec) && step.dropSec > 0 ? step.dropSec : DROP_DUR;
      const drop = Math.min(moveSec / sp, D * 0.8);
      const stagger = n > 1 ? Math.max(0, Math.min(0.18 / sp, (D - drop - 0.12 / sp) / (n - 1))) : 0;
      const minutes = Number.isFinite(step.minutes) ? step.minutes : 0;
      const entry = { step, objects, reveal, D, drop, stagger, revStagger: REVEAL_STAGGER / sp, minutes, cumMin: cum };
      cum += minutes;
      return entry;
    });
  }

  function playInstall(model, { speed = 1, onStep, onDone } = {}) {
    if (!model || !model.group) return;
    playbacks.delete(model);
    prepare(model);
    tweens.delete(model);
    applyExplode(model, 0);
    setRevealed(model, false);
    const sp = Number.isFinite(speed) && speed > 0 ? speed : 1;
    const plan = buildPlan(model.installSteps || [], sp);
    const totalMin = plan.reduce((a, s) => a + s.minutes, 0);

    for (const st of plan) {
      for (const o of st.objects) {
        const a = ensureAnim(o, model.group);
        a.hidden = true; a.drop = a.dropH;
        applyPose(o);
      }
    }
    const pb = { mode: 'install', model, plan, i: 0, t: 0, totalMin, onStep, onDone };
    playbacks.set(model, pb);
    if (plan.length && onStep) onStep(0, plan[0].step, 0, totalMin);
  }

  /** Step-by-step disassembly (§10.4 ③): custom model.disassembleSteps or the reversed install sequence. */
  function playDisassemble(model, { speed = 1, onStep, onDone } = {}) {
    if (!model || !model.group) return;
    playbacks.delete(model);
    prepare(model);
    tweens.delete(model);
    applyExplode(model, 0);
    const sp = Number.isFinite(speed) && speed > 0 ? speed : 1;
    const plan = buildPlan(disassemblySequence(model), sp);
    const totalMin = plan.reduce((a, s) => a + s.minutes, 0);

    for (const st of plan) {
      for (const o of st.objects) {
        const a = ensureAnim(o, model.group);
        a.hidden = false; a.drop = 0;
        applyPose(o);
      }
    }
    setRevealed(model, false);
    const pb = { mode: 'disassemble', model, plan, i: 0, t: 0, totalMin, onStep, onDone };
    playbacks.set(model, pb);
    if (plan.length && onStep) onStep(0, plan[0].step, 0, totalMin);
  }

  function updatePlayback(pb, dt) {
    pb.t += dt;
    while (pb.i < pb.plan.length) {
      const st = pb.plan[pb.i];
      const done = pb.t >= st.D;
      st.objects.forEach((o, j) => {
        const a = o.userData.__anim;
        const u = done ? 1 : (pb.t - j * st.stagger) / st.drop;
        if (pb.mode === 'install') {
          a.hidden = u < 0;
          a.drop = u < 0 ? a.dropH : dropOffset(Math.min(1, u), a.dropH, a.ease);
        } else {
          a.hidden = u >= 1;
          a.drop = u <= 0 ? 0 : liftOffset(Math.min(1, u), a.dropH);
        }
        applyPose(o);
      });
      if (pb.mode === 'disassemble') st.reveal.forEach((o, j) => { o.visible = done || pb.t >= j * st.revStagger; });
      const frac = Math.min(1, pb.t / st.D);
      if (pb.onStep) pb.onStep(pb.i, st.step, st.cumMin + st.minutes * frac, pb.totalMin);
      if (!done) return;
      pb.t -= st.D;
      pb.i++;
    }
    playbacks.delete(pb.model);
    if (pb.mode === 'install') restoreExplode(pb.model);
    if (pb.onDone) pb.onDone();
  }

  function updateTween(model, tw, dt) {
    tw.t += dt;
    const f = smoothstep(tw.t / tw.dur);
    applyExplode(model, tw.to * f);
    if (tw.t >= tw.dur) { applyExplode(model, tw.to); tweens.delete(model); }
  }

  function update(dt) {
    dt = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), DT_MAX) : 0;
    for (const pb of [...playbacks.values()]) updatePlayback(pb, dt);
    for (const [model, tw] of [...tweens]) updateTween(model, tw, dt);
  }

  function isInstalling(model) {
    if (model) return playbacks.get(model)?.mode === 'install';
    for (const pb of playbacks.values()) if (pb.mode === 'install') return true;
    return false;
  }

  function isAnimating(model) { return model ? playbacks.has(model) : playbacks.size > 0; }
  function resetBlowOff() {}
  function busy() { return playbacks.size > 0 || tweens.size > 0; }

  return {
    playInstall, playDisassemble, stopInstall, restoreAssembled,
    setExplode, resetBlowOff, update, isInstalling, isAnimating, busy,
  };
}
