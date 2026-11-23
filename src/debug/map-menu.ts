/**
 * Map picker for `?feel` / `?debug` sessions: a small drop-down in the top-left
 * corner that reloads the page with `?map=<id>` (other params kept), so a
 * different map can be tried without restarting from the terminal.
 */

import { KNOWN_MAP_IDS, MAP_LABELS, type MapId, searchForMap } from "../core/map-select";
import {
  KNOWN_VEHICLE_CLASS_IDS,
  searchForVehicle,
  VEHICLE_CLASSES,
  type VehicleClassId,
} from "../core/vehicle-class";

export function createMapMenu(current: MapId): void {
  const select = document.createElement("select");
  select.style.cssText =
    "position:fixed;left:8px;top:8px;z-index:9999;font:12px monospace;color:#fff;" +
    "background:rgba(0,0,0,.65);border:1px solid #567;border-radius:4px;padding:2px 4px";
  select.title = "Switch map (reloads the page)";
  for (const id of KNOWN_MAP_IDS) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = MAP_LABELS[id];
    option.selected = id === current;
    select.appendChild(option);
  }
  select.addEventListener("change", () => {
    const next = KNOWN_MAP_IDS.find((id) => id === select.value);
    if (next === undefined) return;
    location.search = searchForMap(location.search, next);
  });
  // Hand the keyboard back to the game as soon as the list closes.
  select.addEventListener("change", () => select.blur());
  document.body.appendChild(select);
}

/** Vehicle picker (brief D9): reloads with `?car=<id>`, other params kept. */
export function createVehicleMenu(current: VehicleClassId): void {
  const select = document.createElement("select");
  select.style.cssText =
    "position:fixed;left:8px;top:32px;z-index:9999;font:12px monospace;color:#fff;" +
    "background:rgba(0,0,0,.65);border:1px solid #567;border-radius:4px;padding:2px 4px";
  select.title = "Switch vehicle (reloads the page)";
  for (const id of KNOWN_VEHICLE_CLASS_IDS) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = VEHICLE_CLASSES[id].label;
    option.selected = id === current;
    select.appendChild(option);
  }
  select.addEventListener("change", () => {
    const next = KNOWN_VEHICLE_CLASS_IDS.find((id) => id === select.value);
    if (next === undefined) return;
    location.search = searchForVehicle(location.search, next);
  });
  select.addEventListener("change", () => select.blur());
  document.body.appendChild(select);
}
