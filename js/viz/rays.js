// rays.js — sun-ray arrows like the source document figures: amber incoming rays hitting the
// top surfaces, plus what happens next:
//   * mirror-like surface (metallic, glossy) → one mirrored ray (lighter amber, 50 % opacity)
//   * matte surface (e.g. matte-white top)   → diffuse scatter fan of 3 short rays around the normal
//                                              (dimmer when the surface is dark, e.g. the bare roof)
//   * shade net (transmittance > 0 / alpha-mapped) → no reflection; a faint transmitted ray continues to the roof
// DOM-free. `group` may be added anywhere (scene or unit root): positions are converted from world space.
import * as THREE from 'three';
import { CONTAINER } from '../config.js';

const N_SAMPLES = 7;
const IN_LEN = 6.0;        // incoming ray length (m)
const MIRROR_LEN = 2.4;
const FAN_LEN = 1.1;
const FAN_ANGLE = THREE.MathUtils.degToRad(40);
const AMBER = 0xf2a21b;
const AMBER_LIGHT = 0xf8c86a;
const UP = new THREE.Vector3(0, 1, 0);

// Batch of arrows (shaft + cone head) drawn with two InstancedMeshes sharing one material.
class ArrowBatch {
  constructor(material, capacity, shaftGeo, headGeo, parent) {
    this.capacity = capacity;
    this.n = 0;
    this.shaft = new THREE.InstancedMesh(shaftGeo, material, capacity);
    this.head = new THREE.InstancedMesh(headGeo, material, capacity);
    for (const m of [this.shaft, this.head]) {
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = m.receiveShadow = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.raycast = () => {};
      parent.add(m);
    }
  }
  begin() { this.n = 0; }
  /** Arrow from a to b (both in the batch's local frame), shaft radius r. */
  add(a, b, r) {
    if (this.n >= this.capacity) return;
    _d.subVectors(b, a);
    const len = _d.length();
    if (len < 1e-4) return;
    _d.divideScalar(len);
    const headLen = Math.min(len * 0.35, r * 9);
    const shaftLen = len - headLen;
    _q.setFromUnitVectors(UP, _d);
    _p.copy(a).addScaledVector(_d, shaftLen / 2);
    _s.set(r, shaftLen, r);
    this.shaft.setMatrixAt(this.n, _m.compose(_p, _q, _s));
    _p.copy(b).addScaledVector(_d, -headLen / 2);
    _s.set(r * 2.8, headLen, r * 2.8);
    this.head.setMatrixAt(this.n, _m.compose(_p, _q, _s));
    this.n++;
  }
  end() {
    this.shaft.count = this.head.count = this.n;
    this.shaft.instanceMatrix.needsUpdate = true;
    this.head.instanceMatrix.needsUpdate = true;
  }
}

