// materials.js — one shared material palette so every module looks consistent.
// createMaterials() is called ONCE by main.js and passed to every builder as `mats`.
// Safe to import in Node (textures are only generated when `document` exists).
import * as THREE from 'three';

const hasDOM = typeof document !== 'undefined';

function canvasTexture(size, draw, repeat = [1, 1]) {
  if (!hasDOM) return null;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  return t;
}

// Knitted shade-net alpha map: white = solid thread, black = hole.
export function makeNetAlphaTexture(openness = 0.2, repeat = [40, 20]) {
  return canvasTexture(64, (g, s) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#fff';
    // thread width chosen so that hole fraction ≈ openness
    const holeSide = Math.sqrt(Math.max(0.02, Math.min(0.9, openness))) * s;
    const thread = (s - holeSide) / 2;
    g.fillRect(0, 0, s, thread); g.fillRect(0, s - thread, s, thread);
    g.fillRect(0, 0, thread, s); g.fillRect(s - thread, 0, thread, s);
    // diagonal knit strands
    g.strokeStyle = '#fff'; g.lineWidth = s * 0.06;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(s, s); g.stroke();
  }, repeat);
}

export function createMaterials() {
  const std = (o) => new THREE.MeshStandardMaterial(o);

  const m = {
    // --- container
    containerWall: std({ color: 0xd9d4c7, roughness: 0.75, metalness: 0.15 }),   // ivory painted panels
    containerRoof: std({ color: 0x8e8a82, roughness: 0.85, metalness: 0.25 }),   // weathered grey 1.2T steel
    containerFrame: std({ color: 0x4a4f55, roughness: 0.6, metalness: 0.4 }),    // corner posts, top tube
    containerTrim: std({ color: 0x2f3338, roughness: 0.6, metalness: 0.3 }),
    liftingRing: std({ color: 0xc9a227, roughness: 0.5, metalness: 0.6 }),       // yellow-painted lug
    door: std({ color: 0x5c6670, roughness: 0.6, metalness: 0.3 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x9fc3d6, roughness: 0.05, metalness: 0.0, transmission: 0.0, transparent: true, opacity: 0.45 }),
    rubber: std({ color: 0x1c1c1e, roughness: 0.95, metalness: 0.0 }),

    // --- structural steel / aluminium
    steelGalv: std({ color: 0xa7adb2, roughness: 0.45, metalness: 0.85 }),       // scaffold pipe φ48.6
    steelDark: std({ color: 0x5a6068, roughness: 0.5, metalness: 0.7 }),         // brackets, bolts
    zinc: std({ color: 0xb9bec2, roughness: 0.35, metalness: 0.9 }),              // clamps, U-bolts
    aluminum: std({ color: 0xc6cbd0, roughness: 0.32, metalness: 0.9 }),          // rails, frames
    aluminumAnod: std({ color: 0x9aa0a6, roughness: 0.4, metalness: 0.8 }),

    // --- heat-shield surfaces (the stars of the show)
    whiteMatte: std({ color: 0xf3f2ec, roughness: 0.92, metalness: 0.0 }),        // 무광 백색 차열도장
    silverFoil: std({ color: 0xe6e8ea, roughness: 0.22, metalness: 1.0 }),        // 은박 하면
    panelEdge: std({ color: 0xb8bcc0, roughness: 0.4, metalness: 0.8 }),

    // --- soft goods
    strap: std({ color: 0xe8742a, roughness: 0.8, metalness: 0.0, side: THREE.DoubleSide }),  // ratchet strap
    ratchet: std({ color: 0x3a3f45, roughness: 0.4, metalness: 0.8 }),
    bungee: std({ color: 0x1f3c88, roughness: 0.7, metalness: 0.0 }),
    guyLine: std({ color: 0xf2b134, roughness: 0.7, metalness: 0.0 }),
    velcro: std({ color: 0x151515, roughness: 1.0, metalness: 0.0 }),               // Dual Lock pads
    camLever: std({ color: 0xd8452b, roughness: 0.5, metalness: 0.3 }),

    // Aluminet shade net: metallic, alpha-mapped knit, double sided.
    net: new THREE.MeshStandardMaterial({
      color: 0xdfe3e6, roughness: 0.35, metalness: 0.85, side: THREE.DoubleSide,
      transparent: true, alphaTest: 0.5, alphaMap: makeNetAlphaTexture(0.2),
    }),

    // --- helpers / annotation
    ghost: std({ color: 0x88ccff, roughness: 1, metalness: 0, transparent: true, opacity: 0.25, depthWrite: false }),
  };
  return m;
}
