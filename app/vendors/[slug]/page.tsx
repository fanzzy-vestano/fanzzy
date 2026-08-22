"use client";
/* eslint-disable @next/next/no-html-link-for-pages */

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import "../../globals.css";
import "../../vendor/vendor.css";

type Product = { sku: string; name: string; category: string; price: number; stock: number; image?: string; hover_image?: string; vendor_status?: string };
type Vendor = { businessName: string; logoUrl?: string; coverUrl?: string; description?: string };

export default function VendorStorePage() {
  const params = useParams<{ slug: string }>();
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All categories");
  const [sort, setSort] = useState("newest");
  useEffect(() => { if (!params.slug) return; fetch(`/api/vendors/${encodeURIComponent(params.slug)}`, { cache: "no-store" }).then((response) => response.json()).then((body: { vendor?: Vendor; products?: Product[] }) => { setVendor(body.vendor || null); setProducts(body.products || []); }).catch(() => { setVendor(null); }); }, [params.slug]);
  const categories = useMemo(() => ["All categories", ...Array.from(new Set(products.map((product) => product.category))).sort()], [products]);
  const visible = useMemo(() => products.filter((product) => (!query || `${product.name} ${product.category} ${product.sku}`.toLowerCase().includes(query.toLowerCase())) && (category === "All categories" || product.category === category)).sort((a, b) => sort === "price-low" ? a.price - b.price : sort === "price-high" ? b.price - a.price : a.name.localeCompare(b.name)), [category, products, query, sort]);
  if (!vendor) return <main className="vendor-public-page"><p className="vendor-error">This vendor store is hidden or unavailable.</p><a href="/vendors">View all vendors</a></main>;
  return <main className="vendor-public-page"><header className="vendor-public-header"><a href="/vendors">Shop by vendor</a><a href="/">Back to store ↗</a></header><section className="vendor-store-hero" style={vendor.coverUrl ? { backgroundImage: `linear-gradient(90deg, rgba(38,12,23,.82), rgba(38,12,23,.15)), url(${vendor.coverUrl})` } : undefined}><div className="vendor-store-logo">{vendor.logoUrl ? <img src={vendor.logoUrl} alt="" /> : vendor.businessName.slice(0, 1)}</div><div><p className="eyebrow light">VENDOR STORE</p><h1>{vendor.businessName}</h1><p>{vendor.description}</p></div></section><section className="vendor-store-products"><div className="vendor-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this store" aria-label="Search this vendor store" /><select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter by category">{categories.map((item) => <option key={item}>{item}</option>)}</select><select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort products"><option value="newest">Sort: Name</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option></select></div><div className="vendor-product-grid">{visible.map((product) => <article className="vendor-product-card" key={product.sku}><img src={product.image || "/fanzzy-mark.png"} alt={product.name} /><p className="eyebrow">{product.category}</p><h2>{product.name}</h2><strong>₹{Number(product.price || 0).toLocaleString("en-IN")}</strong><small>Sold by: {vendor.businessName}</small><a href={`/?product=${encodeURIComponent(product.sku)}`}>View in store ↗</a></article>)}{!visible.length && <p className="muted">No products match this store filter.</p>}</div></section></main>;
}
