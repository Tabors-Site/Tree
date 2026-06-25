// TreeOS Portal — explorer model thumbnails.
//
// A real preview for matter whose content IS a 3D model (a .glb in the
// /skins catalog, an avatar, a prop). One shared Three.js renderer
// blits into each tile's 2D canvas, so N model tiles cost ONE WebGL
// context, not N. Only on-screen models load (IntersectionObserver) and
// only on-screen models rotate, so a folder of models stays cheap.
//
// Heavy: pulls Three.js + GLTFLoader. The explorer imports this module
// lazily, the first time a model tile actually needs it, so a text-first
// session that never opens a folder of models never pays for it.

const THUMB_W = 118;
const THUMB_H = 82;

let shared = null;

async function ensureShared() {
  if (shared) return shared;
  const THREE = await import("three");
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const { DRACOLoader } = await import("three/examples/jsm/loaders/DRACOLoader.js");

  // Same loader wiring as the 3D view (assetResolver.js): DRACO-compressed
  // glTFs (the standard size-reduction step for downloaded models) need
  // the decoder, fetched from gstatic so no decoder bytes bundle here.
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath("https://www.gstatic.com/draco/v1/decoders/");
  loader.setDRACOLoader(draco);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(THUMB_W, THUMB_H);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.95));
  const key = new THREE.DirectionalLight(0xffffff, 1.15);
  key.position.set(2.5, 3.5, 4);
  scene.add(key);

  const camera = new THREE.PerspectiveCamera(34, THUMB_W / THUMB_H, 0.01, 100);
  camera.position.set(0, 0.45, 3);
  camera.lookAt(0, 0, 0);

  shared = {
    THREE, loader,
    renderer, scene, camera,
    items: new Set(),
    raf: null,
    io: new IntersectionObserver(onIntersect, { threshold: 0.05 }),
    byCanvas: new Map(),
  };
  return shared;
}

function onIntersect(entries) {
  if (!shared) return;
  for (const e of entries) {
    const item = shared.byCanvas.get(e.target);
    if (!item) continue;
    item.visible = e.isIntersecting;
    if (item.visible && !item.loaded && !item.loading) loadItem(item);
  }
  startLoop();
}

async function loadItem(item) {
  item.loading = true;
  try {
    const gltf = await shared.loader.loadAsync(item.url);
    if (!item.alive) { disposeObject(gltf.scene); return; }
    const { THREE } = shared;
    const model = gltf.scene;
    // Center + scale to fit a ~1.6 unit box so any model frames the same.
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    model.position.sub(center);
    const holder = new THREE.Group();
    holder.add(model);
    holder.scale.setScalar(1.6 / maxDim);
    item.root = holder;
    item.loaded = true;
    startLoop();
  } catch {
    // Leave the icon fallback the caller already drew.
    item.failed = true;
  } finally {
    item.loading = false;
  }
}

function startLoop() {
  if (!shared || shared.raf) return;
  const tick = () => {
    if (!shared) return;
    const live = [...shared.items].filter((it) => it.alive && it.visible && it.loaded && it.root);
    if (!live.length) { shared.raf = null; return; }
    shared.raf = requestAnimationFrame(tick);
    for (const it of live) {
      it.root.rotation.y += 0.012;
      shared.scene.add(it.root);
      shared.renderer.render(shared.scene, shared.camera);
      shared.scene.remove(it.root);
      const ctx = it.canvas.getContext("2d");
      if (!ctx) continue;
      ctx.clearRect(0, 0, it.canvas.width, it.canvas.height);
      ctx.drawImage(shared.renderer.domElement, 0, 0, it.canvas.width, it.canvas.height);
    }
  };
  shared.raf = requestAnimationFrame(tick);
}

function disposeObject(obj) {
  obj?.traverse?.((n) => {
    if (n.geometry) n.geometry.dispose?.();
    const mats = Array.isArray(n.material) ? n.material : (n.material ? [n.material] : []);
    for (const m of mats) {
      for (const k in m) { if (m[k]?.isTexture) m[k].dispose?.(); }
      m.dispose?.();
    }
  });
}

function disposeItem(item) {
  if (item.root) { disposeObject(item.root); item.root = null; }
}

// Mount a rotating thumbnail of `url` into `canvas`. Returns a teardown.
// Falls back silently (caller keeps its icon) if WebGL or the load fails.
export async function mountModelThumb(canvas, url) {
  let s;
  try { s = await ensureShared(); }
  catch { return () => {}; }
  const item = { canvas, url, alive: true, visible: false, loaded: false, loading: false, root: null };
  s.items.add(item);
  s.byCanvas.set(canvas, item);
  s.io.observe(canvas);
  return () => {
    item.alive = false;
    try { s.io.unobserve(canvas); } catch {}
    s.byCanvas.delete(canvas);
    s.items.delete(item);
    disposeItem(item);
  };
}
