/**
 * Proving-ground launch pads (`?map=feel-test`): number keys drop the car on a
 * fixed pad, facing the station's feature, already moving at a chosen speed,
 * so a manoeuvre always starts from exactly the same state. `[` / `]` change
 * the launch speed, G repeats the last launch.
 *
 * `parseStations`, `launchVelocity` and `cycleSpeed` are pure so they test
 * without a DOM; `createTestStations` is the browser layer.
 */

export interface TestStation {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly note: string;
  /** Metres ahead of the pad to the corner / take-off; 0 = no countdown boards. */
  readonly featureAheadM: number;
  readonly widthM: number;
  readonly x: number;
  readonly z: number;
  readonly headingRad: number;
}

export const STATION_SPEEDS_MPH: readonly number[] = [0, 20, 30, 45, 60, 70, 80, 100];
export const DEFAULT_STATION_SPEED_MPH = 70;
const MPH_TO_MS = 0.44704;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Parses `<area>.stations.json`; throws a named error on any malformed field. */
export function parseStations(text: string, areaId: string): readonly TestStation[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("parseStations: not valid JSON");
  }
  if (!isRecord(raw) || raw.areaId !== areaId || !Array.isArray(raw.stations)) {
    throw new Error(`parseStations: expected { areaId: "${areaId}", stations: [...] }`);
  }
  return raw.stations.map((s: unknown, i: number): TestStation => {
    if (
      !isRecord(s) ||
      typeof s.id !== "string" ||
      typeof s.key !== "string" ||
      typeof s.name !== "string" ||
      typeof s.note !== "string" ||
      !Number.isFinite(s.x) ||
      !Number.isFinite(s.z) ||
      !Number.isFinite(s.headingRad)
    ) {
      throw new Error(`parseStations: stations[${i}] is malformed`);
    }
    return {
      id: s.id,
      key: s.key,
      name: s.name,
      note: s.note,
      featureAheadM: typeof s.featureAheadM === "number" ? s.featureAheadM : 0,
      widthM: typeof s.widthM === "number" ? s.widthM : 12,
      x: s.x as number,
      z: s.z as number,
      headingRad: s.headingRad as number,
    };
  });
}

/** World velocity for a car facing `headingRad` (resetPose yaw: forward = (-sin h, -cos h)). */
export function launchVelocity(
  headingRad: number,
  speedMph: number,
): { x: number; y: number; z: number } {
  const ms = speedMph * MPH_TO_MS;
  return { x: -Math.sin(headingRad) * ms, y: 0, z: -Math.cos(headingRad) * ms };
}

/** Next speed in `STATION_SPEEDS_MPH`, clamped at both ends. */
export function cycleSpeed(currentMph: number, direction: 1 | -1): number {
  const i = STATION_SPEEDS_MPH.indexOf(currentMph);
  const from = i < 0 ? STATION_SPEEDS_MPH.indexOf(DEFAULT_STATION_SPEED_MPH) : i;
  const next = Math.min(STATION_SPEEDS_MPH.length - 1, Math.max(0, from + direction));
  return STATION_SPEEDS_MPH[next];
}

export function createTestStations(
  stations: readonly TestStation[],
  launch: (station: TestStation, speedMph: number) => void,
): void {
  let speedMph = DEFAULT_STATION_SPEED_MPH;
  let last: TestStation | undefined;

  // One line at the top centre by default (the map is what matters); H opens the full list.
  let expanded = false;
  const panel = document.createElement("div");
  panel.style.cssText =
    "position:fixed;left:50%;top:34px;transform:translateX(-50%);padding:3px 10px;" +
    "font:12px monospace;color:#fff;background:rgba(0,0,0,.55);border-radius:4px;" +
    "pointer-events:none;z-index:9999;white-space:pre";
  document.body.appendChild(panel);

  function paint(): void {
    const head = `${speedMph} mph   ${last === undefined ? "press 1-9/0 to launch" : last.name}   [H] stations`;
    if (!expanded) {
      panel.textContent = head;
      return;
    }
    const lines = stations.map((s) => `[${s.key}] ${s.name}${s === last ? "  <" : ""}`);
    panel.textContent = [`${head}   [ ] speed   [G] repeat`, ...lines].join("\n");
  }

  function go(station: TestStation): void {
    last = station;
    launch(station, speedMph);
    paint();
  }

  addEventListener("keydown", (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const el = document.activeElement as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
    if (e.code === "BracketLeft") {
      speedMph = cycleSpeed(speedMph, -1);
      paint();
    } else if (e.code === "BracketRight") {
      speedMph = cycleSpeed(speedMph, 1);
      paint();
    } else if (e.code === "KeyH") {
      expanded = !expanded;
      paint();
    } else if (e.code === "KeyG") {
      if (last !== undefined) go(last);
    } else if (e.code.startsWith("Digit")) {
      const station = stations.find((s) => s.key === e.code.slice(5));
      if (station !== undefined) go(station);
    }
  });
  paint();
}
