/**
 * WR-06: writes the two halves of a terrain area (binary grid + json sidecar).
 * The bin goes first and the sidecar second. A failure of the first PUT leaves
 * the old pair untouched; a failure of the second leaves the new bin beside the
 * old sidecar, so that case is reported by name (never silently) and the
 * caller keeps its edits in memory so Save can simply be pressed again.
 * Either order can trip the server's cross-check when the grid extent changed
 * (validateAreaPair); with an unchanged extent both orders pass it.
 */
export async function putTerrainPair(
  put: (kind: "bin" | "json", body: BodyInit) => Promise<unknown>,
  bin: BodyInit,
  sidecar: string,
): Promise<void> {
  try {
    await put("bin", bin);
  } catch (err) {
    throw new Error(`terrain binary was not saved, nothing changed on disk: ${messageOf(err)}`);
  }
  try {
    await put("json", sidecar);
  } catch (err) {
    throw new Error(
      `the terrain binary WAS saved but the sidecar (roads/objects) was NOT, so the two files no longer match: ${messageOf(err)}`,
    );
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
