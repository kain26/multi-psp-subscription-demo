import * as THREE from './vendor/three.module.min.js';

const sphere = new THREE.SphereGeometry(1, 24, 16);
const box = new THREE.BoxGeometry(1, 1, 1);
const cylinder = new THREE.CylinderGeometry(1, 1, 1, 36);
const hexagon = new THREE.CylinderGeometry(1, 1, 1, 6);

export function buildModel(id, color) {
  const model = new THREE.Group();
  const sculpture = new THREE.Group();
  const primary = new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: .11, metalness: .08, roughness: .59,
  });
  const light = new THREE.MeshStandardMaterial({ color: 0xe9e9e5, metalness: .06, roughness: .54 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x38393a, metalness: .05, roughness: .59 });

  function part(geometry, position, scale, material = primary) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.scale.set(...scale);
    sculpture.add(mesh);
    return mesh;
  }
  function ring(radius, thickness, position, material) {
    return part(new THREE.TorusGeometry(radius, thickness, 12, 36), position, [1, 1, 1], material);
  }
  function bar(from, to, radius, material) {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const direction = b.clone().sub(a);
    const piece = part(cylinder, a.lerp(b, .5).toArray(), [radius, direction.length(), radius], material);
    piece.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  }

  const shapes = {
    client() {
      part(sphere, [0, .46, 0], [.24, .26, .23]);
      part(sphere, [0, -.24, 0], [.45, .35, .27]);
      part(cylinder, [0, -.07, 0], [.11, .24, .11]);
    },
    api() {
      part(box, [0, .08, 0], [1.29, .82, .19]);
      part(box, [0, .08, .111], [1.11, .62, .045], dark);
      bar([-.24, .25, .16], [-.43, .08, .16], .035, light);
      bar([-.43, .08, .16], [-.24, -.09, .16], .035, light);
      bar([-.12, -.11, .16], [.06, -.11, .16], .027, light);
      part(box, [0, -.48, 0], [.6, .10, .27], dark);
      part(box, [0, -.36, 0], [.14, .20, .17]);
    },
    router() {
      const hub = part(hexagon, [0, .02, .08], [.29, .19, .29]);
      hub.rotation.x = Math.PI / 2;
      for (const [x, y] of [[-.53, 0], [.52, .36], [.52, -.36]]) {
        bar([0, .02, -.03], [x, y, -.03], .065, light);
        part(sphere, [x, y, -.03], [.13, .13, .13]);
      }
    },
    resilience() {
      const shield = new THREE.Shape();
      shield.moveTo(0, .54);
      shield.lineTo(.46, .35);
      shield.lineTo(.41, -.18);
      shield.quadraticCurveTo(.27, -.42, 0, -.56);
      shield.quadraticCurveTo(-.27, -.42, -.41, -.18);
      shield.lineTo(-.46, .35);
      shield.closePath();
      part(new THREE.ExtrudeGeometry(shield, {
        depth: .13, bevelSize: .025, bevelThickness: .025, bevelSegments: 2,
      }), [0, 0, -.075], [1, 1, 1]);
      bar([.05, .29, .09], [-.14, -.01, .09], .035, dark);
      bar([-.14, -.01, .09], [.075, -.01, .09], .035, dark);
      bar([.075, -.01, .09], [-.055, -.31, .09], .035, dark);
    },
    adapter() {
      ring(.31, .082, [-.27, .08, 0]).rotation.y = -.28;
      ring(.31, .082, [.27, -.06, .06], light).rotation.y = .45;
    },
    psp() {
      part(box, [0, 0, 0], [1.18, .78, .16]);
      part(box, [0, .14, .10], [1.18, .14, .045], dark);
      part(box, [-.33, -.13, .10], [.20, .14, .055], light);
      part(box, [.24, -.18, .10], [.30, .045, .054], light);
    },
    webhook() {
      const hook = part(new THREE.TorusGeometry(.31, .065, 12, 32, 4.45), [0, -.02, 0], [1, 1, 1]);
      hook.rotation.z = -.55;
      part(sphere, [.41, .32, .04], [.13, .13, .13], light);
      part(sphere, [-.42, .3, -.04], [.12, .12, .12]);
      bar([-.42, .3, -.04], [-.28, .13, 0], .065);
    },
    queue() {
      for (const [x, y, z] of [[-.31, -.30, .10], [.21, -.30, .10], [-.055, .18, .10]]) {
        part(box, [x, y, z], [.44, .37, .45]);
        part(box, [x, y + .054, z + .241], [.16, .042, .045], light);
      }
    },
    billing() {
      const coin = part(cylinder, [0, .02, 0], [.45, .20, .45]);
      coin.rotation.x = Math.PI / 2;
      ring(.34, .029, [0, .02, .116], dark);
      bar([-.18, .01, .155], [-.04, -.13, .155], .045, light);
      bar([-.04, -.13, .155], [.20, .16, .155], .045, light);
    },
    store() {
      for (const y of [-.30, -.04, .22]) {
        part(cylinder, [0, y, 0], [.45, .215, .39]);
        ring(.42, .024, [0, y + .075, 0], light).rotation.x = Math.PI / 2;
      }
    },
    reconcile() {
      ring(.35, .072, [-.12, .16, 0]);
      bar([.13, -.10, 0], [.51, -.50, 0], .079);
      bar([-.31, .14, .018], [.02, .14, .018], .029, light);
    },
  };
  shapes[id]();

  const base = new THREE.Mesh(cylinder, new THREE.MeshStandardMaterial({
    color: 0x656669, metalness: .04, roughness: .67,
  }));
  base.position.set(0, -.74, -.06);
  base.scale.set(.63, .09, .54);
  model.add(base, sculpture);
  model.rotation.set(.27, -.36, 0);
  return { model, sculpture, primary };
}
