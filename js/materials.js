// materials.js — shared PBR materials & procedural textures for container and heat-shield designs A, B, C, C′.
import * as THREE from 'three';

const hasDOM = typeof document !== 'undefined';

function canvasTexture(size, draw, repeat = [1, 1], { wrapS = THREE.RepeatWrapping, wrapT = THREE.RepeatWrapping, srgb = false } = {}) {
  if (!hasDOM) return null;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = wrapS;
  t.wrapT = wrapT;
  t.repeat.set(repeat[0], repeat[1]);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function makeNetAlphaTexture(openness = 0.2, repeat = [40, 20]) {
  return canvasTexture(64, (g, s) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#fff';
    const holeSide = Math.sqrt(Math.max(0.02, Math.min(0.9, openness))) * s;
    const thread = (s - holeSide) / 2;
    g.fillRect(0, 0, s, thread); g.fillRect(0, s - thread, s, thread);
    g.fillRect(0, 0, thread, s); g.fillRect(s - thread, 0, thread, s);
  }, repeat);
}

function makeStrapTextures() {
  const strapMap = canvasTexture(128, (g, s) => {
    g.fillStyle = '#eb6b18';
    g.fillRect(0, 0, s, s);
    // Diagonal herringbone/twill webbing ribs
    for (let y = -s; y < s * 2; y += 8) {
      g.strokeStyle = 'rgba(255, 224, 180, 0.14)';
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(0, y); g.lineTo(s * 0.5, y + s * 0.5); g.lineTo(s, y); g.stroke();
      g.strokeStyle = 'rgba(90, 32, 0, 0.18)';
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, y + 4); g.lineTo(s * 0.5, y + 4 + s * 0.5); g.lineTo(s, y + 4); g.stroke();
    }
    // Warp rib stripes
    for (let x = 4; x < s; x += 8) {
      g.fillStyle = x % 16 === 4 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)';
      g.fillRect(x, 0, 2, s);
    }
    // Safety edge lockstitch & black load-rating tracer
    for (const ex of [Math.round(s * 0.08), Math.round(s * 0.92)]) {
      g.fillStyle = '#241810';
      g.fillRect(ex + (ex < s / 2 ? 4 : -6), 0, 2, s);
      g.fillStyle = '#fff2cf';
      for (let y = 2; y < s; y += 8) g.fillRect(ex - 1, y, 2, 5);
    }
  }, [1, 1], { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.RepeatWrapping, srgb: true });

  const strapBump = canvasTexture(128, (g, s) => {
    g.fillStyle = '#808080';
    g.fillRect(0, 0, s, s);
    for (let y = -s; y < s * 2; y += 8) {
      g.strokeStyle = '#b8b8b8';
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(0, y); g.lineTo(s * 0.5, y + s * 0.5); g.lineTo(s, y); g.stroke();
    }
    for (let x = 4; x < s; x += 8) {
      g.fillStyle = '#585858';
      g.fillRect(x, 0, 2, s);
    }
    g.fillStyle = '#ececec';
    for (const ex of [Math.round(s * 0.08), Math.round(s * 0.92)]) {
      for (let y = 2; y < s; y += 8) g.fillRect(ex - 1, y, 3, 5);
    }
  }, [1, 1], { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.RepeatWrapping });

  return { strapMap, strapBump };
}

function makeGalvTexture() {
  return canvasTexture(256, (g, s) => {
    g.fillStyle = '#888888';
    g.fillRect(0, 0, s, s);
    let seed = 0x51a7;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 220; i++) {
      const cx = rnd() * s, cy = rnd() * s, r = 6 + rnd() * 14, sides = 5 + Math.floor(rnd() * 3);
      const shade = Math.round(108 + rnd() * 72);
      g.fillStyle = `rgb(${shade},${shade},${shade})`;
      g.beginPath();
      const rot = rnd() * Math.PI * 2;
      for (let k = 0; k < sides; k++) {
        const a = rot + (k * Math.PI * 2) / sides;
        const rr = r * (0.75 + rnd() * 0.4);
        const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
        if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath();
      g.fill();
    }
    for (let y = 0; y < s; y += 3) {
      g.fillStyle = y % 6 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
      g.fillRect(0, y, s, 1);
    }
  }, [2, 2]);
}

