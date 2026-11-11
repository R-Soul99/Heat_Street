/** Native <dialog> helpers with an inline error slot (D-06). */

export interface DialogAction<R extends string> {
  id: R;
  label: string;
  tip: string;
  primary?: boolean;
  run?: () => Promise<string | undefined> | string | undefined;
}

export function openDialog<R extends string>(opts: {
  title: string;
  body: HTMLElement;
  actions: DialogAction<R>[];
}): Promise<R | "cancel"> {
  window.dispatchEvent(new Event("shell:dialog-open"));
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    const h = document.createElement("h3");
    h.textContent = opts.title;
    const err = document.createElement("div");
    err.className = "dialog-error";
    const bar = document.createElement("div");
    bar.className = "dialog-actions";
    const buttons: HTMLButtonElement[] = [];
    let result: R | "cancel" = "cancel";

    for (const a of opts.actions) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = a.label;
      b.dataset.tip = a.tip;
      if (a.primary) b.classList.add("primary");
      b.addEventListener("click", async () => {
        err.textContent = "";
        if (a.run) {
          for (const x of buttons) x.disabled = true;
          try {
            const msg = await a.run();
            if (msg) {
              err.textContent = msg;
              console.error(`[editor-shell] dialog "${opts.title}": ${msg}`);
              for (const x of buttons) x.disabled = false;
              return;
            }
          } catch (e) {
            const m = e instanceof Error ? e.message : String(e);
            err.textContent = m;
            console.error(`[editor-shell] dialog "${opts.title}":`, e);
            for (const x of buttons) x.disabled = false;
            return;
          }
        }
        result = a.id;
        dlg.close();
      });
      buttons.push(b);
      bar.appendChild(b);
    }

    dlg.append(h, opts.body, err, bar);
    dlg.addEventListener("close", () => {
      dlg.remove();
      resolve(result);
    });
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) dlg.close(); // backdrop click
    });
    document.body.appendChild(dlg);
    dlg.showModal();
  });
}

export async function confirmDialog(
  title: string,
  message: string,
  confirmLabel: string,
): Promise<boolean> {
  const body = document.createElement("p");
  body.textContent = message;
  const r = await openDialog<"ok" | "no">({
    title,
    body,
    actions: [
      { id: "ok", label: confirmLabel, tip: "Confirm and continue", primary: true },
      { id: "no", label: "Cancel", tip: "Cancel and keep things as they are" },
    ],
  });
  return r === "ok";
}
