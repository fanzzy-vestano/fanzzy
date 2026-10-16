"use client";

import { useEffect, useRef } from "react";

export default function OrderDeleteDialog({ order, busy, error, onCancel, onConfirm }: {
  order: { id: string; customerName: string; total: string };
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    cancelRef.current?.focus();
    return () => dialog?.close();
  }, []);

  return (
    <dialog ref={dialogRef} className="order-delete-dialog" aria-labelledby="order-delete-title" aria-describedby="order-delete-description" aria-busy={busy} onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}>
      <p className="eyebrow">DELETE ORDER</p>
      <h3 id="order-delete-title">Delete this order?</h3>
      <div className="order-delete-summary"><strong>{order.id}</strong><span>{order.customerName}</span><b>{order.total}</b></div>
      <p id="order-delete-description">This removes the order from Fanzzy order history. You cannot restore it from the admin panel.</p>
      <p className="order-delete-effects">Payment and stock records are retained. Deleting an order does not refund payment, return stock or cancel its shipment.</p>
      {error && <p className="order-delete-error" role="alert">{error}</p>}
      <div className="order-delete-actions">
        <button ref={cancelRef} className="module-secondary" type="button" disabled={busy} onClick={onCancel}>Cancel</button>
        <button className="order-delete-button" type="button" disabled={busy} onClick={onConfirm}>{busy ? "Deleting…" : "Yes, delete order"}</button>
      </div>
    </dialog>
  );
}
