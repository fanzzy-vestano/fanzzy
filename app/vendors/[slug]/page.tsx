import VendorStorePage from "./vendor-store-page";

// Vendor slugs are supplied by the live API. GitHub Pages has no server-side
// rewrites, so it must not attempt to pre-render an unbounded dynamic route.
export function generateStaticParams() {
  return [];
}

export default function VendorStoreRoute() {
  return <VendorStorePage />;
}
