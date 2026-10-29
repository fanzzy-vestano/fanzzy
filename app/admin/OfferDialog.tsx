"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import "./offers.css";
export function OfferDialog({ title, eyebrow, children, onClose, wide = false, editor = false, description }: { title: string; eyebrow: string; children: ReactNode; onClose: () => void; wide?: boolean; editor?: boolean; description?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const items = ref.current?.querySelectorAll<HTMLElement>('button, input, textarea, select, [tabindex="0"]');
      if (!items?.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", handleKey); previous?.focus(); };
  }, []);
  return <div className="offers-overlay" onClick={onClose}><div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`offers-dialog${wide ? " offers-dialog-wide" : ""}${editor ? " offers-editor-dialog" : ""}`} onClick={(event) => event.stopPropagation()}><header><p>{eyebrow}</p><h2>{title}</h2><span>{description || (wide ? "All available offer types are listed below." : "Set up the details for your promotion.")}</span><button className="offers-close" aria-label="Close dialog" onClick={onClose}><X size={23} /></button></header>{children}</div></div>;
}

