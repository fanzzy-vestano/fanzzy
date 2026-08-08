"use client";

import { useEffect, useMemo, useState } from "react";

type Product = {
  id: string;
  name: string;
  category: string;
  price: number;
  compareAt?: number;
  image: string;
  hoverImage: string;
  tag?: string;
  tone: string;
};

const defaultProducts: Product[] = [
  { id: "aurora", name: "Aurora Drop Earrings", category: "Earrings", price: 1290, compareAt: 1690, image: "https://images.unsplash.com/photo-1635767798638-3e25273a8236?auto=format&fit=crop&w=900&q=85", hoverImage: "https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?auto=format&fit=crop&w=900&q=85", tag: "Bestseller", tone: "#d9c4bc" },
  { id: "solstice", name: "Solstice Tennis Necklace", category: "Necklaces", price: 2480, image: "https://images.unsplash.com/photo-1617038220319-276d3cfab638?auto=format&fit=crop&w=900&q=85", hoverImage: "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=900&q=85", tag: "New in", tone: "#dad7ce" },
  { id: "muse", name: "Muse Sculpted Cuff", category: "Bracelets", price: 1860, compareAt: 2200, image: "https://images.unsplash.com/photo-1611652022419-a9419f74343d?auto=format&fit=crop&w=900&q=85", hoverImage: "https://images.unsplash.com/photo-1573408301185-9146fe634ad0?auto=format&fit=crop&w=900&q=85", tag: "Limited", tone: "#d0c2b0" },
  { id: "orbital", name: "Orbital Pearl Ring", category: "Rings", price: 990, image: "https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=900&q=85", hoverImage: "https://images.unsplash.com/photo-1603561596112-0a132b757442?auto=format&fit=crop&w=900&q=85", tone: "#e5ddd1" },
  { id: "lumen", name: "Lumen Layered Chain", category: "Necklaces", price: 1680, image: "https://images.unsplash.com/photo-1599643477877-530eb83abc8e?auto=format&fit=crop&w=900&q=85", hoverImage: "https://images.unsplash.com/photo-1611652022419-a9419f74343d?auto=format&fit=crop&w=900&q=85", tag: "Bestseller", tone: "#d7c4ae" },
  { id: "halo", name: "Halo Pavé Hoops", category: "Earrings", price: 1120, compareAt: 1390, image: "https://images.unsplash.com/photo-1535632787350-4e68ef0ac584?auto=format&fit=crop&w=900&q=85", hoverImage: "https://images.unsplash.com/photo-1627293509201-cd7f7a7f8b7f?auto=format&fit=crop&w=900&q=85", tag: "Sale", tone: "#d9d3c7" },
];

const categories = [
  { name: "Earrings", count: "42 pieces", image: "https://images.unsplash.com/photo-1635767798638-3e25273a8236?auto=format&fit=crop&w=700&q=85" },
  { name: "Necklaces", count: "28 pieces", image: "https://images.unsplash.com/photo-1617038220319-276d3cfab638?auto=format&fit=crop&w=700&q=85" },
  { name: "Bracelets", count: "18 pieces", image: "https://images.unsplash.com/photo-1611652022419-a9419f74343d?auto=format&fit=crop&w=700&q=85" },
  { name: "Rings", count: "24 pieces", image: "https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=700&q=85" },
];

const formatINR = (value: number) => `₹${value.toLocaleString("en-IN")}`;
const defaultHeroImage = "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=1200&q=90";

function ProductCard({ product, wished, onWishlist, onAdd, onQuickView }: { product: Product; wished: boolean; onWishlist: () => void; onAdd: () => void; onQuickView: () => void }) {
  return (
    <article className="product-card">
      <div className="product-media" style={{ backgroundColor: product.tone }}>
        <img className="product-image primary-image" src={product.image} alt={product.name} />
        <img className="product-image hover-image" src={product.hoverImage} alt="" aria-hidden="true" />
        {product.tag && <span className="product-tag">{product.tag}</span>}
        <button className={`wishlist-button ${wished ? "is-wished" : ""}`} onClick={onWishlist} aria-label={wished ? `Remove ${product.name} from wishlist` : `Add ${product.name} to wishlist`}>{wished ? "♥" : "♡"}</button>
        <button className="quick-view" onClick={onQuickView}>Quick view <span>↗</span></button>
      </div>
      <div className="product-meta">
        <div>
          <p className="eyebrow">{product.category}</p>
          <h3>{product.name}</h3>
        </div>
        <button className="add-icon" onClick={onAdd} aria-label={`Add ${product.name} to cart`}>+</button>
      </div>
      <div className="price-row"><span>{formatINR(product.price)}</span>{product.compareAt && <del>{formatINR(product.compareAt)}</del>}</div>
    </article>
  );
}

