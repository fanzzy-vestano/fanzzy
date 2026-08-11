"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchCatalogCategories, fetchCatalogProducts, fetchStoreSetting } from "../lib/supabase/catalog";

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
type MarketingRecord = { kind: "Campaign" | "Coupon" | "Newsletter"; name: string; detail: string; status: "Active" | "Scheduled" | "Draft"; code?: string; discount?: string };
type OrderStatus = "Processing" | "Packed" | "Shipped" | "Delivered" | "Cancelled";
type CustomerOrder = {
  id: string;
  date: string;
  status: OrderStatus;
  total: string;
  customerName: string;
  phone: string;
  email?: string;
  address?: string;
  items?: Array<{ name: string; quantity: number; price: string }>;
};
type AssistantMessage = { role: "user" | "assistant"; text: string };

const defaultProducts: Product[] = [
  { id: "aurora", name: "Aurora Drop Earrings", category: "Earrings", price: 1290, compareAt: 1690, image: "https://images.unsplash.com/photo-1635767798638-3e25273a8236?auto=format&fit=crop&w=900&q=85", hoverImage: "https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?auto=format&fit=crop&w=900&q=85", tag: "Bestseller", tone: "#d9c4bc" },
  { id: "solstice", name: "Solstice Tennis Necklace", category: "Necklaces", price: 2480, image: "https://images.unsplash.com/photo-1617038220319-276d3cfab638?auto=format&fit=crop&w=900&q=85", hoverImage: "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=900&q=85", tag: "New in", tone: "#dad7ce" },
  { id: "muse", name: "Muse Sculpted Cuff", category: "Bracelets", price: 1860, compareAt: 2200, image: "https://images.unsplash.com/photo-1611652022419-a9419f74343d?auto=format&fit=crop&w=900&q=85", hoverImage: "https://images.unsplash.com/photo-1573408301185-9146fe634ad0?auto=format&fit=crop&w=900&q=85", tag: "Limited", tone: "#d0c2b0" },
  { id: "orbital", name: "Orbital Pearl Ring", category: "Rings", price: 990, image: "https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=900&q=85", hoverImage: "https://images.unsplash.com/photo-1603561596112-0a132b757442?auto=format&fit=crop&w=900&q=85", tone: "#e5ddd1" },
  { id: "lumen", name: "Lumen Layered Chain", category: "Necklaces", price: 1680, image: "https://images.unsplash.com/photo-1599643477877-530eb83abc8e?auto=format&fit=crop&w=900&q=85", hoverImage: "https://images.unsplash.com/photo-1611652022419-a9419f74343d?auto=format&fit=crop&w=900&q=85", tag: "Bestseller", tone: "#d7c4ae" },
  { id: "halo", name: "Halo Pavé Hoops", category: "Earrings", price: 1120, compareAt: 1390, image: "https://images.unsplash.com/photo-1535632787350-4e68ef0ac584?auto=format&fit=crop&w=900&q=85", hoverImage: "https://images.unsplash.com/photo-1627293509201-cd7f7a7f8b7f?auto=format&fit=crop&w=900&q=85", tag: "Sale", tone: "#d9d3c7" },
];

const defaultCategories = [
  { name: "Earrings", count: "42 pieces", image: "https://images.unsplash.com/photo-1635767798638-3e25273a8236?auto=format&fit=crop&w=700&q=85" },
  { name: "Necklaces", count: "28 pieces", image: "https://images.unsplash.com/photo-1617038220319-276d3cfab638?auto=format&fit=crop&w=700&q=85" },
  { name: "Bracelets", count: "18 pieces", image: "https://images.unsplash.com/photo-1611652022419-a9419f74343d?auto=format&fit=crop&w=700&q=85" },
  { name: "Rings", count: "24 pieces", image: "https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=700&q=85" },
];

