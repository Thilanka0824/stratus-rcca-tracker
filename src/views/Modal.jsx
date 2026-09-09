import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Open dialogs, innermost last. Only the top one answers Escape, so a
// confirm stacked on a form closes itself and leaves the form alone.
const stack = [];

// The dialog shell every picker and form uses. It does the three things a
// modal owes the keyboard: focus lands inside on open, Tab cycles inside
// while it is open, and focus goes back to whatever opened it on close (or
// to a fallback when the opener is gone, as a cell button is after assign).
// Escape closes it from anywhere on the page; a backdrop click closes it
// only when the caller says so — a twelve-field form should not vanish on a
// stray click. Rendered through a portal so dialogs can stack.
export default function Modal({ label, onClose, className = '', as: Tag = 'div', closeOnBackdrop = true, fallbackFocus = null, children, ...rest }) {
  const ref = useRef(null);
  const id = useRef(Symbol('modal'));
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // The opener is read during the first render: by the time effects run,
  // React has already honoured an autoFocus inside the dialog and
  // document.activeElement would be the dialog's own first control.
  const openerRef = useRef(null);
  if (openerRef.current === null) openerRef.current = document.activeElement;

  useEffect(() => {
    const me = id.current;
    stack.push(me);
    const opener = openerRef.current;
    if (!ref.current?.contains(document.activeElement)) {          // no autoFocus inside: take the first control
      ref.current?.querySelector(FOCUSABLE)?.focus();
    }
    const onKey = (e) => {
      if (e.key === 'Escape' && stack[stack.length - 1] === me) { e.preventDefault(); onCloseRef.current(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      stack.splice(stack.indexOf(me), 1);
      const target = opener?.isConnected ? opener : fallbackFocus ? document.querySelector(fallbackFocus) : null;
      target?.focus?.();
    };
  }, [fallbackFocus]);

  function trapTab(e) {
    if (e.key !== 'Tab' || !ref.current.contains(e.target)) return;   // a stacked dialog handles its own keys
    const items = [...ref.current.querySelectorAll(FOCUSABLE)];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !ref.current.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  return createPortal(
    <div className="modal-bg" onMouseDown={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) onClose(); }}>
      <Tag ref={ref} className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={label} onKeyDown={trapTab} {...rest}>
        {children}
      </Tag>
    </div>,
    document.body,
  );
}

// A yes/no question in the app's own dress, for the few destructive
// moments outside triage. The safe answer is focused first; the dangerous
// one is coloured like a failure.
export function ConfirmDialog({ title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, onConfirm, onCancel }) {
  return (
    <Modal label={title} className="confirm" onClose={onCancel} role="alertdialog">
      <h2>{title}</h2>
      {body && <p className="caption">{body}</p>}
      <div className="stepper">
        <button type="button" autoFocus className="btn ghost" onClick={onCancel}>{cancelLabel}</button>
        <button type="button" className={`btn ${danger ? 'danger' : ''}`} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}