export default function Home() {
  const [products, setProducts] = useState<Product[]>(defaultProducts);
  const [activeCategory, setActiveCategory] = useState("All pieces");
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [quickProduct, setQuickProduct] = useState<Product | null>(null);
  const [toast, setToast] = useState("");
  const [email, setEmail] = useState("");
  const [subscribed, setSubscribed] = useState(false);
  const [announcementText, setAnnouncementText] = useState("Complimentary shipping on orders above ₹999");
  const [heroImage, setHeroImage] = useState(defaultHeroImage);

  useEffect(() => {
    const syncProducts = () => {
      const stored = window.localStorage.getItem("fanzzy-products");
      if (!stored) return;
      try {
        const parsed = JSON.parse(stored) as Product[];
        if (Array.isArray(parsed)) setProducts(parsed);
      } catch {
        window.localStorage.removeItem("fanzzy-products");
      }
    };
    syncProducts();
    window.addEventListener("storage", syncProducts);
    window.addEventListener("fanzzy-products-updated", syncProducts);
    return () => {
      window.removeEventListener("storage", syncProducts);
      window.removeEventListener("fanzzy-products-updated", syncProducts);
    };
  }, []);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((product) => {
      const categoryMatch = activeCategory === "All pieces" || product.category === activeCategory;
      const searchMatch = !query || `${product.name} ${product.category}`.toLowerCase().includes(query);
      return categoryMatch && searchMatch;
    });
  }, [activeCategory, products, search]);

  const cartItems = products.filter((product) => cart[product.id]);
  const cartCount = Object.values(cart).reduce((sum, count) => sum + count, 0);
  const subtotal = cartItems.reduce((sum, product) => sum + product.price * (cart[product.id] ?? 0), 0);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    const syncAnnouncement = () => {
      const stored = window.localStorage.getItem("fanzzy-announcement");
      if (stored !== null) setAnnouncementText(stored);
    };
    syncAnnouncement();
    window.addEventListener("storage", syncAnnouncement);
    window.addEventListener("fanzzy-announcement-updated", syncAnnouncement);
    return () => {
      window.removeEventListener("storage", syncAnnouncement);
      window.removeEventListener("fanzzy-announcement-updated", syncAnnouncement);
    };
  }, []);

  useEffect(() => {
    const syncHeroImage = () => {
      const stored = window.localStorage.getItem("fanzzy-hero-image");
      if (stored) setHeroImage(stored);
    };
    syncHeroImage();
    window.addEventListener("storage", syncHeroImage);
    window.addEventListener("fanzzy-hero-updated", syncHeroImage);
    return () => {
      window.removeEventListener("storage", syncHeroImage);
      window.removeEventListener("fanzzy-hero-updated", syncHeroImage);
    };
  }, []);

  const announce = (message: string) => setToast(message);
  const toggleWishlist = (id: string) => {
    setWishlist((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    announce(wishlist.includes(id) ? "Removed from wishlist" : "Saved to wishlist");
  };
  const addToCart = (product: Product) => {
    setCart((current) => ({ ...current, [product.id]: (current[product.id] ?? 0) + 1 }));
    setCartOpen(true);
    announce(`${product.name} added to bag`);
  };
  const updateQuantity = (id: string, delta: number) => {
    setCart((current) => {
      const next = Math.max(0, (current[id] ?? 0) + delta);
      const updated = { ...current };
      if (next === 0) delete updated[id]; else updated[id] = next;
      return updated;
    });
  };

  return (
    <main className="site-shell">
      <div className="announcement"><strong>{announcementText}</strong><button onClick={() => announce("Announcement link selected")}>Explore now&nbsp; ↗</button></div>

      <header className="site-header">
        <a href="#top" className="wordmark" aria-label="Fanzzy home"><img src="/fanzzy-mark.png" alt="Fanzzy" className="brand-logo" /></a>
        <nav className="desktop-nav" aria-label="Main navigation"><a href="#shop">Shop</a><a href="#categories">Collections</a><a href="#story">The journal</a><a href="#footer">About</a></nav>
        <div className="header-actions">
          <button onClick={() => setSearchOpen(true)} aria-label="Open search">Search</button>
          <a href="/admin" className="admin-link">Admin</a>
          <button onClick={() => announce(`${wishlist.length} saved piece${wishlist.length === 1 ? "" : "s"}`)} aria-label="View wishlist">♡ <span className="action-label">Saved</span>{wishlist.length > 0 && <b>{wishlist.length}</b>}</button>
          <button onClick={() => setCartOpen(true)} aria-label="Open shopping bag">Bag <span className="bag-count">({cartCount.toString().padStart(2, "0")})</span></button>
        </div>
        <button className="mobile-menu" onClick={() => announce("Menu is ready for the next step")}>☰</button>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy"><p className="eyebrow light">A QUIET KIND OF RADIANCE</p><h1>Make room<br /><em>for wonder.</em></h1><p className="hero-description">Hand-finished pieces designed to catch the light — and keep it.</p><a className="button button-light" href="#shop">Shop the edit <span>↗</span></a></div>
        <div className="hero-art"><div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" /><div className="hero-arch"><img src={heroImage} alt="Gold necklace arranged on a warm stone surface" /></div><span className="hero-note">01 / 03<br /><i>new collection</i></span></div>
        <div className="hero-bottom"><span>Scroll to discover</span><span className="scroll-line" /></div>
      </section>

      <section className="manifesto"><p className="eyebrow">THE FANZZY STANDARD</p><h2>Jewellery with a point of view.<br /><em>Made for your everyday extraordinary.</em></h2><p className="manifesto-copy">Fanzzy is a study in contrast — soft and sculptural, familiar and unexpected. Every piece is made in small batches with considered materials and a little bit of magic.</p></section>

      <section className="section-block" id="categories"><div className="section-heading"><div><p className="eyebrow">SHOP BY MOOD</p><h2>Find your <em>signature.</em></h2></div><a className="text-link" href="#shop">View all categories <span>↗</span></a></div><div className="category-grid">{categories.map((category, index) => <button className={`category-card category-${index + 1}`} key={category.name} onClick={() => { setActiveCategory(category.name); document.getElementById("shop")?.scrollIntoView({ behavior: "smooth" }); }}><img src={category.image} alt="" /><span className="category-overlay" /><span className="category-info"><strong>{category.name}</strong></span></button>)}</div></section>

      <section className="section-block product-section" id="shop"><div className="section-heading"><div><p className="eyebrow">CURATED FOR YOU</p><h2>Pieces worth <em>keeping.</em></h2></div><a className="text-link" href="#footer">Shop all <span>↗</span></a></div><div className="filter-row"><div className="filter-pills"><button className={activeCategory === "All pieces" ? "active" : ""} onClick={() => setActiveCategory("All pieces")}>All pieces</button>{categories.map((category) => <button className={activeCategory === category.name ? "active" : ""} key={category.name} onClick={() => setActiveCategory(category.name)}>{category.name}</button>)}</div><span className="result-count">{filteredProducts.length} pieces</span></div><div className="product-grid">{filteredProducts.map((product) => <ProductCard key={product.id} product={product} wished={wishlist.includes(product.id)} onWishlist={() => toggleWishlist(product.id)} onAdd={() => addToCart(product)} onQuickView={() => setQuickProduct(product)} />)}</div></section>

      <section className="editorial" id="story"><div className="editorial-image"><img src="https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=1100&q=85" alt="Close-up of sculptural gold jewelry" /><span>THE ART OF<br /><em>ADORNMENT</em></span></div><div className="editorial-copy"><p className="eyebrow">A NOTE FROM THE STUDIO</p><h2>Less noise.<br /><em>More meaning.</em></h2><p>There is beauty in the in-between. The way a quiet chain layers with your favourite shirt. A ring that becomes part of your hand. Fanzzy is made for these small rituals — the ones that make a day feel like yours.</p><a className="button button-dark" href="#footer">Read our story <span>↗</span></a><div className="editorial-sign">F / 19<br /></div></div></section>

      <section className="offer-banner"><div><p className="eyebrow light">A LITTLE EXTRA</p><h2>Your first piece<br /><em>is on us.</em></h2></div><div><p>Take 10% off your first order with code <strong>HELLOFANZZY</strong>.</p><button className="button button-light" onClick={() => { navigator.clipboard?.writeText("HELLOFANZZY"); announce("Code copied: HELLOFANZZY"); }}>Copy code <span>↗</span></button></div></section>

      <section className="newsletter"><div><p className="eyebrow">THE FANZZY LETTER</p><h2>A little light<br /><em>in your inbox.</em></h2></div><form onSubmit={(event) => { event.preventDefault(); if (email) setSubscribed(true); }}><p>New drops, studio notes, and 10% off your first order — no noise, promise.</p><div className="email-line"><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Your email address" aria-label="Your email address" required /><button aria-label="Subscribe to newsletter">↗</button></div>{subscribed && <span className="success-message">You’re on the list. Welcome to Fanzzy.</span>}</form></section>

      <footer className="site-footer" id="footer"><div className="footer-brand"><a href="#top" className="wordmark wordmark-light"><img src="/fanzzy-mark.png" alt="Fanzzy" className="brand-logo" /></a><p>Quietly remarkable jewellery<br />for all your becoming.</p></div><div><p className="eyebrow light">Explore</p><a href="#shop">New arrivals</a><a href="#shop">Bestsellers</a><a href="#categories">Collections</a><a href="#shop">Gift cards</a></div><div><p className="eyebrow light">Need a hand?</p><a href="#footer">Contact us</a><a href="#footer">Shipping & returns</a><a href="#footer">Care guide</a><a href="#footer">FAQs</a></div><div><p className="eyebrow light">Follow along</p><a href="#footer">Instagram ↗</a><a href="#footer">Pinterest ↗</a><a href="#footer">WhatsApp ↗</a><p className="footer-small">Made with intention in India.<br />© Fanzzy 2024</p></div><div className="footer-bottom"><span>Privacy</span><span>Terms</span><span>Accessibility</span><span>India / INR ₹</span></div></footer>

      <button className="whatsapp-float" onClick={() => announce("We'll be in touch shortly")}>✦ <span>Chat with us</span></button>

      {searchOpen && <div className="overlay search-overlay" role="dialog" aria-modal="true" aria-label="Search"><div className="overlay-top"><span className="wordmark"><img src="/fanzzy-mark.png" alt="Fanzzy" className="brand-logo" /></span><button onClick={() => setSearchOpen(false)}>Close&nbsp; ×</button></div><div className="search-content"><p className="eyebrow">SEARCH THE COLLECTION</p><div className="large-search"><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Try “gold hoops”" /><span>⌕</span></div>{search && <div className="search-results">{filteredProducts.length ? filteredProducts.map((product) => <button key={product.id} onClick={() => { setQuickProduct(product); setSearchOpen(false); }}><img src={product.image} alt="" /><span><strong>{product.name}</strong><small>{product.category} · {formatINR(product.price)}</small></span><b>↗</b></button>) : <p className="muted">No pieces found. Try another search.</p>}</div>}{!search && <div className="search-suggestions"><span>Trending now</span><button onClick={() => setSearch("hoops")}>Hoops</button><button onClick={() => setSearch("pearl")}>Pearls</button><button onClick={() => setSearch("chain")}>Chains</button></div>}</div></div>}

      {cartOpen && <div className="drawer-backdrop" onClick={() => setCartOpen(false)}><aside className="cart-drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-header"><div><p className="eyebrow">YOUR BAG</p><h2>{cartCount ? `${cartCount} piece${cartCount > 1 ? "s" : ""}` : "A little empty"}</h2></div><button onClick={() => setCartOpen(false)}>×</button></div>{cartItems.length ? <><div className="drawer-items">{cartItems.map((product) => <div className="drawer-item" key={product.id}><img src={product.image} alt="" /><div><strong>{product.name}</strong><small>{formatINR(product.price)}</small><div className="quantity"><button onClick={() => updateQuantity(product.id, -1)}>−</button><span>{cart[product.id]}</span><button onClick={() => updateQuantity(product.id, 1)}>+</button></div></div><b>{formatINR(product.price * (cart[product.id] ?? 0))}</b></div>)}</div><div className="drawer-footer"><div><span>Subtotal</span><strong>{formatINR(subtotal)}</strong></div><p>Shipping calculated at checkout. Complimentary shipping above ₹999.</p><button className="button button-dark full-width" onClick={() => announce("Checkout is ready to connect")}>Begin checkout <span>↗</span></button></div></> : <div className="empty-bag"><div>✦</div><p>Your future favourites<br />belong here.</p><button className="text-link" onClick={() => setCartOpen(false)}>Continue shopping <span>↗</span></button></div>}</aside></div>}

      {quickProduct && <div className="drawer-backdrop" onClick={() => setQuickProduct(null)}><div className="quick-modal" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setQuickProduct(null)}>×</button><div className="quick-image"><img src={quickProduct.image} alt={quickProduct.name} /></div><div className="quick-copy"><p className="eyebrow">{quickProduct.category}</p><h2>{quickProduct.name}</h2><div className="price-row"><span>{formatINR(quickProduct.price)}</span>{quickProduct.compareAt && <del>{formatINR(quickProduct.compareAt)}</del>}</div><p>Designed to become part of your everyday ritual. Hand-finished in small batches with a soft, lasting glow.</p><div className="quick-actions"><button className="button button-dark" onClick={() => { addToCart(quickProduct); setQuickProduct(null); }}>Add to bag <span>↗</span></button><button className="save-text" onClick={() => toggleWishlist(quickProduct.id)}>{wishlist.includes(quickProduct.id) ? "♥ Saved" : "♡ Save for later"}</button></div></div></div></div>}

      {toast && <div className="toast">{toast}<span>✦</span></div>}
    </main>
  );
}




