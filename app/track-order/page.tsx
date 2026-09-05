"use client";

import { FormEvent, useState } from "react";

type TrackingScan = { status: string; date?: string; location?: string; instructions?: string };
type TrackingResult = {
  orderId: string;
  placedOn?: string;
  status: string;
  statusType?: string;
  statusDate?: string;
  location?: string;
  waybill?: string;
  trackingUrl?: string;
  scans: TrackingScan[];
  shipmentAvailable: boolean;
};

const displayStatus = (status: string) => /^manifested$/i.test(status.trim()) ? "Confirmed" : status || "Order received";

const displayDate = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
};

export default function TrackOrderPage() {
  const [orderId, setOrderId] = useState("");
  const [phone, setPhone] = useState("");
  const [result, setResult] = useState<TrackingResult | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const trackOrder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setResult(null);
    try {
      const response = await fetch("/api/orders/track", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId, phone }),
      });
      const body = await response.json() as { tracking?: TrackingResult; error?: string };
      if (!response.ok || !body.tracking) throw new Error(body.error || "We could not find that order.");
      setResult(body.tracking);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Tracking is temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="tracking-page">
      <div className="tracking-topbar">
        <a href="/" className="tracking-back">← Back to Fanzzy</a>
        <span className="tracking-mark">fanZZy</span>
      </div>
      <section className="tracking-card" aria-labelledby="tracking-title">
        <div className="tracking-card-intro">
          <p className="eyebrow">FANZZY DELIVERY</p>
          <h1 id="tracking-title">Track your <em>order.</em></h1>
          <p>Check the latest delivery update without signing in. Enter the order number and the mobile number used at checkout.</p>
        </div>
        <form className="tracking-form" onSubmit={trackOrder}>
          <label>Order number<input value={orderId} onChange={(event) => setOrderId(event.target.value.toUpperCase())} placeholder="#FZ-F11E80" autoComplete="off" required /></label>
          <label>Mobile number<input value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="10-digit mobile number" inputMode="numeric" autoComplete="tel" required /></label>
          <button className="button button-dark" type="submit" disabled={loading}>{loading ? "Checking shipment…" : "Track order ↗"}</button>
        </form>
        {message && <p className="tracking-message" role="alert">{message}</p>}
        {result && <section className="tracking-result" aria-live="polite">
          <div className="tracking-result-head"><div><p className="eyebrow">ORDER {result.orderId.replace(/^#/, "")}</p><h2>{displayStatus(result.status)}</h2>{result.location && <p className="tracking-location">Last update from {result.location}</p>}</div><span className="tracking-status-pill">{result.statusType || "Live update"}</span></div>
          <div className="tracking-meta"><span>Placed {displayDate(result.placedOn)}</span>{result.statusDate && <span>Updated {displayDate(result.statusDate)}</span>}</div>
          {result.shipmentAvailable ? <>
            <div className="tracking-shipment"><div><small>DELHIVERY SHIPMENT</small><strong>{result.waybill}</strong></div>{result.trackingUrl && <a href={result.trackingUrl} target="_blank" rel="noreferrer">Open Delhivery ↗</a>}</div>
            {result.scans.length > 0 ? <ol className="tracking-timeline">{result.scans.slice(0, 8).map((scan, index) => <li className={index === 0 ? "current" : ""} key={`${scan.status}-${scan.date || index}`}><span className="tracking-dot" /><div><strong>{displayStatus(scan.status)}</strong>{scan.location && <small>{scan.location}</small>}{scan.instructions && <small>{scan.instructions}</small>}{scan.date && <time>{displayDate(scan.date)}</time>}</div></li>)}</ol> : <p className="tracking-pending">Your shipment is confirmed. Detailed movement updates will appear after Delhivery scans the parcel.</p>}
          </> : <p className="tracking-pending">Your order is confirmed. Delhivery tracking will appear here as soon as the shipment is prepared.</p>}
        </section>}
      </section>
      <p className="tracking-privacy">For your privacy, tracking requires both your Fanzzy order number and checkout mobile number.</p>
    </main>
  );
}