function makeRubberTexture() {
  return canvasTexture(64, (g, s) => {
    g.fillStyle = '#707070';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#b4b4b4';
    for (let x = 0; x < s; x += 8) g.fillRect(x, 0, 4, s);
  }, [3, 3]);
}

export function createMaterials() {
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const { strapMap, strapBump } = makeStrapTextures();
  const galvTex = makeGalvTexture();
  const rubberTex = makeRubberTexture();

  return {
    // --- container (A안 roof matches wall colour family per §10.2 ①)
    containerWall: std({ color: 0xd9d4c7, roughness: 0.72, metalness: 0.16 }),
    containerRoof: std({ color: 0xd5d0c3, roughness: 0.76, metalness: 0.20 }),
    containerFrame: std({ color: 0x4a4f55, roughness: 0.56, metalness: 0.45 }),
    containerTrim: std({ color: 0x2a2e33, roughness: 0.58, metalness: 0.35 }),
    door: std({ color: 0x5c6670, roughness: 0.58, metalness: 0.32 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x9fc3d6, roughness: 0.05, metalness: 0.0, transparent: true, opacity: 0.45 }),
    rubber: std({ color: 0x1c1e22, roughness: 0.90, metalness: 0.02, bumpMap: rubberTex, bumpScale: 0.002 }),

    // --- structural steel / aluminium / spangled zinc
    steelGalv: std({ color: 0xbac0c6, roughness: 0.34, metalness: 0.86, bumpMap: galvTex, bumpScale: 0.0015 }),
    steelInner: std({ color: 0x43484e, roughness: 0.65, metalness: 0.70 }),
    steelDark: std({ color: 0x4e545c, roughness: 0.48, metalness: 0.72 }),
    zinc: std({ color: 0xc5cacf, roughness: 0.30, metalness: 0.90, bumpMap: galvTex, bumpScale: 0.001 }),
    stainless: std({ color: 0xe3e7eb, roughness: 0.20, metalness: 0.92 }),
    aluminum: std({ color: 0xd2d7dc, roughness: 0.30, metalness: 0.90 }),
    aluminumAnod: std({ color: 0x9aa0a6, roughness: 0.38, metalness: 0.82 }),

    // --- heat-shield panel finishes (§4.1, §4.2, §10.2)
    acpWhiteTop: new THREE.MeshPhysicalMaterial({
      color: 0xf8f9fb, roughness: 0.24, metalness: 0.03, clearcoat: 0.45, clearcoatRoughness: 0.18,
    }),
    acpCore: std({ color: 0x23272c, roughness: 0.82, metalness: 0.05 }),
    millAluminum: std({ color: 0xdde2e7, roughness: 0.22, metalness: 0.92 }),
    galvWhiteTop: new THREE.MeshPhysicalMaterial({
      color: 0xf2f3ee, roughness: 0.58, metalness: 0.02, clearcoat: 0.08, clearcoatRoughness: 0.45,
    }),
    galvalumeMill: std({ color: 0xc4cad0, roughness: 0.30, metalness: 0.88, bumpMap: galvTex, bumpScale: 0.0015 }),
    panelEdge: std({ color: 0xb8bcc0, roughness: 0.38, metalness: 0.82 }),

    // Legacy aliases kept for compatibility
    whiteMatte: std({ color: 0xf5f6f7, roughness: 0.65, metalness: 0.02 }),
    silverFoil: std({ color: 0xdbe0e5, roughness: 0.25, metalness: 0.9 }),

    // --- tie-down & fasteners
    strap: std({
      color: strapMap ? 0xffffff : 0xeb6b18,
      map: strapMap,
      bumpMap: strapBump,
      bumpScale: 0.003,
      roughness: 0.72,
      metalness: 0.02,
      side: THREE.DoubleSide,
    }),
    strapStitch: std({ color: 0xf5ebd6, roughness: 0.85, metalness: 0.0 }),
    ratchet: std({ color: 0xd8a022, roughness: 0.26, metalness: 0.86 }),
    cClamp: std({ color: 0x2563a8, roughness: 0.40, metalness: 0.60 }),
    cornerGuard: std({ color: 0x1f2328, roughness: 0.82, metalness: 0.06 }),
    endCap: std({ color: 0x1b1e22, roughness: 0.75, metalness: 0.05 }),
    ghost: std({ color: 0x88ccff, roughness: 1, metalness: 0, transparent: true, opacity: 0.25, depthWrite: false }),
  };
}