const formatINR = (value: number) => `₹${(Number.isFinite(value) ? value : 0).toLocaleString("en-IN")}`;
const blockedHeroImage = "photo-1599643478518-a784e5dc4c8f";
const initialHeroSlides: string[] = [];
const defaultHeroSlideDuration = 5.2;
const defaultDeliveryCharge = { enabled: false, amount: 99 };
const siteBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const siteAsset = (name: string) => `${siteBasePath}/${name}`;
const productTones = ["#d9c4bc", "#dad7ce", "#d0c2b0", "#e5ddd1"];
const formatOrderDate = (value: string) => new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00`));
const phoneDigits = (value: string) => value.replace(/\D/g, "");

function normalizeStoredProduct(value: unknown, index: number): Product | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const fallback = defaultProducts[index % defaultProducts.length];
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return null;
  const rawPrice = raw.price;
  const price = typeof rawPrice === "number" ? rawPrice : Number(String(rawPrice ?? "").replace(/[^0-9.]/g, ""));
  const image = typeof raw.image === "string" && raw.image ? raw.image : fallback.image;
  const idValue = typeof raw.id === "string" ? raw.id : typeof raw.sku === "string" ? raw.sku : `${name}-${index}`;
  return {
    id: idValue.toLowerCase().replace(/[^a-z0-9]+/g, "-") || `product-${index}`,
    name,
    category: typeof raw.category === "string" && raw.category ? raw.category : "Uncategorised",
    price: Number.isFinite(price) ? price : 0,
    compareAt: typeof raw.compareAt === "number" ? raw.compareAt : undefined,
    image,
    hoverImage: typeof raw.hoverImage === "string" && raw.hoverImage ? raw.hoverImage : image,
    tag: typeof raw.tag === "string" ? raw.tag : undefined,
    tone: typeof raw.tone === "string" && raw.tone ? raw.tone : productTones[index % productTones.length],
  };
}

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
  const [categories, setCategories] = useState(defaultCategories);
  const [activeCategory, setActiveCategory] = useState("All pieces");
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [orderLookupPhone, setOrderLookupPhone] = useState("");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([
    { role: "assistant", text: "Hi, I’m Fanzzy Assistant. I can help you find a piece, choose a gift, check an order, or answer care questions." },
  ]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutForm, setCheckoutForm] = useState({ name: "", phone: "", email: "", address: "" });
  const [quickProduct, setQuickProduct] = useState<Product | null>(null);
  const [toast, setToast] = useState("");
  const [email, setEmail] = useState("");
  const [subscribed, setSubscribed] = useState(false);
  const [announcementText, setAnnouncementText] = useState("Complimentary shipping on orders above ₹999");
  const [activeCampaign, setActiveCampaign] = useState<MarketingRecord | null>(null);
  const [heroSlides, setHeroSlides] = useState(initialHeroSlides);
  const [heroSlideIndex, setHeroSlideIndex] = useState(0);
  const [heroSlideDuration, setHeroSlideDuration] = useState(defaultHeroSlideDuration);
  const [deliveryCharge, setDeliveryCharge] = useState(defaultDeliveryCharge);

  useEffect(() => {
    const syncProducts = async () => {
      const remote = await fetchCatalogProducts();
      const stored = window.localStorage.getItem("fanzzy-products");
      let localProducts: Product[] = [];
      if (stored) {
        try {
          const parsed: unknown = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            localProducts = parsed.map(normalizeStoredProduct).filter((product): product is Product => product !== null);
          }
        } catch {
          window.localStorage.removeItem("fanzzy-products");
        }
      }
      if (!remote.error && remote.data && remote.data.length) {
        const remoteProducts = remote.data.map((product, index) => normalizeStoredProduct({
          id: product.sku,
          name: product.name,
          category: product.category,
          price: product.price,
          image: product.image,
          hoverImage: product.hoverImage || product.image,
          tag: product.tag,
          tone: product.tone,
          compareAt: product.compareAt,
        }, index)).filter((product): product is Product => product !== null);
        const merged = new Map(remoteProducts.map((product) => [product.id, product]));
        localProducts.forEach((product) => merged.set(product.id, product));
        setProducts(Array.from(merged.values()));
        return;
      }
      if (localProducts.length) setProducts(localProducts);
    };
    void syncProducts();
    window.addEventListener("storage", syncProducts);
    window.addEventListener("fanzzy-products-updated", syncProducts);
    return () => {
      window.removeEventListener("storage", syncProducts);
      window.removeEventListener("fanzzy-products-updated", syncProducts);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const syncCategories = async () => {
      const remote = await fetchCatalogCategories();
      if (active && !remote.error && remote.data && remote.data.length) {
        setCategories(remote.data.map((category, index) => ({
          name: category.name,
          count: `${category.pieces} pieces`,
          image: category.image || defaultCategories[index % defaultCategories.length].image,
        })));
        return;
      }
      const stored = window.localStorage.getItem("fanzzy-categories");
      if (!active || !stored) return;
      try {
        const parsed = JSON.parse(stored) as Array<{ name?: string; pieces?: number; image?: string }>;
        setCategories(parsed.filter((category) => category.name).map((category, index) => ({
          name: category.name!,
          count: `${category.pieces ?? 0} pieces`,
          image: category.image || defaultCategories[index % defaultCategories.length].image,
        })));
      } catch {
        window.localStorage.removeItem("fanzzy-categories");
      }
    };
    void syncCategories();
    window.addEventListener("storage", syncCategories);
    window.addEventListener("fanzzy-categories-updated", syncCategories);
    return () => {
      active = false;
      window.removeEventListener("storage", syncCategories);
      window.removeEventListener("fanzzy-categories-updated", syncCategories);
    };
  }, []);

  useEffect(() => {
    const syncOrders = () => {
      try {
        const stored = window.localStorage.getItem("fanzzy-orders");
        const parsed = stored ? JSON.parse(stored) : [];
        if (Array.isArray(parsed)) setOrders(parsed as CustomerOrder[]);
      } catch {
        setOrders([]);
      }
      const savedPhone = window.localStorage.getItem("fanzzy-customer-phone");
      if (savedPhone) setOrderLookupPhone(savedPhone);
    };
    syncOrders();
    window.addEventListener("storage", syncOrders);
    window.addEventListener("fanzzy-orders-updated", syncOrders);
    return () => {
      window.removeEventListener("storage", syncOrders);
      window.removeEventListener("fanzzy-orders-updated", syncOrders);
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
  const deliveryTotal = deliveryCharge.enabled ? deliveryCharge.amount : 0;

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    const syncAnnouncement = async () => {
      const remote = await fetchStoreSetting("announcement");
      if (!remote.error && remote.value !== null) {
        setAnnouncementText(remote.value);
        window.localStorage.setItem("fanzzy-announcement", remote.value);
        return;
      }
      const stored = window.localStorage.getItem("fanzzy-announcement");
      if (stored !== null) setAnnouncementText(stored);
    };
    void syncAnnouncement();
    window.addEventListener("storage", syncAnnouncement);
    window.addEventListener("fanzzy-announcement-updated", syncAnnouncement);
    return () => {
      window.removeEventListener("storage", syncAnnouncement);
      window.removeEventListener("fanzzy-announcement-updated", syncAnnouncement);
    };
  }, []);

  useEffect(() => {
    const syncMarketing = async () => {
      const remote = await fetchStoreSetting("marketingRecords");
      const stored = remote.value || window.localStorage.getItem("fanzzy-marketing-records");
      if (!stored) {
        setActiveCampaign(null);
        return;
      }
      try {
        const parsed = JSON.parse(stored) as MarketingRecord[];
        const active = Array.isArray(parsed) ? parsed.find((record) => record?.status === "Active" && record?.name) : null;
        setActiveCampaign(active ?? null);
      } catch {
        setActiveCampaign(null);
      }
    };
    void syncMarketing();
    window.addEventListener("storage", syncMarketing);
    window.addEventListener("fanzzy-marketing-updated", syncMarketing);
    return () => {
      window.removeEventListener("storage", syncMarketing);
      window.removeEventListener("fanzzy-marketing-updated", syncMarketing);
    };
  }, []);

  useEffect(() => {
    const syncHeroSlides = async () => {
      const remoteSlides = await fetchStoreSetting("heroSlides");
      const storedSlides = remoteSlides.value || window.localStorage.getItem("fanzzy-hero-slides");
      if (storedSlides) {
        try {
          const parsed = JSON.parse(storedSlides);
          const allowedSlides = Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0 && !value.includes(blockedHeroImage)).slice(0, 4) : [];
          if (allowedSlides.length) {
            setHeroSlides(allowedSlides);
            return;
          }
        } catch {
          window.localStorage.removeItem("fanzzy-hero-slides");
        }
      }
      const legacy = await fetchStoreSetting("heroImage");
      const storedLegacy = legacy.value || window.localStorage.getItem("fanzzy-hero-image");
      if (storedLegacy && !storedLegacy.includes(blockedHeroImage)) setHeroSlides([storedLegacy]);
    };
    void syncHeroSlides();
    window.addEventListener("storage", syncHeroSlides);
    window.addEventListener("fanzzy-hero-updated", syncHeroSlides);
    window.addEventListener("fanzzy-hero-slides-updated", syncHeroSlides);
    return () => {
      window.removeEventListener("storage", syncHeroSlides);
      window.removeEventListener("fanzzy-hero-updated", syncHeroSlides);
      window.removeEventListener("fanzzy-hero-slides-updated", syncHeroSlides);
    };
  }, []);

  useEffect(() => {
    if (!heroSlides.length) return;
    setHeroSlideIndex(0);
    const timer = window.setInterval(() => {
      setHeroSlideIndex((current) => (current + 1) % heroSlides.length);
    }, heroSlideDuration * 1000);
    return () => window.clearInterval(timer);
  }, [heroSlides, heroSlideDuration]);

  useEffect(() => {
    const syncHeroSlideDuration = async () => {
      const remote = await fetchStoreSetting("heroSlideDuration");
      const stored = remote.value || window.localStorage.getItem("fanzzy-hero-slide-duration");
      const parsed = Number(stored);
      if (Number.isFinite(parsed)) setHeroSlideDuration(Math.min(30, Math.max(2, parsed)));
    };
    void syncHeroSlideDuration();
    window.addEventListener("storage", syncHeroSlideDuration);
    window.addEventListener("fanzzy-hero-slides-updated", syncHeroSlideDuration);
    return () => {
      window.removeEventListener("storage", syncHeroSlideDuration);
      window.removeEventListener("fanzzy-hero-slides-updated", syncHeroSlideDuration);
    };
  }, []);

  useEffect(() => {
    const syncDeliveryCharge = async () => {
      const remote = await fetchStoreSetting("deliveryCharge");
      const stored = remote.value || window.localStorage.getItem("fanzzy-delivery-charge");
      if (!stored) return;
      try {
        const parsed = JSON.parse(stored) as { enabled?: boolean; amount?: number };
        setDeliveryCharge({ enabled: parsed.enabled === true, amount: Number.isFinite(parsed.amount) ? Math.max(0, parsed.amount as number) : defaultDeliveryCharge.amount });
      } catch {
        window.localStorage.removeItem("fanzzy-delivery-charge");
      }
    };
    void syncDeliveryCharge();
    window.addEventListener("storage", syncDeliveryCharge);
    window.addEventListener("fanzzy-delivery-charge-updated", syncDeliveryCharge);
    return () => {
      window.removeEventListener("storage", syncDeliveryCharge);
      window.removeEventListener("fanzzy-delivery-charge-updated", syncDeliveryCharge);
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
    announce(`${product.name} added to cart`);
  };
  const updateQuantity = (id: string, delta: number) => {
    setCart((current) => {
      const next = Math.max(0, (current[id] ?? 0) + delta);
      const updated = { ...current };
      if (next === 0) delete updated[id]; else updated[id] = next;
      return updated;
    });
  };
  const openCheckout = () => {
    if (!cartItems.length) return announce("Add a piece to your cart first");
    setCartOpen(false);
    setCheckoutOpen(true);
  };
  const submitCheckout = () => {
    const name = checkoutForm.name.trim();
    const digits = checkoutForm.phone.replace(/\D/g, "");
    if (!name) return announce("Customer name is required");
    if (digits.length < 10) return announce("A valid WhatsApp number is mandatory");
    if (!checkoutForm.address.trim()) return announce("Delivery address is required");
    const orderId = `#FZ-${String(Date.now()).slice(-6)}`;
    const newOrder: CustomerOrder = {
      id: orderId,
      date: new Date().toISOString().slice(0, 10),
      status: "Processing",
      total: formatINR(subtotal + deliveryTotal),
      customerName: name,
      phone: checkoutForm.phone.trim(),
      email: checkoutForm.email.trim(),
      address: checkoutForm.address.trim(),
      items: cartItems.map((product) => ({ name: product.name, quantity: cart[product.id] ?? 0, price: formatINR(product.price) })),
    };
    let previousOrders: unknown[] = [];
    try {
      const stored = window.localStorage.getItem("fanzzy-orders");
      const parsed = stored ? JSON.parse(stored) : [];
      if (Array.isArray(parsed)) previousOrders = parsed;
    } catch {
      previousOrders = [];
    }
    window.localStorage.setItem("fanzzy-orders", JSON.stringify([newOrder, ...previousOrders]));
    window.localStorage.setItem("fanzzy-customer-phone", checkoutForm.phone.trim());
    window.dispatchEvent(new Event("fanzzy-orders-updated"));
    setCart({});
    setCheckoutOpen(false);
    setCheckoutForm({ name: "", phone: "", email: "", address: "" });
    announce(`${orderId} placed successfully`);
  };

  const visibleOrders = useMemo(() => {
    const lookup = phoneDigits(orderLookupPhone);
    if (!lookup) return orders;
    return orders.filter((order) => {
      const orderPhone = phoneDigits(order.phone);
      return Boolean(orderPhone) && (orderPhone.endsWith(lookup) || lookup.endsWith(orderPhone));
    });
  }, [orders, orderLookupPhone]);
  const assistantReply = (message: string) => {
    const query = message.toLowerCase();
    const money = (value: number) => formatINR(value);
    const productSummary = (items: Product[]) => items.slice(0, 3).map((product) => `${product.name} (${money(product.price)})`).join(", ");
    if (/hello|hi|hey|help/.test(query)) return "I can help with almost anything in the store: latest arrivals, product suggestions, budgets, gifts, stock, a new order, order tracking, shipping, returns, payments, and jewellery care. Ask me anything.";
    if (/latest|new arrival|newest|recent|just in|arrived/.test(query)) {
      const latest = [...products].reverse().slice(0, 3);
      return latest.length ? `Our latest arrivals are ${productSummary(latest)}. Ask me about any one of them or tell me your budget.` : "There are no new arrivals loaded yet. Please check back after Admin adds the next pieces.";
    }
    if (/new order|place an order|buy|purchase|checkout|how do i order/.test(query)) return cartCount ? `You have ${cartCount} piece${cartCount === 1 ? "" : "s"} in your cart. Open Cart, choose Proceed to buy, add your details, and place the order.` : "To place a new order, open Shop, choose a piece, tap + to add it to your cart, then use Proceed to buy at checkout.";
    if (/order|track|delivery|status/.test(query)) {
      if (!orders.length) return "I don’t see an order on this device yet. Place an order first, then open My orders to track it with your WhatsApp number.";
      const latest = orders[0];
      return `Your latest order ${latest.id} is currently ${latest.status}. The total is ${latest.total}. Open My orders for the full history.`;
    }
    if (/price|cost|budget|under|below|less than/.test(query)) {
      const budget = query.match(/(?:under|below|less than|within|budget)\s*(?:₹|rs\.?\s*)?([\d,]+)/)?.[1];
      if (budget) {
        const amount = Number(budget.replace(/,/g, ""));
        const matches = products.filter((product) => product.price <= amount);
        return matches.length ? `Within ${money(amount)}, I found ${productSummary(matches)}.` : `I couldn’t find a piece under ${money(amount)} yet. Try increasing your budget or ask for our lowest-priced pieces.`;
      }
      return `Our pieces currently range from ${money(Math.min(...products.map((product) => product.price)))} to ${money(Math.max(...products.map((product) => product.price)))}. Tell me a maximum budget and I’ll filter them.`;
    }
    if (/stock|available|availability|in stock/.test(query)) {
      const available = products.filter((product) => product.price >= 0);
      return available.length ? `These pieces are currently listed in the catalog: ${productSummary(available)}. Ask me for a specific product and I’ll check its listing.` : "The catalog is updating. Please check again in a moment.";
    }
    if (/ship|deliver/.test(query)) return "We offer complimentary shipping above ₹999. Your order updates are shared using the WhatsApp number entered at checkout.";
    if (/return|exchange/.test(query)) return "Returns are accepted within 7 days for eligible unworn pieces. Keep the packaging safe and contact us if you need help with a return.";
    if (/care|clean|maintain/.test(query)) return "Keep jewellery away from perfume, water, and sprays. Store each piece separately in a soft pouch and gently wipe it after wear.";
    if (/gift|present|birthday|anniversary/.test(query)) return "For gifting, I’d start with a versatile pair of earrings or a delicate necklace. Tell me the recipient’s style or your budget and I’ll narrow it down.";
    if (/offer|discount|coupon|promo|sale/.test(query)) return "Look for the current offer banner on the storefront. You can copy an active coupon code there before checkout.";
    if (/payment|cod|cash|online|razorpay/.test(query)) return "At checkout, enter your name, WhatsApp number, email if needed, and delivery address. Available payment options are shown when the order is placed.";
    if (/category|collection|what do you sell|jewellery|jewelry/.test(query)) return "Fanzzy has earrings, necklaces, bracelets, and rings. Ask for a category or open View all categories to browse the full edit.";
    const category = ["earrings", "necklaces", "bracelets", "rings"].find((item) => query.includes(item));
    if (category) {
      const matches = products.filter((product) => product.category.toLowerCase().includes(category)).slice(0, 3);
      if (matches.length) return `Here are a few ${category} to explore: ${matches.map((product) => `${product.name} (${formatINR(product.price)})`).join(", ")}.`;
    }
    const matches = products.filter((product) => `${product.name} ${product.category}`.toLowerCase().includes(query)).slice(0, 3);
    if (matches.length) return `I found ${matches.map((product) => `${product.name} (${formatINR(product.price)})`).join(", ")}. Open the collection to take a closer look.`;
    return "I’m here to help with products, latest arrivals, budgets, gifts, new orders, order status, shipping, payments, returns, offers, and jewellery care. Try asking: ‘What’s new?’, ‘Show me rings under ₹1500’, or ‘How do I place a new order?’";
  };
  const sendAssistantMessage = (value = assistantInput) => {
    const message = value.trim();
    if (!message) return;
    setAssistantMessages((current) => [...current, { role: "user", text: message }, { role: "assistant", text: assistantReply(message) }]);
    setAssistantInput("");
  };

  return (
    <main className="site-shell" id="top">
      <div className="announcement"><strong>{announcementText}</strong><button onClick={() => { const shop = document.getElementById("shop"); if (shop) shop.scrollIntoView({ behavior: "smooth" }); else window.location.assign(`${siteBasePath}/#shop`); }}>Explore now&nbsp; ↗</button></div>

      <header className="site-header">
        <a href="#top" className="wordmark" aria-label="fanZZy home"><img src={siteAsset("fanzzy-mark.png")} alt="fanZZy" className="brand-logo" /><span className="navbar-brand-name">fanZZy</span></a>
        <nav className="desktop-nav" aria-label="Main navigation"><a href="#shop">Shop</a><a href="#categories">Collections</a><a href="#story">The journal</a><a href="#footer">About</a></nav>
        <div className="header-actions">
          <label className="navbar-search"><span aria-hidden="true">⌕</span><input readOnly placeholder="Search jewellery" onFocus={() => setSearchOpen(true)} aria-label="Open search" /></label>
          <button onClick={() => announce(`${wishlist.length} saved piece${wishlist.length === 1 ? "" : "s"}`)} aria-label="View wishlist">♡ <span className="action-label">Saved</span>{wishlist.length > 0 && <b>{wishlist.length}</b>}</button>
          <button onClick={() => setOrdersOpen(true)} aria-label="View my orders">Orders {orders.length > 0 && <b>{orders.length}</b>}</button>
          <button onClick={() => setCartOpen(true)} aria-label="Open shopping cart">Cart <span className="bag-count">({cartCount.toString().padStart(2, "0")})</span></button>
        </div>
        <button className="mobile-menu" onClick={() => setMobileNavOpen((current) => !current)} aria-label={mobileNavOpen ? "Close menu" : "Open menu"} aria-expanded={mobileNavOpen}>{mobileNavOpen ? "×" : "☰"}</button>
      </header>

      {mobileNavOpen && <div className="mobile-nav-panel" role="dialog" aria-label="Mobile navigation">
        <nav aria-label="Mobile navigation links">
          <a href="#shop" onClick={() => setMobileNavOpen(false)}>Shop <span>↗</span></a>
          <a href="#categories" onClick={() => setMobileNavOpen(false)}>Collections <span>↗</span></a>
          <a href="#story" onClick={() => setMobileNavOpen(false)}>The journal <span>↗</span></a>
          <a href="#footer" onClick={() => setMobileNavOpen(false)}>About <span>↗</span></a>
        </nav>
        <div className="mobile-nav-actions">
          <button onClick={() => { setMobileNavOpen(false); setSearchOpen(true); }}>Search the collection <span>⌕</span></button>
          <button onClick={() => { setMobileNavOpen(false); announce(`${wishlist.length} saved piece${wishlist.length === 1 ? "" : "s"}`); }}>Saved pieces <span>♡</span></button>
          <button onClick={() => { setMobileNavOpen(false); setOrdersOpen(true); }}>My orders <span>↗</span></button>
          <button onClick={() => { setMobileNavOpen(false); setCartOpen(true); }}>Your cart <span>({cartCount.toString().padStart(2, "0")})</span></button>
        </div>
      </div>}

      {heroSlides.length > 0 && <section className="hero hero-background" id="top"><div className="hero-slide-layer" key={heroSlides[heroSlideIndex]}><img src={heroSlides[heroSlideIndex]} alt="Fanzzy collection highlight" /></div></section>}

      <section className="section-block" id="categories"><div className="category-showcase"><div className="category-intro"><h2>Find your <em>signature.</em></h2><a className="text-link" href={`${siteBasePath}/collections`}>View all categories <span>↗</span></a></div><div className="category-grid">{categories.slice(0, 4).map((category, index) => <button className={`category-card category-${index + 1}`} key={category.name} onClick={() => { setActiveCategory(category.name); document.getElementById("shop")?.scrollIntoView({ behavior: "smooth" }); }}><img src={category.image} alt="" /><span className="category-overlay" /><span className="category-info"><strong>{category.name}</strong></span></button>)}</div></div></section>

      <section className="manifesto"><p className="eyebrow">THE FANZZY STANDARD</p><h2>Jewellery with a point of view.<br /><em>Made for your everyday extraordinary.</em></h2><p className="manifesto-copy">Fanzzy is a study in contrast — soft and sculptural, familiar and unexpected. Every piece is made in small batches with considered materials and a little bit of magic.</p></section>

      <section className="section-block product-section" id="shop"><div className="section-heading"><div><p className="eyebrow">CURATED FOR YOU</p><h2>Pieces worth <em>keeping.</em></h2></div><a className="text-link" href="#footer">Shop all <span>↗</span></a></div><div className="filter-row"><div className="filter-pills"><button className={activeCategory === "All pieces" ? "active" : ""} onClick={() => setActiveCategory("All pieces")}>All pieces</button>{categories.map((category) => <button className={activeCategory === category.name ? "active" : ""} key={category.name} onClick={() => setActiveCategory(category.name)}>{category.name}</button>)}</div><span className="result-count">{filteredProducts.length} pieces</span></div><div className="product-grid">{filteredProducts.map((product) => <ProductCard key={product.id} product={product} wished={wishlist.includes(product.id)} onWishlist={() => toggleWishlist(product.id)} onAdd={() => addToCart(product)} onQuickView={() => setQuickProduct(product)} />)}</div></section>

      <section className="editorial" id="story"><div className="editorial-image"><img src="https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=1100&q=85" alt="Close-up of sculptural gold jewelry" /><span>THE ART OF<br /><em>ADORNMENT</em></span></div><div className="editorial-copy"><p className="eyebrow">A NOTE FROM THE STUDIO</p><h2>Less noise.<br /><em>More meaning.</em></h2><p>There is beauty in the in-between. The way a quiet chain layers with your favourite shirt. A ring that becomes part of your hand. Fanzzy is made for these small rituals — the ones that make a day feel like yours.</p><a className="button button-dark" href="#footer">Read our story <span>↗</span></a><div className="editorial-sign">F / 19<br /></div></div></section>

      <section className="offer-banner"><div><p className="eyebrow light">{activeCampaign ? activeCampaign.kind === "Coupon" ? "EXCLUSIVE OFFER" : "SEASONAL EDIT" : "A LITTLE EXTRA"}</p><h2>{activeCampaign ? activeCampaign.name : "Your first piece"}<br /><em>{activeCampaign ? "is here." : "is on us."}</em></h2></div><div><p>{activeCampaign ? <>{activeCampaign.detail}{activeCampaign.discount && <> · <strong>{activeCampaign.discount}</strong></>}{activeCampaign.code && <> with code <strong>{activeCampaign.code}</strong></>}</> : <>Take 10% off your first order with code <strong>HELLOFANZZY</strong>.</>}</p>{activeCampaign?.code ? <button className="button button-light" onClick={() => { const code = activeCampaign.code ?? ""; navigator.clipboard?.writeText(code); announce(`Code copied: ${code}`); }}>Copy code <span>↗</span></button> : <button className="button button-light" onClick={() => { document.getElementById("shop")?.scrollIntoView({ behavior: "smooth" }); announce("Seasonal edit opened"); }}>Explore the edit <span>↗</span></button>}</div></section>

      <section className="newsletter"><div><p className="eyebrow">THE FANZZY LETTER</p><h2>A little light<br /><em>in your inbox.</em></h2></div><form onSubmit={(event) => { event.preventDefault(); if (email) setSubscribed(true); }}><p>New drops, studio notes, and 10% off your first order — no noise, promise.</p><div className="email-line"><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Your email address" aria-label="Your email address" required /><button aria-label="Subscribe to newsletter">↗</button></div>{subscribed && <span className="success-message">You’re on the list. Welcome to Fanzzy.</span>}</form></section>

      <footer className="site-footer" id="footer"><div className="footer-brand"><a href="#top" className="wordmark wordmark-light"><img src={siteAsset("fanzzy-mark.png")} alt="Fanzzy" className="brand-logo" /></a><p>Quietly remarkable jewellery<br />for all your becoming.</p></div><div><p className="eyebrow light">Explore</p><a href="#shop">New arrivals</a><a href="#shop">Bestsellers</a><a href="#categories">Collections</a><a href="#shop">Gift cards</a></div><div><p className="eyebrow light">Need a hand?</p><a href="#footer">Contact us</a><a href="#footer">Shipping & returns</a><a href="#footer">Care guide</a><a href="#footer">FAQs</a></div><div><p className="eyebrow light">Follow along</p><a href="#footer">Instagram ↗</a><a href="#footer">Pinterest ↗</a><a href="#footer">WhatsApp ↗</a><p className="footer-small">Made with intention in India.<br />© Fanzzy 2024</p></div><div className="footer-bottom"><span>Privacy</span><span>Terms</span><span>Accessibility</span><span>India / INR ₹</span></div></footer>

      <button className="whatsapp-float" onClick={() => setAssistantOpen(true)} aria-label="Open Fanzzy AI Assistant">✦ <span>Chat with AI</span></button>

      {assistantOpen && <div className="drawer-backdrop" onClick={() => setAssistantOpen(false)}><aside className="assistant-drawer" role="dialog" aria-modal="true" aria-labelledby="assistant-title" onClick={(event) => event.stopPropagation()}><div className="drawer-header"><div><p className="eyebrow">FANZZY AI</p><h2 id="assistant-title">How can I help?</h2></div><button aria-label="Close AI assistant" onClick={() => setAssistantOpen(false)}>×</button></div><div className="assistant-messages" aria-live="polite">{assistantMessages.map((message, index) => <div className={`assistant-message ${message.role}`} key={`${message.role}-${index}`}><span>{message.text}</span></div>)}</div><div className="assistant-prompts"><button onClick={() => sendAssistantMessage("Help me choose a gift")}>Choose a gift</button><button onClick={() => sendAssistantMessage("Track my order")}>Track my order</button><button onClick={() => sendAssistantMessage("How do I care for my jewellery?")}>Jewellery care</button></div><form className="assistant-form" onSubmit={(event) => { event.preventDefault(); sendAssistantMessage(); }}><input value={assistantInput} onChange={(event) => setAssistantInput(event.target.value)} placeholder="Ask Fanzzy Assistant..." aria-label="Ask Fanzzy Assistant" /><button type="submit" aria-label="Send message">↗</button></form></aside></div>}

      {searchOpen && <div className="overlay search-overlay" role="dialog" aria-modal="true" aria-label="Search"><div className="overlay-top"><span className="wordmark"><img src={siteAsset("fanzzy-mark.png")} alt="Fanzzy" className="brand-logo" /></span><button onClick={() => setSearchOpen(false)}>Close&nbsp; ×</button></div><div className="search-content"><p className="eyebrow">SEARCH THE COLLECTION</p><div className="large-search"><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Try “gold hoops”" /><span>⌕</span></div>{search && <div className="search-results">{filteredProducts.length ? filteredProducts.map((product) => <button key={product.id} onClick={() => { setQuickProduct(product); setSearchOpen(false); }}><img src={product.image} alt="" /><span><strong>{product.name}</strong><small>{product.category} · {formatINR(product.price)}</small></span><b>↗</b></button>) : <p className="muted">No pieces found. Try another search.</p>}</div>}{!search && <div className="search-suggestions"><span>Trending now</span><button onClick={() => setSearch("hoops")}>Hoops</button><button onClick={() => setSearch("pearl")}>Pearls</button><button onClick={() => setSearch("chain")}>Chains</button></div>}</div></div>}

      {ordersOpen && <div className="drawer-backdrop" onClick={() => setOrdersOpen(false)}><aside className="orders-drawer" role="dialog" aria-modal="true" aria-labelledby="orders-title" onClick={(event) => event.stopPropagation()}><div className="drawer-header"><div><p className="eyebrow">YOUR FANZZY ACCOUNT</p><h2 id="orders-title">My orders</h2></div><button aria-label="Close orders" onClick={() => setOrdersOpen(false)}>×</button></div><div className="orders-intro"><p>Track your pieces, check delivery progress, and revisit every order in one place.</p><label>WhatsApp number used at checkout<input type="tel" value={orderLookupPhone} onChange={(event) => setOrderLookupPhone(event.target.value)} placeholder="+91 98765 43210" aria-label="WhatsApp number used at checkout" /></label></div>{visibleOrders.length ? <div className="customer-order-list">{visibleOrders.map((order) => <article className="customer-order-card" key={order.id}><div className="customer-order-head"><div><strong>{order.id}</strong><small>{formatOrderDate(order.date)} · {order.customerName}</small></div><span className={`customer-order-status ${order.status.toLowerCase()}`}>{order.status}</span></div>{order.items?.length ? <div className="customer-order-items">{order.items.map((item) => <div key={`${order.id}-${item.name}`}><span>{item.name} <b>× {item.quantity}</b></span><small>{item.price}</small></div>)}</div> : <p className="customer-order-items legacy-order">Order details are available in your confirmation.</p>}<div className="customer-order-total"><span>Total paid</span><strong>{order.total}</strong></div></article>)}</div> : <div className="orders-empty"><div>✦</div><h3>No orders found yet.</h3><p>Enter the WhatsApp number used at checkout, or start with a piece from the collection.</p><button className="button button-dark" onClick={() => { setOrdersOpen(false); document.getElementById("shop")?.scrollIntoView({ behavior: "smooth" }); }}>Shop the collection <span>↗</span></button></div>}</aside></div>}

      {cartOpen && <div className="drawer-backdrop" onClick={() => setCartOpen(false)}><aside className="cart-drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-header"><div><p className="eyebrow">YOUR CART</p><h2>{cartCount ? `${cartCount} piece${cartCount > 1 ? "s" : ""}` : "A little empty"}</h2></div><button onClick={() => setCartOpen(false)}>×</button></div>{cartItems.length ? <><div className="drawer-items">{cartItems.map((product) => <div className="drawer-item" key={product.id}><img src={product.image} alt="" /><div><strong>{product.name}</strong><small>{formatINR(product.price)}</small><div className="quantity"><button onClick={() => updateQuantity(product.id, -1)}>−</button><span>{cart[product.id]}</span><button onClick={() => updateQuantity(product.id, 1)}>+</button></div></div><b>{formatINR(product.price * (cart[product.id] ?? 0))}</b></div>)}</div><div className="drawer-footer"><div><span>Subtotal</span><strong>{formatINR(subtotal)}</strong></div><div><span>Delivery</span><strong>{deliveryCharge.enabled ? formatINR(deliveryTotal) : "Free"}</strong></div><div className="drawer-total"><span>Total</span><strong>{formatINR(subtotal + deliveryTotal)}</strong></div><p>{deliveryCharge.enabled ? "Delivery charge applied to this order." : "Complimentary shipping above ₹999."}</p><button className="button button-dark full-width" onClick={openCheckout}>Proceed to buy <span>↗</span></button></div></> : <div className="empty-bag"><div>✦</div><p>Your future favourites<br />belong here.</p><button className="text-link" onClick={() => setCartOpen(false)}>Continue shopping <span>↗</span></button></div>}</aside></div>}

      {checkoutOpen && <div className="drawer-backdrop checkout-backdrop" onClick={() => setCheckoutOpen(false)}><section className="checkout-modal" role="dialog" aria-modal="true" aria-labelledby="checkout-title" onClick={(event) => event.stopPropagation()}><div className="drawer-header"><div><p className="eyebrow">CHECKOUT</p><h2 id="checkout-title">Complete your order</h2></div><button aria-label="Close checkout" onClick={() => setCheckoutOpen(false)}>×</button></div><p className="checkout-intro">We’ll use your WhatsApp number to confirm your order and delivery updates.</p><div className="checkout-grid"><label>Customer name<input value={checkoutForm.name} onChange={(event) => setCheckoutForm((current) => ({ ...current, name: event.target.value }))} placeholder="Your full name" required /></label><label>WhatsApp number <span className="required-mark">Required</span><input type="tel" value={checkoutForm.phone} onChange={(event) => setCheckoutForm((current) => ({ ...current, phone: event.target.value }))} placeholder="+91 98765 43210" required /></label><label>Email address <span className="optional-mark">Optional</span><input type="email" value={checkoutForm.email} onChange={(event) => setCheckoutForm((current) => ({ ...current, email: event.target.value }))} placeholder="you@example.com" /></label><label className="checkout-wide">Delivery address<input value={checkoutForm.address} onChange={(event) => setCheckoutForm((current) => ({ ...current, address: event.target.value }))} placeholder="House number, street, city, pincode" required /></label></div><div className="checkout-total"><span>Order total</span><strong>{formatINR(subtotal + deliveryTotal)}</strong></div><div className="checkout-actions"><button className="button button-dark" onClick={submitCheckout}>Place order <span>↗</span></button><button className="save-text" onClick={() => setCheckoutOpen(false)}>Back to cart</button></div></section></div>}

      {quickProduct && <div className="drawer-backdrop" onClick={() => setQuickProduct(null)}><div className="quick-modal" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setQuickProduct(null)}>×</button><div className="quick-image"><img src={quickProduct.image} alt={quickProduct.name} /></div><div className="quick-copy"><p className="eyebrow">{quickProduct.category}</p><h2>{quickProduct.name}</h2><div className="price-row"><span>{formatINR(quickProduct.price)}</span>{quickProduct.compareAt && <del>{formatINR(quickProduct.compareAt)}</del>}</div><p>Designed to become part of your everyday ritual. Hand-finished in small batches with a soft, lasting glow.</p><div className="quick-actions"><button className="button button-dark" onClick={() => { addToCart(quickProduct); setQuickProduct(null); }}>Add to cart <span>↗</span></button><button className="save-text" onClick={() => toggleWishlist(quickProduct.id)}>{wishlist.includes(quickProduct.id) ? "♥ Saved" : "♡ Save for later"}</button></div></div></div></div>}

      {toast && <div className="toast">{toast}<span>✦</span></div>}
    </main>
  );
}




