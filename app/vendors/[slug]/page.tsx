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
  const [vendorLoading, setVendorLoading] = useState(true);
  const [vendorError, setVendorError] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All categories");
  const [sort, setSort] = useState("newest");
  const [addedProducts, setAddedProducts] = useState<Record<string, boolean>>({});
  const [cartActionsVisible, setCartActionsVisible] = useState(false);
  useEffect(() => {
    if (!params.slug) return;
    let active = true;
    setVendorLoading(true);
    setVendorError("");

    fetch(`/api/vendors/${encodeURIComponent(params.slug)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as { vendor?: Vendor; products?: Product[]; error?: string };
        if (!response.ok) throw new Error(body.error || "Could not load vendor store.");
        if (!active) return;
        setVendor(body.vendor || null);
        setProducts(body.products || []);
      })
      .catch((caught) => {
        if (!active) return;
        setVendor(null);
        setProducts([]);
        setVendorError(caught instanceof Error ? caught.message : "Could not load vendor store.");
      })
      .finally(() => {
        if (active) setVendorLoading(false);
      });

    return () => { active = false; };
  }, [params.slug]);
  const addToCart = (product: Product) => {
    if (product.stock <= 0) return;
    try {
      const stored = window.localStorage.getItem("fanzzy-cart:guest");
      const cart = stored ? JSON.parse(stored) as Record<string, number> : {};
      const cartProductId = product.sku.toLowerCase().replace(/[^a-z0-9]+/g, "-") || product.sku;
      cart[cartProductId] = (Number(cart[cartProductId]) || 0) + 1;
      window.localStorage.setItem("fanzzy-cart:guest", JSON.stringify(cart));
      window.dispatchEvent(new CustomEvent("fanzzy-cart-updated"));
      setCartActionsVisible(true);
      setAddedProducts((current) => ({ ...current, [product.sku]: true }));
      window.setTimeout(() => setAddedProducts((current) => ({ ...current, [product.sku]: false })), 1800);
    } catch {
      // Keep the product page usable if local cart storage is unavailable.
    }
  };
  const categories = useMemo(() => ["All categories", ...Array.from(new Set(products.map((product) => product.category))).sort()], [products]);
  const visible = useMemo(() => products.filter((product) => (!query || `${product.name} ${product.category} ${product.sku}`.toLowerCase().includes(query.toLowerCase())) && (category === "All categories" || product.category === category)).sort((a, b) => sort === "price-low" ? a.price - b.price : sort === "price-high" ? b.price - a.price : a.name.localeCompare(b.name)), [category, products, query, sort]);
  if (vendorLoading) return <main className="vendor-public-page" aria-busy="true"><p className="muted" role="status">Loading vendor store…</p></main>;
  if (!vendor) return <main className="vendor-public-page"><p className="vendor-error">{vendorError || "This vendor store is hidden or unavailable."}</p><a href="/vendors">View all vendors</a></main>;
  return <main className="vendor-public-page"><header className="vendor-public-header vendor-store-header"><a href="/">Back to store ↗</a></header><section className="vendor-store-hero" style={vendor.coverUrl ? { backgroundImage: `linear-gradient(90deg, rgba(38,12,23,.82), rgba(38,12,23,.15)), url(${vendor.coverUrl})` } : undefined}><div className="vendor-store-logo">{vendor.logoUrl ? <img src={vendor.logoUrl} alt="" /> : vendor.businessName.slice(0, 1)}</div><div><p className="eyebrow light">VENDOR STORE</p><h1>{vendor.businessName}</h1><p>{vendor.description}</p></div></section><section className="vendor-store-products"><div className="vendor-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this store" aria-label="Search this vendor store" /><select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter by category">{categories.map((item) => <option key={item}>{item}</option>)}</select><select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort products"><option value="newest">Sort: Name</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option></select></div><div className="vendor-product-grid">{visible.map((product) => <article className="vendor-product-card" key={product.sku}><img src={product.image || "/fanzzy-mark.png"} alt={product.name} /><p className="eyebrow">{product.category}</p><h2>{product.name}</h2><strong>₹{Number(product.price || 0).toLocaleString("en-IN")}</strong><small>Sold by: {vendor.businessName}</small><div className="vendor-product-actions"><button type="button" className={`vendor-product-cart-button${addedProducts[product.sku] ? " is-added" : ""}`} onClick={() => addToCart(product)} disabled={product.stock <= 0}>{product.stock <= 0 ? "Sold out" : addedProducts[product.sku] ? "Added to cart ✓" : "Add to cart"}</button><a href={`/?product=${encodeURIComponent(product.sku)}`}>View in store ↗</a></div></article>)}{!visible.length && <p className="muted vendor-empty-state">No products published by this vendor yet.</p>}</div></section>{cartActionsVisible && <aside className="vendor-cart-action-bar" aria-label="Cart actions"><div><p className="eyebrow">YOUR CART</p><strong>Product added to your cart</strong><span>Continue shopping or checkout now.</span></div><div className="vendor-cart-action-buttons"><a className="vendor-cart-view-button" href="/?fanzzy-cart-action=view">View cart</a><a className="vendor-cart-buy-button" href="/?fanzzy-cart-action=buy">Buy now ↗</a><button type="button" className="vendor-cart-dismiss-button" onClick={() => setCartActionsVisible(false)} aria-label="Close cart actions">×</button></div></aside>}</main>;
}
