"use client";

import { useEffect, useState } from "react";

export default function StorageNotice() {
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const update = (event: Event) => setUnavailable(!(event as CustomEvent<{ persistent: boolean }>).detail.persistent);
    window.addEventListener("fanzzy-storage-persistence", update);
    return () => window.removeEventListener("fanzzy-storage-persistence", update);
  }, []);
  if (!unavailable) return null;
  return <div role="status" style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 10000, padding: "10px 16px", background: "#4b1c2b", color: "white", fontSize: 14 }}>
    Your browser cannot save this visit. Keep this tab open to retain your login and cart. Completed orders remain saved online.
  </div>;
}
