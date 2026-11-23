import type { Course } from "./course";

export type RouteRequestMode = "p2p" | "circuit" | "circuit-race";

export interface RouteRequest {
  readonly mode: RouteRequestMode;
  readonly routeId: string | null;
  readonly badRouteId: boolean;
}

export type CourseSelection =
  | { readonly kind: "none" }
  | {
      readonly kind: "course";
      readonly course: Course;
      readonly mode: RouteRequestMode;
      readonly warning?: string;
    };

/** Same shape the editor enforces for course ids (T-10-30). */
export const COURSE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Parse `?route=<courseId>` and `?mode=p2p|circuit|circuit-race` (anything else -> p2p). */
export function parseRouteRequest(search: string): RouteRequest {
  const params = new URLSearchParams(search);
  const modeParam = params.get("mode");
  const mode: RouteRequestMode =
    modeParam === "circuit-race" ? "circuit-race" : modeParam === "circuit" ? "circuit" : "p2p";
  const rawRoute = params.get("route");
  if (rawRoute === null) return { mode, routeId: null, badRouteId: false };
  if (!COURSE_ID_PATTERN.test(rawRoute)) return { mode, routeId: null, badRouteId: true };
  return { mode, routeId: rawRoute, badRouteId: false };
}

/** Pick the course to race. Pure: warnings are returned, never logged. */
export function selectCourse(courses: readonly Course[], request: RouteRequest): CourseSelection {
  if (courses.length === 0) return { kind: "none" };
  const warnings: string[] = [];
  if (request.badRouteId) warnings.push("invalid ?route= value ignored");

  if (request.routeId !== null) {
    const byId = courses.find((candidate) => candidate.id === request.routeId);
    if (byId !== undefined) {
      if (request.mode === "circuit-race") {
        if (byId.mode === "circuit") return { kind: "course", course: byId, mode: "circuit-race" };
        return {
          kind: "course",
          course: byId,
          mode: byId.mode,
          warning: `route "${byId.id}" is not a circuit; circuit-race ignored`,
        };
      }
      return { kind: "course", course: byId, mode: byId.mode };
    }
    warnings.push(`unknown route "${request.routeId}"`);
  }

  const wanted = request.mode === "circuit-race" ? "circuit" : request.mode;
  const ofMode = courses.find((candidate) => candidate.mode === wanted);
  if (ofMode !== undefined) {
    return {
      kind: "course",
      course: ofMode,
      mode: request.mode,
      ...(warnings.length > 0 ? { warning: warnings.join("; ") } : {}),
    };
  }
  const first = courses[0] as Course;
  warnings.push(`no ${request.mode} route; using "${first.id}" (${first.mode})`);
  return { kind: "course", course: first, mode: first.mode, warning: warnings.join("; ") };
}
