import Link from "next/link";

export default function NotFound() {
  return (
    <main className="tracking-page">
      <section className="tracking-card" aria-labelledby="not-found-title">
        <div className="tracking-card-intro">
          <p className="eyebrow">FANZZY</p>
          <h1 id="not-found-title">Page not <em>found.</em></h1>
          <p>The link may be old or incomplete. The storefront and account pages are still available.</p>
          <Link href="/" className="button button-dark">Return to Fanzzy <span>↗</span></Link>
        </div>
      </section>
    </main>
  );
}
