import * as THREE from "/vendor/three.module.js";
import { OrbitControls } from "/vendor/OrbitControls.js";
import { graph3dEdgeStyle, graph3dMotionSettings, graphDataUnchanged, layoutGraphNodes3D } from "./graph3d-layout.js";
import { clearGraphObjects } from "./graph3d-lifecycle.js";
import { graphRefKey } from "./graph.js";

const NODE_COLORS = {
  memory: "#2563eb",
  candidate: "#9333ea",
  audit_event: "#64748b",
  diagnostic: "#dc2626",
  session: "#0891b2",
  tag: "#ca8a04",
};

function nodeGeometry(kind) {
  if (kind === "candidate") return new THREE.IcosahedronGeometry(8, 0);
  if (kind === "audit_event") return new THREE.BoxGeometry(12, 12, 12);
  if (kind === "diagnostic") return new THREE.TetrahedronGeometry(10);
  if (kind === "session") return new THREE.OctahedronGeometry(10);
  if (kind === "tag") return new THREE.DodecahedronGeometry(9);
  return new THREE.SphereGeometry(8, 12, 8);
}

export function createGraph3DRenderer(container, { onSelect, onError }) {
  const scene = new THREE.Scene();
  const background = getComputedStyle(document.documentElement).getPropertyValue("--bg-secondary").trim();
  scene.background = new THREE.Color(background || "#f5f5f5");
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 3000);
  camera.position.set(0, 0, 640);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  container.replaceChildren(renderer.domElement);
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute("role", "group");
  renderer.domElement.setAttribute("aria-label", "3D Knowledge Graph. Use arrow keys to navigate nodes and Enter to select.");

  const controls = new OrbitControls(camera, renderer.domElement);
  const initialCameraPosition = camera.position.clone();
  const motion = graph3dMotionSettings(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  controls.enableDamping = motion.enableDamping;
  controls.autoRotate = motion.autoRotate;
  controls.rotateSpeed = motion.rotateSpeed;
  controls.enablePan = true;
  controls.enableZoom = true;
  controls.minDistance = 120;
  controls.maxDistance = 1600;
  controls.target.set(0, 0, 0);
  controls.addEventListener("change", render);

  const ambient = new THREE.AmbientLight(0xffffff, 2.2);
  scene.add(ambient);
  const light = new THREE.DirectionalLight(0xffffff, 1.3);
  light.position.set(1, 2, 3);
  scene.add(light);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const tooltip = document.createElement("div");
  tooltip.className = "graph-3d-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  container.append(tooltip);

  let nodeMeshes = [];
  let graphObjects = [];
  let resources = [];
  let nodes = [];
  let graphEdges = [];
  let positions = new Map();
  let selectedKey;
  let hoveredKey;
  let destroyed = false;
  let intersecting = true;
  let dragging = false;
  let pointerStart;

  function isVisible() {
    return intersecting && document.visibilityState !== "hidden" && container.getClientRects().length > 0;
  }

  function render() {
    if (!destroyed && isVisible()) renderer.render(scene, camera);
  }

  function clearGraph() {
    clearGraphObjects(scene, graphObjects, nodeMeshes, resources);
    graphObjects = [];
    nodeMeshes = [];
    resources = [];
    nodes = [];
    graphEdges = [];
  }

  function updateNodeMatrices() {
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    nodeMeshes.forEach(mesh => {
      mesh.userData.graphNodes.forEach((node, index) => {
        const point = positions.get(graphRefKey(node));
        if (!point) return;
        const key = graphRefKey(node);
        const size = key === selectedKey ? 1.65 : key === hoveredKey ? 1.4 : 1;
        position.set(point.x, point.y, point.z);
        rotation.setFromEuler(new THREE.Euler(index * 0.04, index * 0.07, 0));
        scale.setScalar(size);
        matrix.compose(position, rotation, scale);
        mesh.setMatrixAt(index, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    });
  }

  function addGraph(nextNodes, nextEdges) {
    clearGraph();
    nodes = nextNodes;
    graphEdges = nextEdges;
    positions = layoutGraphNodes3D(nodes, graphEdges);
    selectedKey = undefined;
    hoveredKey = undefined;
    const byKind = new Map();
    nodes.forEach(node => {
      const group = byKind.get(node.kind) ?? [];
      group.push(node);
      byKind.set(node.kind, group);
    });
    byKind.forEach((group, kind) => {
      const geometry = nodeGeometry(kind);
      const material = new THREE.MeshStandardMaterial({
        color: NODE_COLORS[kind] ?? "#475569",
        roughness: 0.58,
        metalness: 0.05,
      });
      const mesh = new THREE.InstancedMesh(geometry, material, group.length);
      mesh.userData.graphNodes = group;
      mesh.frustumCulled = false;
      scene.add(mesh);
      nodeMeshes.push(mesh);
      graphObjects.push(mesh);
      resources.push(geometry, material);
    });

    const edgeGroups = new Map();
    graphEdges.forEach(edge => {
      const source = positions.get(graphRefKey(edge.source));
      const target = positions.get(graphRefKey(edge.target));
      if (!source || !target) return;
      const style = graph3dEdgeStyle(edge.origin);
      const group = edgeGroups.get(edge.origin) ?? { style, coordinates: [] };
      group.coordinates.push(source.x, source.y, source.z, target.x, target.y, target.z);
      edgeGroups.set(edge.origin, group);
    });
    edgeGroups.forEach(({ style, coordinates }) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(coordinates, 3));
      const material = style.dashSize
        ? new THREE.LineDashedMaterial({ color: style.color, dashSize: style.dashSize, gapSize: style.gapSize, transparent: true, opacity: 0.88 })
        : new THREE.LineBasicMaterial({ color: style.color, transparent: true, opacity: 0.88 });
      const lines = new THREE.LineSegments(geometry, material);
      if (style.dashSize) lines.computeLineDistances();
      scene.add(lines);
      graphObjects.push(lines);
      resources.push(geometry, material);
    });
  }

  function updateHighlight() {
    updateNodeMatrices();
    render();
  }

  function pickNode(event) {
    const bounds = renderer.domElement.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return undefined;
    pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const intersections = raycaster.intersectObjects(nodeMeshes, false);
    const hit = intersections[0];
    return hit?.object.userData.graphNodes?.[hit.instanceId];
  }

  function select(node) {
    if (!node) return;
    selectedKey = graphRefKey(node);
    updateHighlight();
    onSelect(node);
  }

  function zoomBy(factor) {
    camera.position.sub(controls.target).multiplyScalar(factor).add(controls.target);
    controls.update();
    render();
  }

  function resetView() {
    controls.target.set(0, 0, 0);
    camera.position.copy(initialCameraPosition);
    controls.update();
    render();
  }

  function handlePointerMove(event) {
    const node = pickNode(event);
    const nextKey = node ? graphRefKey(node) : undefined;
    if (nextKey !== hoveredKey) {
      hoveredKey = nextKey;
      tooltip.hidden = !node;
      tooltip.textContent = node ? `${node.kind.replaceAll("_", " ")}: ${node.label}` : "";
      updateHighlight();
    }
    if (node) {
      const bounds = container.getBoundingClientRect();
      tooltip.style.left = `${event.clientX - bounds.left + 12}px`;
      tooltip.style.top = `${event.clientY - bounds.top + 12}px`;
    }
  }

  function handlePointerDown(event) {
    dragging = false;
    pointerStart = { x: event.clientX, y: event.clientY };
  }

  function handlePointerUp(event) {
    if (!pointerStart || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 4) {
      dragging = true;
    }
    if (!dragging && event.button === 0) select(pickNode(event));
    pointerStart = undefined;
  }

  function handleKeyDown(event) {
    if (!nodes.length) return;
    if (event.key === "ArrowRight" || event.key === "ArrowDown" ||
      event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      const currentIndex = nodes.findIndex(node => graphRefKey(node) === selectedKey);
      const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = (currentIndex + direction + nodes.length) % nodes.length;
      select(nodes[nextIndex]);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const current = nodes.find(node => graphRefKey(node) === selectedKey) ?? nodes[0];
      select(current);
    }
  }

  function handleContextLost(event) {
    event.preventDefault();
    onError("The WebGL graphics context was lost. The graph has returned to 2D; select 3D to retry.");
  }

  function handlePointerLeave() {
    hoveredKey = undefined;
    tooltip.hidden = true;
    updateHighlight();
  }

  function handleVisibilityChange() {
    render();
  }

  const resizeObserver = new ResizeObserver(() => {
    const { width, height } = container.getBoundingClientRect();
    if (!width || !height || destroyed) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    render();
  });
  resizeObserver.observe(container);

  const intersectionObserver = typeof IntersectionObserver === "undefined"
    ? undefined
    : new IntersectionObserver(entries => {
        intersecting = Boolean(entries[0]?.isIntersecting);
        render();
      });
  intersectionObserver?.observe(container);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  renderer.domElement.addEventListener("pointermove", handlePointerMove);
  renderer.domElement.addEventListener("pointerdown", handlePointerDown);
  renderer.domElement.addEventListener("pointerup", handlePointerUp);
  renderer.domElement.addEventListener("pointerleave", handlePointerLeave);
  renderer.domElement.addEventListener("keydown", handleKeyDown);
  renderer.domElement.addEventListener("webglcontextlost", handleContextLost);
  const bounds = container.getBoundingClientRect();
  if (bounds.width && bounds.height) {
    camera.aspect = bounds.width / bounds.height;
    camera.updateProjectionMatrix();
    renderer.setSize(bounds.width, bounds.height, false);
  }
  render();

  return {
    update(nextNodes, edges, selected) {
      if (!graphDataUnchanged(nodes, graphEdges, nextNodes, edges)) addGraph(nextNodes, edges);
      selectedKey = selected ? graphRefKey(selected) : undefined;
      updateNodeMatrices();
      render();
    },
    zoomIn() {
      zoomBy(0.82);
    },
    zoomOut() {
      zoomBy(1.22);
    },
    resetView,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      controls.removeEventListener("change", render);
      controls.dispose();
      resizeObserver.disconnect();
      intersectionObserver?.disconnect();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      renderer.domElement.removeEventListener("pointerleave", handlePointerLeave);
      renderer.domElement.removeEventListener("keydown", handleKeyDown);
      renderer.domElement.removeEventListener("webglcontextlost", handleContextLost);
      clearGraph();
      scene.clear();
      renderer.dispose();
      container.replaceChildren();
    },
  };
}
