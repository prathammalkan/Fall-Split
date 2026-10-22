import { useEffect, useRef, type ReactNode } from 'react';

interface SheetDialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function SheetDialog({ title, onClose, children }: SheetDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
      dialog.focus({ preventScroll: true });
    } else {
      // Keep the content usable in DOM test environments without <dialog> APIs.
      dialog.setAttribute('open', '');
    }

    return () => {
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      aria-label={title}
      className="fixed inset-x-0 bottom-0 m-0 max-h-[94dvh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-[rgb(var(--color-border))] bg-[rgb(var(--color-bg))] p-0 shadow-2xl backdrop:bg-black/50 md:inset-0 md:m-auto md:max-h-[90dvh] md:rounded-2xl"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {children}
    </dialog>
  );
}
