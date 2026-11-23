// Pure drive-URL builder for the editor's Drive here / Drive from start buttons (07.1.3 D-06).

/** Yaw radians (VehiclePose convention) to degrees in [0, 360), matching parseDriveHeading. */
export function yawToHeadingDeg(yawRad: number): number {
  const deg = (yawRad * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

export type DriveTarget = { start: string } | { at: { x: number; z: number }; headingDeg?: number };

export function buildDriveUrl(mapId: string, target: DriveTarget): string {
  const base = `/?map=${encodeURIComponent(mapId)}`;
  if ("start" in target) return `${base}&start=${encodeURIComponent(target.start)}&debug`;
  let url = `${base}&at=${target.at.x.toFixed(1)},${target.at.z.toFixed(1)}`;
  if (target.headingDeg !== undefined && Number.isFinite(target.headingDeg)) {
    let h = ((target.headingDeg % 360) + 360) % 360;
    if (Number(h.toFixed(1)) >= 360) h = 0;
    url += `&heading=${h.toFixed(1)}`;
  }
  return `${url}&debug`;
}

export function buildStageTestUrl(mapId: string, stageId: string): string {
  return `/?map=${encodeURIComponent(mapId)}&mode=stage&stage=${encodeURIComponent(stageId)}&debug`;
}

export function buildRouteTestUrl(mapId: string, mode: "p2p" | "circuit", routeId: string): string {
  return `/?map=${encodeURIComponent(mapId)}&mode=${mode}&route=${encodeURIComponent(routeId)}&debug`;
}
