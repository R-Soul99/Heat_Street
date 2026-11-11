import type { TooltipControl } from "./tooltips";

export interface MenuItem {
  label: string;
  tip: string;
  run: () => void;
  shortcut?: string;
  checked?: () => boolean;
  disabled?: () => boolean;
}
export interface MenuSpec {
  label: string;
  tip: string;
  items: (MenuItem | "separator")[];
}
export interface ToolSpec {
  id: string;
  label: string;
  icon: string;
  tip: string;
  shortcut?: string;
  renderOptions?: (host: HTMLElement) => void;
}
export interface InfoFieldSpec {
  key: string;
  label: string;
  tip: string;
}
export type StatusKind = "info" | "ok" | "error";
export interface DialogAction {
  id: string;
  label: string;
  tip: string;
  primary?: boolean;
  /** Return an error string to keep the dialog open and show it inline; null closes. */
  run?: () => string | null | Promise<string | null>;
}
export interface DialogSpec {
  title: string;
  body: HTMLElement;
  actions: DialogAction[];
  onClose?: () => void;
}
export interface ShellOptions {
  root: HTMLElement;
  title: string;
  menus: MenuSpec[];
  topbarExtras?: HTMLElement[];
  tools: ToolSpec[];
  initialTool: string;
  onToolChange: (id: string) => void;
  history: {
    onUndo: () => void;
    onRedo: () => void;
    onClear?: () => void;
    clearLabel?: string;
    clearTip?: string;
  };
  view: {
    onZoomIn: () => void;
    onZoomOut: () => void;
    onFit: () => void;
    onPan: (dx: -1 | 0 | 1, dy: -1 | 0 | 1) => void;
    extra?: { label: string; tip: string; run: () => void }[];
  };
  infoFields: InfoFieldSpec[];
}
export interface InfoBar {
  set(key: string, text: string): void;
  status(text: string, kind?: StatusKind): void;
  setDirty(dirty: boolean): void;
}
export interface ShellHandle {
  canvasHost: HTMLElement;
  info: InfoBar;
  setTool(id: string): void;
  activeTool(): string;
  refreshToolOptions(): void;
  setHistoryState(canUndo: boolean, canRedo: boolean): void;
  dialog(spec: DialogSpec): Promise<string | null>;
  confirm(o: { title: string; message: string; okLabel: string }): Promise<boolean>;
  isDialogOpen(): boolean;
  tooltips: TooltipControl;
}
