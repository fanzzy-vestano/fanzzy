"use client";
import { useEffect, useState } from "react";
import { ArrowRight, BadgeIndianRupee, Boxes, Clock3, Gift, Layers, Percent, Pencil, Plus, ReceiptText, Search, ShoppingCart, SlidersHorizontal, Sparkles, Trash2, Truck, UserPlus } from "lucide-react";
import { OfferDialog } from "./OfferDialog";
import SalesPromotionForm from "./SalesPromotionForm";
import type { OfferProductOption } from "./SalesPromotionForm";
import { offerTypeLabel, type PromotionOffer } from "../../lib/promotional-offers";
import { newSalesPromotion, promotionDefinition, salesPromotionBenefit, salesPromotionStatus, salesPromotionTypes, validateSalesPromotion, type SalesPromotion, type SalesPromotionStatus, type SalesPromotionType } from "../../lib/sales-promotions";
import { loadSalesPromotions, saveSalesPromotions } from "../../lib/sales-promotions-store";

const icons = [Percent, BadgeIndianRupee, SlidersHorizontal, ShoppingCart, BadgeIndianRupee, Boxes, Sparkles, Sparkles, Boxes, Layers, Truck, UserPlus, Clock3, ReceiptText, SlidersHorizontal, Layers];
const tabs = ["All", "Active", "Draft", "Scheduled", "Paused"] as const;
export default function OffersManager({ offers, products, onEdit, onToggle, onArchive, onNotify }: { offers: PromotionOffer[]; products: OfferProductOption[]; onNewBogo: () => void; onEdit: (offer: PromotionOffer) => void; onToggle: (offer: PromotionOffer) => void; onArchive: (offer: PromotionOffer) => void; onNotify: (message: string) => void }) {
  const [promotions, setPromotions] = useState<SalesPromotion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [local, setLocal] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<typeof tabs[number]>("All");
  const [chooser, setChooser] = useState(false);
  const [form, setForm] = useState<SalesPromotion | null>(null);
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const catalog = products.map((product) => ({ ...product, id: product.sku }));
  useEffect(() => { let alive = true; void loadSalesPromotions().then((result) => { if (alive) { setPromotions(result.promotions); setLocal(result.local); setLoaded(true); } }); const timer = window.setInterval(() => setNow(new Date()), 30000); return () => { alive = false; window.clearInterval(timer); }; }, []);
  const persist = async (next: SalesPromotion[], message: string) => { const result = await saveSalesPromotions(next); setPromotions(next); setLocal(result.local); onNotify(result.local ? `${message} · saved on this device` : message); };
  const save = async () => {
    if (!form || saving) return;
    const issue = validateSalesPromotion(form);
    if (issue) { setError(issue); return; }
    if (form.type === "coupon" && promotions.some((promotion) => promotion.id !== form.id && promotion.type === "coupon" && promotion.couponCode.toUpperCase() === form.couponCode.trim().toUpperCase())) { setError("This coupon code is already used by another promotion."); return; }
    if (form.productIds.some((id) => !catalog.some((product) => product.id === id)) || form.rewardProductIds.some((id) => !catalog.some((product) => product.id === id))) { setError("An eligible product is no longer in the catalog. Update the product selection."); return; }
    setSaving(true); setError("");
    const next = { ...form, name: form.name.trim(), couponCode: form.couponCode.trim().toUpperCase(), updatedAt: new Date().toISOString() };
    try { await persist([next, ...promotions.filter((promotion) => promotion.id !== form.id)], "Offer saved"); setForm(null); } catch (err) { setError((err as Error).message); } finally { setSaving(false); }
  };
  const updateStatus = async (promotion: SalesPromotion) => { if (saving) return; setSaving(true); setError(""); try { await persist(promotions.map((item) => item.id === promotion.id ? { ...item, status: (salesPromotionStatus(item) === "Active" ? "Paused" : "Active") as SalesPromotionStatus, updatedAt: new Date().toISOString() } : item), "Offer status updated"); } catch (err) { setError((err as Error).message); } finally { setSaving(false); } };
  const remove = async (promotion: SalesPromotion) => { if (saving || !window.confirm(`Delete ${promotion.name}?`)) return; setSaving(true); setError(""); try { await persist(promotions.filter((item) => item.id !== promotion.id), "Offer deleted"); } catch (err) { setError((err as Error).message); } finally { setSaving(false); } };
  const rows = [
    ...promotions.map((promotion) => ({ id: promotion.id, name: promotion.name, type: promotionDefinition(promotion.type)[1], benefit: salesPromotionBenefit(promotion), status: salesPromotionStatus(promotion, now), schedule: promotion.startTime ? `${promotion.startTime} – ${promotion.endTime}` : "All day", days: promotion.days.length === 7 ? "Every day" : promotion.days.join(" · "), dates: [promotion.startDate, promotion.endDate].filter(Boolean).join(" → "), promotion, legacy: null as PromotionOffer | null })),
    ...offers.filter((offer) => offer.status !== "Archived").map((legacy) => ({ id: legacy.id, name: legacy.name, type: "Storefront BOGO", benefit: offerTypeLabel(legacy), status: (legacy.status === "Inactive" ? "Paused" : legacy.startsAt && new Date(legacy.startsAt) > now ? "Scheduled" : legacy.endsAt && new Date(legacy.endsAt) < now ? "Paused" : "Active") as SalesPromotionStatus, schedule: "Storefront offer", days: "Product selection", dates: "", promotion: null as SalesPromotion | null, legacy })),
  ];
  const count = (status: typeof tabs[number]) => status === "All" ? rows.length : rows.filter((row) => row.status === status).length;
  const visible = rows.filter((row) => (tab === "All" || row.status === tab) && `${row.name} ${row.type} ${row.benefit}`.toLowerCase().includes(search.toLowerCase()));
  const choose = (type: SalesPromotionType) => { setChooser(false); setError(""); setForm(newSalesPromotion(type)); };
  return <div className="offers-dashboard">
    <header className="offers-heading"><div><p><Sparkles size={17} /> OFFER MANAGEMENT</p><h2>Offers &amp; promotions</h2><span>View and manage every promotion for this store.</span></div><button className="offers-primary" disabled={!loaded} onClick={() => setChooser(true)}><Plus size={18} /> New promotion</button></header>
    <div className="offers-summary">{(["All", "Active", "Draft", "Scheduled"] as const).map((status) => <span key={status}><strong>{count(status)}</strong>{status === "All" ? "Total" : status}</span>)}</div>
    <div className="offers-toolbar"><label className="offers-search"><Search size={18} /><input aria-label="Search promotions" placeholder="Search promotion, type or benefit" value={search} onChange={(event) => setSearch(event.target.value)} /></label><div className="offers-filters">{tabs.map((status) => <button key={status} aria-pressed={tab === status} className={tab === status ? "is-active" : ""} onClick={() => setTab(status)}>{status} <span>{count(status)}</span></button>)}</div></div>
    {error && !form && <p role="alert" className="offers-management-error">{error}</p>}
    <div className="offers-table-scroll"><table className="offers-table"><thead><tr>{["Promotion", "Type", "Benefit", "Schedule", "Status", "Actions"].map((title) => <th key={title}>{title}</th>)}</tr></thead><tbody>{visible.map((row) => <tr key={row.id}><td><strong>{row.name}</strong><small>OFF-{String(rows.findIndex((item) => item.id === row.id) + 1).padStart(3, "0")}</small></td><td className="offers-type-cell">{row.type}</td><td>{row.benefit}</td><td><div className="offers-schedule"><Clock3 size={16} /><span>{row.schedule}<small>{row.days}</small>{row.dates && <small>{row.dates}</small>}</span></div></td><td><span className={`offers-badge offers-${row.status.toLowerCase()}`}>{row.status}</span></td><td><div className="offers-row-actions"><button aria-label={`Edit ${row.name}`} disabled={saving} onClick={() => { setError(""); if (row.promotion) setForm({ ...row.promotion }); else onEdit(row.legacy!); }}><Pencil size={15} /> Edit</button><button disabled={saving} onClick={() => row.promotion ? void updateStatus(row.promotion) : onToggle(row.legacy!)}>{row.status === "Active" ? "Pause" : "Activate"}</button><button disabled={saving} className="offers-delete" aria-label={`Delete ${row.name}`} onClick={() => row.promotion ? void remove(row.promotion) : onArchive(row.legacy!)}><Trash2 size={16} /></button></div></td></tr>)}</tbody></table></div>
    {!visible.length && <div className="offers-empty"><Gift size={30} /><h3>{!loaded ? "Loading promotions…" : rows.length ? "No matching promotions" : "Your next great offer starts here"}</h3><p>{rows.length ? "Try another search or status filter." : "Create a promotion to reward your customers and grow your store."}</p>{loaded && !rows.length && <button className="offers-primary" onClick={() => setChooser(true)}><Plus size={17} /> New promotion</button>}</div>}
    <p className="offers-storage-note">{local ? "Local test mode · promotions are stored on this device when shared storage is unavailable." : "Eligible offers apply at customer checkout. Existing Buy 1 Get X Free selections keep their current rules."}</p>
    {chooser && <OfferDialog wide title="Choose a promotion type" eyebrow="NEW PROMOTION" onClose={() => setChooser(false)}><div className="offers-type-grid">{salesPromotionTypes.map(([type, title, description], index) => { const Icon = icons[index]; return <button key={type} className="offers-type-card" onClick={() => choose(type)}><span className={`offers-type-icon ${["bogo", "buy-x-y", "first"].includes(type) ? "gold" : ""}`}><Icon size={22} /></span><span className="offers-type-copy"><strong>{title}</strong><small title={description}>{description}</small></span><ArrowRight size={18} /></button>; })}</div></OfferDialog>}
    {form && <OfferDialog key={form.id} wide editor title={promotionDefinition(form.type)[1]} description={promotionDefinition(form.type)[2]} eyebrow={`NEW PROMOTION / ${promotionDefinition(form.type)[3]}`} onClose={() => { if (!saving) setForm(null); }}><SalesPromotionForm value={form} onChange={setForm} products={catalog} onSave={() => void save()} onCancel={() => setForm(null)} saving={saving} error={error} /></OfferDialog>}
  </div>;
}
