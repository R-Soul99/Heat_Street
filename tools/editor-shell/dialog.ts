import type { DialogSpec } from "./types";

let openCount = 0;

export function isDialogOpen(): boolean {
  return openCount > 0;
}

/**
 * Modal dialog on native <dialog>.showModal(). An action's run() may return an
 * error string: it is shown inline and the dialog stays open. Resolves with the
 * id of the action that closed it, or null on Escape/cancel.
 */
export function openDialog(spec: DialogSpec): Promise<string | null> {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "es-dialog";

    const h = document.createElement("h2");
    h.textContent = spec.title;
    const errorSlot = document.createElement("div");
    errorSlot.className = "es-dialog-error";
    errorSlot.setAttribute("role", "alert");
    errorSlot.hidden = true;
    const actions = document.createElement("div");
    actions.className = "es-dialog-actions";
    dlg.append(h, spec.body, errorSlot, actions);

    const buttons: HTMLButtonElement[] = [];
    let result: string | null = null;

    for (const a of spec.actions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = a.label;
      btn.dataset.tip = a.tip;
      if (a.primary) btn.classList.add("primary");
      btn.addEventListener("click", async () => {
        errorSlot.hidden = true;
        if (a.run) {
          for (const b of buttons) b.disabled = true;
          let err: string | null;
          try {
            err = await a.run();
          } catch (e) {
            err = e instanceof Error ? e.message : String(e);
          }
          for (const b of buttons) b.disabled = false;
          if (err !== null) {
            errorSlot.textContent = err;
            errorSlot.hidden = false;
            return;
          }
        }
        result = a.id;
        dlg.close();
      });
      buttons.push(btn);
      actions.append(btn);
    }

    dlg.addEventListener("close", () => {
      openCount = Math.max(0, openCount - 1);
      dlg.remove();
      spec.onClose?.();
      resolve(result);
    });

    document.body.append(dlg);
    openCount++;
    dlg.showModal();
  });
}

export async function confirmDialog(o: {
  title: string;
  message: string;
  okLabel: string;
}): Promise<boolean> {
  const body = document.createElement("p");
  body.textContent = o.message;
  const id = await openDialog({
    title: o.title,
    body,
    actions: [
      { id: "cancel", label: "Cancel", tip: "Close this without doing anything" },
      { id: "ok", label: o.okLabel, tip: o.message, primary: true },
    ],
  });
  return id === "ok";
}
