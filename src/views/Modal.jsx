import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// The dialog shell every picker and form uses. It does the three things a
// modal owes the keyboard: focus lands inside on open, Tab cycles inside
// while it is open, and focus goes back to whatever opened it on close (or
// to a fallback when the opener is gone, as a cell button is after assign).
// Escape closes it from anywhere on the page; a backdrop click closes it
// only when the caller says so — a twelve-field form should not vanish on a
// stray click.
export default function Modal({ label, onClose, className = '', as: Tag = 'div', closeOnBackdrop = true, fallbackFocus = null, children, ...rest }) {
  const ref = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement;
    const first = ref.current?.querySelector('[autofocus], ' + FOCUSABLE);
    first?.focus();
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onCloseRef.current(); } };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const target = opener?.isConnected ? opener : fallbackFocus ? document.querySelector(fallbackFocus) : null;
      target?.focus?.();
    };
  }, [fallbackFocus]);

  function trapTab(e) {
    if (e.key !== 'Tab') return;
    const items = [...ref.current.querySelectorAll(FOCUSABLE)];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !ref.current.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  return (
    <div className="modal-bg" onMouseDown={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) onClose(); }}>
      <Tag ref={ref} className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={label} onKeyDown={trapTab} {...rest}>
        {children}
      </Tag>
    </div>
  );
}