const _d = new THREE.Vector3(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4();

function basicMat(color, opacity) {
  return new THREE.MeshBasicMaterial({
    color, toneMapped: false,
    transparent: opacity < 1, opacity, depthWrite: opacity >= 1,
  });
}

// Linear-space luminance of a material colour (≈ albedo proxy).
function albedo(mat) {
  const c = mat && mat.color;
  return c ? 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b : 0.5;
}

export function createSunRays() {
  const group = new THREE.Group();
  group.name = 'sunRays';
  const root = new THREE.Group();   // hidden at night independently of setVisible()
  group.add(root);

  const shaftGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
  const headGeo = new THREE.ConeGeometry(1, 1, 12, 1);
  const matIn = basicMat(AMBER, 1);
  const matOut = basicMat(AMBER_LIGHT, 0.5);
  const matDim = basicMat(AMBER_LIGHT, 0.22);
  const matTrans = basicMat(AMBER, 0.35);
  const inB = new ArrowBatch(matIn, N_SAMPLES, shaftGeo, headGeo, root);
  const outB = new ArrowBatch(matOut, N_SAMPLES * 3, shaftGeo, headGeo, root);
  const dimB = new ArrowBatch(matDim, N_SAMPLES * 3, shaftGeo, headGeo, root);
  const transB = new ArrowBatch(matTrans, N_SAMPLES, shaftGeo, headGeo, root);
  const batches = [inB, outB, dimB, transB];

  const raycaster = new THREE.Raycaster();
  const hits = [];
  const sun = new THREE.Vector3(), down = new THREE.Vector3();
  const toGroup = new THREE.Matrix4(), toLocal = new THREE.Matrix4();
  const box = new THREE.Box3(), tmpBox = new THREE.Box3();
  const P = new THREE.Vector3(), O = new THREE.Vector3(), H = new THREE.Vector3(), N = new THREE.Vector3();
  const T = new THREE.Vector3(), R = new THREE.Vector3(), A = new THREE.Vector3(), B = new THREE.Vector3();
  const unitUp = new THREE.Vector3();
  const normalMat = new THREE.Matrix3();

  // world → group-local
  const G = (v, out) => out.copy(v).applyMatrix4(toGroup);

  function hide() { root.visible = false; }

  /**
   * sunDir: world unit vector toward the sun; unitRoot: container-local frame;
   * targets: Mesh[] (design.topSurfaces or [container.roofMesh]); elevationDeg: sun elevation.
   */
  function update(sunDir, unitRoot, targets, elevationDeg) {
    if (!sunDir || !unitRoot) return hide();
    sun.set(sunDir.x, sunDir.y, sunDir.z);
    const elevOk = Number.isFinite(elevationDeg) ? elevationDeg > 0 : sun.y > 0;
    if (!elevOk || !(sun.lengthSq() > 0)) return hide();
    sun.normalize();
    down.copy(sun).negate();
    root.visible = true;

    unitRoot.updateWorldMatrix(true, true);
    group.updateWorldMatrix(true, false);
    toGroup.copy(group.matrixWorld).invert();
    toLocal.copy(unitRoot.matrixWorld).invert();
    unitUp.set(0, 1, 0).transformDirection(unitRoot.matrixWorld);

    const list = (targets || []).filter((t) => t && t.isMesh);
    // Sample footprint: targets' bounds in unit-local coords, else the roof rectangle.
    box.makeEmpty();
    for (const t of list) { t.updateWorldMatrix(true, false); tmpBox.setFromObject(t); box.union(tmpBox); }
    if (!box.isEmpty()) box.applyMatrix4(toLocal);
    const RR = CONTAINER.roofRect;
    const x0 = box.isEmpty() ? RR.x0 : box.min.x, x1 = box.isEmpty() ? RR.x1 : box.max.x;
    const z0 = box.isEmpty() ? RR.z0 : box.min.z, z1 = box.isEmpty() ? RR.z1 : box.max.z;
    const top = box.isEmpty() ? RR.y : box.max.y;
    const mx = (x1 - x0) * 0.08, mz = (z1 - z0) * 0.2;

    for (const b of batches) b.begin();
    let netTau = 0;

    for (let s = 0; s < N_SAMPLES; s++) {
      // evenly spaced along the long axis, zig-zag across the width
      const fx = (s + 0.5) / N_SAMPLES;
      const fz = s % 2 ? 0.72 : 0.28;
      P.set(x0 + mx + fx * (x1 - x0 - 2 * mx), top + 0.02, z0 + mz + fz * (z1 - z0 - 2 * mz)).applyMatrix4(unitRoot.matrixWorld);
      O.copy(P).addScaledVector(sun, 30);

      let hitObj = null, face = null;
      if (list.length) {
        raycaster.set(O, down);
        hits.length = 0;
        raycaster.intersectObjects(list, false, hits);
        const h = hits[0];
        if (!h) continue;
        H.copy(h.point);
        hitObj = h.object; face = h.face;
        if (face) {
          normalMat.getNormalMatrix(hitObj.matrixWorld);
          N.copy(face.normal).applyMatrix3(normalMat).normalize();
        } else N.copy(unitUp);
      } else {
        // analytic roof plane (baseline without a roof mesh)
        A.copy(O).applyMatrix4(toLocal);
        B.copy(down).transformDirection(toLocal);
        if (B.y >= -1e-6) continue;
        A.addScaledVector(B, (RR.y - A.y) / B.y);
        H.copy(A).applyMatrix4(unitRoot.matrixWorld);
        N.copy(unitUp);
      }
      if (N.dot(sun) < 0) N.negate();                      // double-sided hit from above
      // Smooth corrugation facets toward the panel's overall normal for a readable picture.
      if (N.dot(unitUp) > 0.3) N.addScaledVector(unitUp, 1.5).normalize();

      // incoming ray
      inB.add(G(A.copy(H).addScaledVector(sun, IN_LEN), A), G(H, B), 0.02);

      const mats = hitObj ? hitObj.material : null;
      const mat = Array.isArray(mats) ? mats[face && face.materialIndex !== undefined ? face.materialIndex : 0] : mats;
      const tau = hitObj && Number.isFinite(hitObj.userData.transmittance) ? hitObj.userData.transmittance : 0;
      const isNet = tau > 0 || (mat && (mat.alphaTest > 0 || !!mat.alphaMap));

      if (isNet) {
        // transmitted part continues down to the roof plate
        netTau = Math.max(netTau, tau);
        A.copy(H).applyMatrix4(toLocal);
        B.copy(down).transformDirection(toLocal);
        if (B.y < -1e-6) {
          A.addScaledVector(B, (RR.y + 0.01 - A.y) / B.y).applyMatrix4(unitRoot.matrixWorld);
          transB.add(G(H, T), G(A, R), 0.009);
        }
        continue;
      }
      const glossy = mat && mat.metalness >= 0.6 && mat.roughness <= 0.4;
      if (glossy) {
        // mirror: r = d − 2(d·n)n with d = −sun
        R.copy(down).addScaledVector(N, -2 * down.dot(N)).normalize();
        outB.add(G(H, A), G(B.copy(H).addScaledVector(R, MIRROR_LEN), B), 0.013);
      } else {
        // diffuse fan in the plane of incidence: normal ±40°
        const batch = albedo(mat) > 0.45 ? outB : dimB;
        T.copy(sun).addScaledVector(N, -sun.dot(N));
        if (T.lengthSq() < 1e-8) T.set(1, 0, 0).addScaledVector(N, -N.x);
        T.normalize();
        const c = Math.cos(FAN_ANGLE), sn = Math.sin(FAN_ANGLE);
        G(H, A);
        batch.add(A, G(B.copy(H).addScaledVector(N, FAN_LEN), B), 0.011);
        R.copy(N).multiplyScalar(c).addScaledVector(T, sn);
        batch.add(A, G(B.copy(H).addScaledVector(R, FAN_LEN * 0.8), B), 0.009);
        R.copy(N).multiplyScalar(c).addScaledVector(T, -sn);
        batch.add(A, G(B.copy(H).addScaledVector(R, FAN_LEN * 0.8), B), 0.009);
      }
    }
    matTrans.opacity = 0.2 + 0.6 * Math.min(1, netTau);
    for (const b of batches) b.end();
  }

  function setVisible(v) { group.visible = !!v; }

  return { group, update, setVisible };
}
