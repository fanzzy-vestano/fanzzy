import "../globals.css";

const siteBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const siteAsset = (name: string) => `${siteBasePath}/${name}`;

const collections = [
  { name: "Earrings", count: "42 pieces", image: "https://images.unsplash.com/photo-1635767798638-3e25273a8236?auto=format&fit=crop&w=900&q=85" },
  { name: "Necklaces", count: "28 pieces", image: "https://images.unsplash.com/photo-1617038220319-276d3cfab638?auto=format&fit=crop&w=900&q=85" },
  { name: "Bracelets", count: "18 pieces", image: "https://images.unsplash.com/photo-1611652022419-a9419f74343d?auto=format&fit=crop&w=900&q=85" },
  { name: "Rings", count: "24 pieces", image: "https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=900&q=85" },
];

export default function CollectionsPage() {
  return <main className="site-shell collections-page">
    <div className="announcement"><strong>Complimentary shipping on orders above ₹999</strong><a href={`${siteBasePath}/#shop`}>Explore now&nbsp; ↗</a></div>
    <header className="site-header">
      <a href={`${siteBasePath}/`} className="wordmark" aria-label="Fanzzy home"><img src={siteAsset("fanzzy-mark.png")} alt="Fanzzy" className="brand-logo" /><span className="navbar-brand-name">fanzzy</span></a>
      <nav className="desktop-nav" aria-label="Main navigation"><a href={`${siteBasePath}/#shop`}>Shop</a><a className="active-nav" href={`${siteBasePath}/collections`}>Collections</a><a href={`${siteBasePath}/#story`}>The journal</a><a href={`${siteBasePath}/#footer`}>About</a></nav>
      <div className="header-actions"><a className="admin-link" href={`${siteBasePath}/admin/`}>Admin</a><a href={`${siteBasePath}/#shop`}>Bag <span className="bag-count">(00)</span></a></div>
    </header>
    <section className="collections-intro"><p className="eyebrow">THE FANZZY COLLECTIONS</p><h1>Find your <em>signature.</em></h1><p>Four ways to make the everyday feel entirely yours. Explore the pieces that meet your mood.</p><a className="button button-dark" href={`${siteBasePath}/#shop`}>Shop the full edit <span>↗</span></a></section>
    <section className="collections-grid" aria-label="Fanzzy collections">{collections.map((collection, index) => <a className={`category-card collection-card category-${index + 1}`} key={collection.name} href={`${siteBasePath}/#shop`}><img src={collection.image} alt={collection.name} /><span className="category-overlay" /><span className="category-info"><strong>{collection.name}</strong><small>{collection.count}</small></span></a>)}</section>
    <footer className="collections-footer"><a href={`${siteBasePath}/`} className="text-link">← Back to Fanzzy</a><span>Made with intention in India.</span></footer>
  </main>;
}
