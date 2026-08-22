"use client";
/* eslint-disable @next/next/no-html-link-for-pages */

import { useEffect, useState } from "react";
import "../globals.css";
import "../vendor/vendor.css";

type Vendor = { id: string; slug: string; businessName: string; logoUrl?: string; coverUrl?: string; description?: string; featured?: boolean };

export default function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { fetch("/api/vendors", { cache: "no-store" }).then((response) => response.json()).then((body: { vendors?: Vendor[]; error?: string }) => { setVendors(body.vendors || []); setError(body.error || ""); }).catch(() => setError("Vendor stores are temporarily unavailable.")); }, []);
  return <main className="vendor-public-page"><header className="vendor-public-header"><a href="/" className="wordmark"><img src="/fanzzy-mark.png" alt="Fanzzy" className="brand-logo" /></a><a href="/">Back to store ↗</a></header><section className="vendor-public-hero"><p className="eyebrow">THE FANZZY EDIT</p><h1>Shop by <em>Vendor.</em></h1><p>Discover independent stores and the pieces they bring to the collection.</p></section>{error && <p className="vendor-error">{error}</p>}<section className="vendor-card-grid">{vendors.map((vendor) => <article className="vendor-public-card" key={vendor.id}><div className="vendor-card-image">{vendor.logoUrl ? <img src={vendor.logoUrl} alt="" /> : <span>{vendor.businessName.slice(0, 1)}</span>}</div><div><p className="eyebrow">{vendor.featured ? "FEATURED VENDOR" : "VENDOR STORE"}</p><h2>{vendor.businessName}</h2><p>{vendor.description || "A considered edit from the Fanzzy marketplace."}</p><a className="button button-dark" href={`/vendors/${vendor.slug}`}>View store <span>↗</span></a></div></article>)}{!vendors.length && !error && <p className="muted">No visible vendor stores yet.</p>}</section></main>;
}
