import { useEffect, useId, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { TriangleAlert } from 'lucide-react';

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" for destructive actions (red confirm button). */
  tone?: 'danger' | 'default';
};

/**
 * Styled replacement for window.confirm(). Opens a centered modal and resolves to true (confirmed) or
 * false (cancelled via button, Esc or a click outside). Usage: `if (!(await confirmAction({...}))) return;`
 */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise(resolve => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    let settled = false;
    const done = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
      // Unmount after the click handler finishes.
      queueMicrotask(() => {
        root.unmount();
        host.remove();
      });
    };
    root.render(<ConfirmDialog {...options} onDone={done} />);
  });
}

function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  tone = 'default',
  onDone,
}: ConfirmOptions & { onDone: (confirmed: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const messageId = useId();
  useEffect(() => {
    dialog.current?.showModal();
    // Safer default for destructive actions: Enter/Space cancel unless the user moves to the confirm button.
    cancelButton.current?.focus();
  }, []);
  return (
    <dialog
      ref={dialog}
      className={'confirm-dialog ' + tone}
      aria-labelledby={titleId}
      aria-describedby={message ? messageId : undefined}
      onCancel={event => {
        event.preventDefault();
        onDone(false);
      }}
      onClick={event => {
        // A click on the backdrop targets the <dialog> element itself.
        if (event.target === dialog.current) onDone(false);
      }}
    >
      <div className="confirm-dialog-icon" aria-hidden="true">
        <TriangleAlert size={20} />
      </div>
      <h2 id={titleId}>{title}</h2>
      {message && <p id={messageId}>{message}</p>}
      <footer>
        <button type="button" ref={cancelButton} onClick={() => onDone(false)}>
          {cancelLabel}
        </button>
        <button type="button" className={tone === 'danger' ? 'danger-button' : 'primary'} onClick={() => onDone(true)}>
          {confirmLabel}
        </button>
      </footer>
    </dialog>
  );
}
