// main.js
// Versión actualizada basada en tu main.js original :contentReference[oaicite:0]{index=0}

// —————————————————————
// 1️⃣ Setup básico y constantes
// —————————————————————
const nodes           = [];
const links           = [];
const nodeMap         = new Map();
let lastProcessed     = -1;

// Parámetros de precarga y degradado
const TOTAL_BLOCKS    = 1000;   // cargaremos 1000 bloques
const BATCH_SIZE      = 200;    // en tandas de 200
let startBlockHeight  = 0;      // bloque más antiguo precargado

// —————————————————————
// 2️⃣ Inicializar ForceGraph3D
// —————————————————————
const Graph = ForceGraph3D()(document.getElementById('graph'))
  .nodeThreeObject(node => {
    const size = 8;
    const geo  = new THREE.BoxGeometry(size, size, size);

    // 2) Bloque anterior al último: rojo puro
    if (node.height === lastProcessed - 1) {
      return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xff0000 }));
    }
    // 3) Resto: degradado rojo→gris según antigüedad
    const age = lastProcessed - node.height;         // 0…TOTAL_BLOCKS
    const t   = Math.min(Math.max(age / TOTAL_BLOCKS, 0), 1);
    const r   = Math.round(255 * (1 - t) + 136 * t);
    const g   = Math.round(  0 * (1 - t) + 136 * t);
    const b   = Math.round(  0 * (1 - t) + 136 * t);
    return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: (r << 16) | (g << 8) | b }));
  })
  .enableNodeDrag(false)
  .linkWidth(2)
  .linkColor(() => 'rgba(255,255,255,1)')
  .onEngineTick(() => {
    const scene = Graph.scene();
    if (!scene.__lit) {
      scene.add(new THREE.AmbientLight(0xffffff, 0.6));
      const dir = new THREE.DirectionalLight(0xffffff, 0.8);
      dir.position.set(0, 50, 50);
      scene.add(dir);
      scene.__lit = true;
    }
  });

// Habilitar rotación/zoom de cámara
Graph.controls().enableRotate = true;
Graph.controls().enableZoom   = false;

// ————————
//  Ajuste de fuerzas para compactar nodos
// ————————
Graph
  .d3Force('charge', d3.forceManyBody().strength(-7))         // menos repulsión entre nodos
  .d3Force('link',   d3.forceLink().distance(15).strength(0.5)); // enlaces más cortos y algo más suaves

// —————————————————————
// 3️⃣ RPC endpoint
// —————————————————————
const RPC_URL = "https://rpc.quai.network/cyprus1";

// —————————————————————
// 4️⃣ Función para procesar un bloque
// —————————————————————
function processBlock(blk, height) {
  if (!blk) return;
  const id      = blk.hash;
  const hdr     = blk.header || {};
  const parents = Array.isArray(hdr.parentHash)
                  ? hdr.parentHash
                  : hdr.parentHash ? [hdr.parentHash] : [];

  if (!nodeMap.has(id)) {
    nodeMap.set(id, { id, height });
    nodes.push(nodeMap.get(id));
  }
  const child = nodeMap.get(id);

  parents.forEach(phash => {
    if (!nodeMap.has(phash)) {
      nodeMap.set(phash, { id: phash, height });
      nodes.push(nodeMap.get(phash));
    }
    const parent = nodeMap.get(phash);
    if (!links.find(l => l.source === parent && l.target === child)) {
      links.push({ source: parent, target: child });
    }
  });
}

// —————————————————————
// 5️⃣ Polling de bloques nuevos
// —————————————————————
async function pollNewBlocks() {
  try {
    const headRes = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "quai_blockNumber",
        params: [],
        id: 1
      })
    });
    const { result: hex } = await headRes.json();
    const latest = parseInt(hex, 16);

    if (latest > lastProcessed) {
      console.log(`🔔 Procesando bloques ${lastProcessed + 1} → ${latest}`);
      for (let n = lastProcessed + 1; n <= latest; n++) {
        const blkRes = await fetch(RPC_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "quai_getBlockByNumber",
            params: ["0x" + n.toString(16), false],
            id: n
          })
        });
        const { result: blk } = await blkRes.json();
        processBlock(blk, n);
      }
      lastProcessed = latest;
      Graph.graphData({ nodes, links });
    }
  } catch (err) {
    console.error("❌ Error al traer bloques nuevos:", err);
  }
}

// —————————————————————
// 6️⃣ Init: preload de bloques
// —————————————————————
;(async function init() {
  // Obtener altura inicial
  const headRes = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "quai_blockNumber",
      params: [],
      id: 1
    })
  });
  const { result: hex } = await headRes.json();
  lastProcessed    = parseInt(hex, 16);
  console.log("🔥 Último bloque inicial:", lastProcessed);

  // Precarga de los últimos TOTAL_BLOCKS en batches de BATCH_SIZE
  startBlockHeight = Math.max(0, lastProcessed - (TOTAL_BLOCKS - 1));
  console.log(`⏳ Precargando bloques ${startBlockHeight} → ${lastProcessed} en batches de ${BATCH_SIZE}`);
  for (let b = startBlockHeight; b <= lastProcessed; b += BATCH_SIZE) {
    const e     = Math.min(lastProcessed, b + BATCH_SIZE - 1);
    const batch = [];
    for (let n = b; n <= e; n++) {
      batch.push({
        jsonrpc: "2.0",
        method: "quai_getBlockByNumber",
        params: ["0x" + n.toString(16), false],
        id: n
      });
    }
    const responses = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batch)
    }).then(r => r.json());

    responses.forEach(r => processBlock(r.result, parseInt(r.id)));

    // Actualizar grafo tras cada batch
    Graph.graphData({ nodes, links });
    console.log(`  • Batch ${b} → ${e} cargado`);
  }
  console.log("✅ Precarga completada");

  // Iniciar polling cada 2s
  await pollNewBlocks();
  setInterval(pollNewBlocks, 2000);
})();












