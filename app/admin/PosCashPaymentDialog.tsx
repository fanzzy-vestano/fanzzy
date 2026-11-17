"use client";

import { useEffect, useRef, useState } from "react";
import { calculateCashPayment, formatPosCurrency } from "../../lib/pos-cash-payment";

export default function PosCashPaymentDialog({ total, busy, error, onClose, onConfirm }: {
  total: number;
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: (received: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const [received, setReceived] = useState("");
  const payment = calculateCashPayment(total, received);
  const invalidAmount = received.trim() !== "" && payment.receivedPaise === null;

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    amountRef.current?.focus();
    return () => dialog?.close();
  }, []);

  return (
    <dialog ref={dialogRef} className="pos-cash-dialog" aria-labelledby="pos-cash-title" aria-describedby="pos-cash-description" aria-busy={busy} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <form onSubmit={(event) => { event.preventDefault(); if (!busy && payment.canConfirm) onConfirm(received); }}>
        <button className="product-modal-close" type="button" aria-label="Close cash payment" disabled={busy} onClick={onClose}>×</button>
        <p className="eyebrow">CASH PAYMENT</p>
        <h3 id="pos-cash-title">Collect cash</h3>
        <p id="pos-cash-description">Enter the cash received from the customer, then confirm payment.</p>
        <div className="pos-cash-total"><span>Bill total</span><strong>{formatPosCurrency(total)}</strong></div>
        <label className="pos-cash-field" htmlFor="pos-cash-received">Cash received (₹)
          <input ref={amountRef} id="pos-cash-received" type="text" inputMode="decimal" autoComplete="off" spellCheck={false} value={received} onChange={(event) => setReceived(event.target.value)} placeholder="Enter amount received" disabled={busy} aria-invalid={invalidAmount || (payment.shortfallPaise ?? 0) > 0} aria-describedby="pos-cash-feedback" />
        </label>
        <div id="pos-cash-feedback" aria-live="polite" aria-atomic="true">
          <div className={`pos-cash-change${payment.canConfirm ? " is-ready" : ""}`}><span>Balance to return</span><strong>{payment.canConfirm ? formatPosCurrency((payment.changePaise ?? 0) / 100) : "—"}</strong></div>
          {invalidAmount ? <p className="pos-cash-help is-error">Enter a valid amount with up to two decimal places.</p>
            : (payment.shortfallPaise ?? 0) > 0 ? <p className="pos-cash-help is-error">Collect {formatPosCurrency((payment.shortfallPaise ?? 0) / 100)} more to confirm payment.</p>
              : <p className="pos-cash-help">{payment.canConfirm ? payment.changePaise === 0 ? "Exact amount received. No change to return." : "Return this balance to the customer." : "Enter the amount received to calculate the balance."}</p>}
        </div>
        {error && <p className="pos-error" role="alert">{error}</p>}
        <div className="pos-cash-actions">
          <button className="module-secondary" type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="module-primary" type="submit" disabled={busy || !payment.canConfirm}>{busy ? "Confirming payment…" : "Confirm cash payment"}</button>
        </div>
      </form>
    </dialog>
  );
}
