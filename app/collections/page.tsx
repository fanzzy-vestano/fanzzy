"use client";

import { useEffect, useState } from "react";
import { countCatalogProductsByCategory, fetchCatalogCategories, fetchCatalogProducts, inferLegacyCategorySections, type CatalogCategorySection } from "../../lib/supabase/catalog";
import "../globals.css";

const siteBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const siteAsset = (name: string) => `${siteBasePath}/${name}`;

type Collection = { name: string; count: string; image: string; section: CatalogCategorySection };
const defaultCollections: Collection[] = [
  { name: "Earrings", count: "42 pieces", image: "https://images.unsplash.com/photo-1635767798638-3e25273a8236?auto=format&fit=crop&w=900&q=85", section: "normal" },
  { name: "Necklaces", count: "28 pieces", image: "https://images.unsplash.com/photo-1617038220319-276d3cfab638?auto=format&fit=crop&w=900&q=85", section: "normal" },
  { name: "Bracelets", count: "18 pieces", image: "https://images.unsplash.com/photo-1611652022419-a9419f74343d?auto=format&fit=crop&w=900&q=85", section: "normal" },
  { name: "Rings", count: "24 pieces", image: "https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=900&q=85", section: "normal" },
];
const collectionImageFallbacks: Record<string, string> = Object.fromEntries(defaultCollections.map((collection) => [collection.name.toLowerCase(), collection.image]));
const collectionImageFallback = (name: string, index: number) =>
  collectionImageFallbacks[name.trim().toLowerCase()] || defaultCollections[index % defaultCollections.length].image;

export default function CollectionsPage() {
  const [collections, setCollections] = useState(defaultCollections);
  const [productCounts, setProductCounts] = useState<Record<string, number> | null>(null);
  const [activeSection, setActiveSection] = useState<CatalogCategorySection | null>(null);

  useEffect(() => {
    const syncCollections = async () => {
      const stored = window.localStorage.getItem("fanzzy-categories");
      const productsRemote = await fetchCatalogProducts();
      if (productsRemote.data) setProductCounts(countCatalogProductsByCategory(productsRemote.data));
      let localCollections: Collection[] = [];
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as Array<{ name?: string; pieces?: number; image?: string; section?: CatalogCategorySection }>;
          localCollections = parsed.filter((category) => category.name).map((category, index) => ({
            name: category.name!,
            count: `${category.pieces ?? 0} pieces`,
            image: category.image || collectionImageFallback(category.name!, index),
            section: category.section || "normal",
          }));
        } catch {
          window.localStorage.removeItem("fanzzy-categories");
        }
      }
      const remote = await fetchCatalogCategories();
      if (!remote.error && remote.data?.length) {
        const localCollectionByName = new Map(localCollections.map((collection) => [collection.name.trim().toLowerCase(), collection]));
        const remoteCollections = remote.data.map((category, index) => ({
          name: category.name,
          count: `${category.pieces} pieces`,
          image: category.image || collectionImageFallback(category.name, index),
          section: localCollectionByName.get(category.name.trim().toLowerCase())?.section || category.section || "normal",
        }));
        const remoteNames = new Set(remoteCollections.map((collection) => collection.name.trim().toLowerCase()));
        setCollections(inferLegacyCategorySections([...remoteCollections, ...localCollections.filter((collection) => !remoteNames.has(collection.name.trim().toLowerCase()))]));
        return;
      }
      if (localCollections.length) setCollections(localCollections);
    };
    void syncCollections();
    window.addEventListener("storage", syncCollections);
    window.addEventListener("fanzzy-categories-updated", syncCollections);
    return () => {
      window.removeEventListener("storage", syncCollections);
      window.removeEventListener("fanzzy-categories-updated", syncCollections);
    };
  }, []);

  useEffect(() => {
    const syncActiveSection = () => {
      const hash = window.location.hash.slice(1);
      setActiveSection(hash === "luxury" || hash === "normal" ? hash : null);
    };
    syncActiveSection();
    window.addEventListener("hashchange", syncActiveSection);
    return () => window.removeEventListener("hashchange", syncActiveSection);
  }, []);

  const collectionGroups = (["normal", "luxury"] as CatalogCategorySection[]).map((section) => ({
    section,
    collections: collections.filter((collection) => collection.section === section),
  })).filter(({ section }) => !activeSection || section === activeSection);

  return <main className="site-shell collections-page">
    <div className="announcement"><strong>Complimentary shipping on orders above ₹999</strong><a href={`${siteBasePath}/#shop`}>Explore now&nbsp; ↗</a></div>
    <header className="site-header">
      <a href={`${siteBasePath}/`} className="wordmark" aria-label="Fanzzy home"><img src={siteAsset("fanzzy-mark.png")} alt="Fanzzy" className="brand-logo" /><span className="navbar-brand-name">fanzzy</span></a>
      <nav className="desktop-nav" aria-label="Main navigation"><a href={`${siteBasePath}/#shop`}>Shop</a><a className="active-nav" href={`${siteBasePath}/collections`}>Collections</a><a href={`${siteBasePath}/#story`}>The journal</a><a href={`${siteBasePath}/#footer`}>About</a></nav>
      <div className="header-actions"><a className="admin-link" href={`${siteBasePath}/admin/`}>Admin</a><a href={`${siteBasePath}/#shop`}>Bag <span className="bag-count">(00)</span></a></div>
    </header>
    <section className="collections-intro"><p className="eyebrow">THE FANZZY COLLECTIONS</p><h1>Find your <em>signature.</em></h1><p>Explore every category and find the pieces that meet your mood.</p><a className="button button-dark" href={`${siteBasePath}/#shop`}>Shop the full edit <span>↗</span></a></section>
    <section className="collections-grid" aria-label="Fanzzy collections">{collectionGroups.map(({ section, collections: sectionCollections }) => sectionCollections.length ? <div className="collection-group" id={section} key={section}><div className="collection-group-heading"><h2>{section === "luxury" ? "Luxury Category" : "Everyday Collection"}</h2></div><div className="collection-group-grid">{sectionCollections.map((collection, index) => <a className={`category-card collection-card category-${index + 1}`} key={collection.name} href={`${siteBasePath}/?category=${encodeURIComponent(collection.name)}#shop`}><img src={collection.image || collectionImageFallback(collection.name, index)} alt={collection.name} /><span className="category-overlay" /><span className="category-info"><strong>{collection.name}</strong><small>{productCounts ? `${productCounts[collection.name.trim().toLowerCase()] || 0} pieces` : collection.count}</small></span></a>)}</div></div> : null)}</section>
    <footer className="collections-footer"><a href={`${siteBasePath}/`} className="text-link">← Back to Fanzzy</a><span>Made with intention in India.</span></footer>
  </main>;
}
