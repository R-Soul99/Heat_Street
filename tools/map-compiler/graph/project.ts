/**
 * Local ENU (East-North-Up in name only; this project's actual convention is
 * East-Up-South — X east, Y up, Z south, per `docs/schemas/road-graph.v1.md`)
 * projection from WGS84 lat/lon to local metres.
 *
 * `makeProjector(origin)` returns a `project`/`unproject` pair evaluated at a
 * fixed origin latitude/longitude. Uses the standard local-tangent
 * metres-per-degree series evaluated at the origin latitude phi0 (radians)
 * `[CITED: standard WGS84 local metres-per-degree series]`. Over this
 * project's ~3km compiled areas (plan 04-04's Juliette, GA box is
 * ~2.9km x 2.4km) the flat-plane approximation error is well under a metre,
 * far below road width, so no full geodetic projection (UTM, etc.) is
 * needed.
 *
 * IMPORTANT — Z POINTS SOUTH, NOT NORTH: `z = (lat0 - lat) * metresPerDegreeLat`
 * deliberately inverts the usual north-positive-latitude sign. A point north
 * of the origin must project to a NEGATIVE z. Getting this sign wrong mirrors
 * the whole compiled map north-to-south — nearly undetectable by eye, since
 * every road still connects correctly, but wrong relative to real-world
 * compass directions and any future minimap/compass HUD. Asserted explicitly
 * in `project.test.ts`, not left to visual inspection.
 *
 * Layering: pure math, no I/O, no fs, no network. NOT mechanically enforced —
 * `tests/layering.test.ts` does not scan `tools/**`; this file's own
 * discipline is the only guard.
 */

export interface LatLon {
  readonly lat: number;
  readonly lon: number;
}

export interface ProjectedPoint {
  readonly x: number;
  readonly z: number;
}

export interface Projector {
  /** WGS84 lat/lon -> local ENU metres (x east, z south) relative to the projector's origin. */
  project(lat: number, lon: number): ProjectedPoint;
  /** Inverse of `project` — local metres -> WGS84 lat/lon. Round-trips within 1e-9 degrees. */
  unproject(x: number, z: number): LatLon;
}

/**
 * Builds a `Projector` fixed at `origin`. `origin` itself always projects to
 * exactly `{ x: 0, z: 0 }`.
 */
export function makeProjector(origin: LatLon): Projector {
  const phi0 = (origin.lat * Math.PI) / 180;

  // [CITED: standard WGS84 local metres-per-degree series]
  const metresPerDegreeLat =
    111132.92 -
    559.82 * Math.cos(2 * phi0) +
    1.175 * Math.cos(4 * phi0) -
    0.0023 * Math.cos(6 * phi0);
  const metresPerDegreeLon =
    111412.84 * Math.cos(phi0) - 93.5 * Math.cos(3 * phi0) + 0.118 * Math.cos(5 * phi0);

  return {
    project(lat: number, lon: number): ProjectedPoint {
      const x = (lon - origin.lon) * metresPerDegreeLon;
      // Inverted subtraction: origin.lat - lat, NOT lat - origin.lat — this is
      // what makes a northward point project to a NEGATIVE z (Z points south).
      const z = (origin.lat - lat) * metresPerDegreeLat;
      return { x, z };
    },
    unproject(x: number, z: number): LatLon {
      const lon = origin.lon + x / metresPerDegreeLon;
      const lat = origin.lat - z / metresPerDegreeLat;
      return { lat, lon };
    },
  };
}
