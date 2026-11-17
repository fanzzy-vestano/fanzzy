"use client";

type Props = {
  value: string;
  locations: string[];
  labels: Record<string, string>;
  loading: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  onRefresh?: () => void;
};

export default function DelhiveryPickupSelect({ value, locations, labels, loading, disabled, onChange, onRefresh }: Props) {
  const label = labels[value] || "";
  const address = label.startsWith(`${value} — `) ? label.slice(value.length + 3) : label === value ? "" : label;
  return <div className="admin-delhivery-location-field">
    <select id="delhivery-pickup-location" value={value} onChange={event => onChange(event.target.value)} disabled={disabled || loading || !locations.length} aria-describedby={address ? "delhivery-pickup-address" : undefined}>
    {loading && <option value={value}>Loading pickup locations…</option>}
    {!loading && !locations.length && <option value="">No pickup locations available</option>}
    {!loading && locations.map(location => <option key={location} value={location}>{location}</option>)}
    </select>
    {!loading && address && <p id="delhivery-pickup-address" className="admin-delhivery-pickup-address">{address}</p>}
    {onRefresh && <button className="admin-delhivery-refresh" type="button" onClick={onRefresh} disabled={loading || disabled}>{loading ? "Loading locations…" : "Refresh locations"}</button>}
  </div>;
}
