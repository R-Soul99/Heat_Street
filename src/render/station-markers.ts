/**
 * Proving-ground approach boards: a painted stripe across the road plus a
 * distance number beside it, counting down to each station's corner or
 * take-off (`featureAheadM` metres from the launch pad, along the pad's
 * heading). Purely visual; reads no simulation state.
 */
import * as THREE from "three";
import type { TestStation } from "../debug/test-stations";

/** Metres before the feature, farthest first, with a colour that warms as it nears. */
const BOARDS: readonly { readonly metres: number; readonly color: string }[] = [
  { metres: 150, color: "#e8e8e8" },
  { metres: 100, color: "#ffd447" },
  { metres: 50, color: "#ff8a2b" },
  { metres: 25, color: "#ff3b30" },
];

function numberTexture(text: string, color: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(0, 0, 128, 64);
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, 124, 60);
    ctx.fillStyle = color;
    ctx.font = "bold 40px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${text} m`, 64, 34);
  }
  return new THREE.CanvasTexture(canvas);
}

export function createStationMarkers(stations: readonly TestStation[]): THREE.Group {
  const group = new THREE.Group();
  group.name = "station-markers";
  const stripeGeometry = new THREE.PlaneGeometry(1.4, 1);
  stripeGeometry.rotateX(-Math.PI / 2);
  for (const station of stations) {
    if (station.featureAheadM <= 0) continue;
    // Heading east (+x): the left roadside is -z.
    const side = station.widthM / 2 + 6;
    for (const board of BOARDS) {
      if (board.metres >= station.featureAheadM) continue;
      const x = station.x + (station.featureAheadM - board.metres);
      const stripe = new THREE.Mesh(
        stripeGeometry,
        new THREE.MeshBasicMaterial({
          color: board.color,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      );
      stripe.scale.set(1, 1, station.widthM);
      stripe.position.set(x, 0.05, station.z);
      group.add(stripe);
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: numberTexture(String(board.metres), board.color),
          depthWrite: false,
        }),
      );
      sprite.scale.set(10, 5, 1);
      sprite.position.set(x, 3, station.z - side);
      group.add(sprite);
    }
  }
  return group;
}
