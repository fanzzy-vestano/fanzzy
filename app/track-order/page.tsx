"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { siteApiFetch } from "../../lib/site-api-client";

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

const trackingStages = [
  { key: "ready", label: "Ready to ship", match: /manifest|ready|shipment created|confirmed/i },
  { key: "pickup", label: "Scheduled for pickup", match: /pickup|schedule|booked/i },
  { key: "transit", label: "In-transit", match: /transit|dispatched|picked|shipped|reached destination/i },
  { key: "out-for-delivery", label: "Out for delivery", match: /out for delivery|out-for-delivery/i },
  { key: "delivered", label: "Delivered", match: /delivered|successfully delivered/i },
] as const;

const activeTrackingStage = (status: string) => {
  const normalized = status.toLowerCase();
  if (/delivered|successfully delivered/.test(normalized)) return 4;
  if (/out for delivery|out-for-delivery/.test(normalized)) return 3;
  if (/on the way|in transit|dispatched|picked|shipped|reached destination/.test(normalized)) return 2;
  if (/preparing|processing|packed|manifested|confirmed|shipment created|order received|pickup|schedule|booked/.test(normalized)) return 1;
  return 0;
};

const stageDetail = (index: number, current: boolean, result: TrackingResult) => {
  if (!current) return index < activeTrackingStage(result.status) ? "Completed" : "Waiting for update";
  if (index === 1) return "Pickup has been scheduled with Delhivery.";
  if (index === 2) return result.location ? `Moving through ${result.location}.` : "Your parcel is moving with Delhivery.";
  if (index === 3) return "Your parcel is out for delivery today.";
  if (index === 4) return "Your order has been delivered.";
  return "Your parcel is being prepared.";
};

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

  useEffect(() => {
    if (!result) return;
    const refresh = async () => {
      try {
        const response = await siteApiFetch("/orders/track", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orderId: result.orderId, phone }),
          cache: "no-store",
        });
        const body = await response.json() as { tracking?: TrackingResult };
        if (response.ok && body.tracking) setResult(body.tracking);
      } catch {
        // Keep the last successful tracking state visible during a temporary outage.
      }
    };
    const timer = window.setInterval(() => { void refresh(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [phone, result?.orderId]);

  const trackOrder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setResult(null);
    try {
      const response = await siteApiFetch("/orders/track", {
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
        <Link href="/" className="tracking-back">← Back to Fanzzy</Link>
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
          <div className="tracking-meta"><span>Placed {displayDate(result.placedOn)}</span>{result.statusDate && <span>Updated {displayDate(result.statusDate)}</span>}<span>Live refresh every 60 seconds</span></div>
          <ol className="tracking-stage-list" aria-label="Order delivery progress">{trackingStages.map((stage, index) => { const currentStage = activeTrackingStage(result.status); const current = index === currentStage; const completed = index < currentStage; const scan = result.scans.find((candidate) => stage.match.test(`${candidate.status} ${candidate.instructions || ""}`)); const date = scan?.date || (completed || current) && (current && result.statusDate ? result.statusDate : result.placedOn); return <li className={`${completed ? "completed " : ""}${current ? "current" : "upcoming"}`} aria-current={current ? "step" : undefined} key={stage.key}><span className="tracking-stage-dot" /><div><strong>{stage.label}</strong><small>{stageDetail(index, current, result)}</small>{date && (completed || current) && <time>{displayDate(date)}</time>}{scan?.location && <small>{scan.location}{scan.instructions ? ` · ${scan.instructions}` : ""}</small>}</div></li>; })}</ol>
          {result.shipmentAvailable ? <>
            <div className="tracking-shipment"><div><small>DELHIVERY SHIPMENT</small><strong>{result.waybill}</strong></div>{result.trackingUrl && <a href={result.trackingUrl} target="_blank" rel="noreferrer">Open Delhivery ↗</a>}</div>
            {result.scans.length > 0 ? <div className="tracking-scan-summary"><strong>Latest courier scan</strong><span>{displayStatus(result.scans[0].status)}{result.scans[0].location ? ` · ${result.scans[0].location}` : ""}</span>{result.scans[0].date && <time>{displayDate(result.scans[0].date)}</time>}</div> : <p className="tracking-pending">Your shipment is confirmed. Detailed movement updates will appear after Delhivery scans the parcel.</p>}
          </> : <p className="tracking-pending">Your order is confirmed. Delhivery tracking will appear here as soon as the shipment is prepared.</p>}
        </section>}
      </section>
      <p className="tracking-privacy">For your privacy, tracking requires both your Fanzzy order number and checkout mobile number.</p>
    </main>
  );
}
