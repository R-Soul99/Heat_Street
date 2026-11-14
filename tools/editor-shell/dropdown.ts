/** Pure open/close state for top-bar drop-down menus (07.1.2 D-33). One menu open at a time. */
export type DropdownEvent =
  | { type: "trigger"; id: string }
  | { type: "open"; id: string }
  | { type: "pick" }
  | { type: "escape" }
  | { type: "outside" }
  | { type: "close" };

export function dropdownNext(open: string | null, ev: DropdownEvent): string | null {
  switch (ev.type) {
    case "trigger":
      return open === ev.id ? null : ev.id;
    case "open":
      return ev.id;
    default:
      return null;
  }
}
