"use client";

import { useEffect } from "react";
import "../../globals.css";
import "../vendor.css";

export default function VendorLoginRedirect() {
  useEffect(() => { window.location.replace("/vendor"); }, []);
  return <main className="vendor-login-page"><p>Opening vendor login…</p></main>;
}
