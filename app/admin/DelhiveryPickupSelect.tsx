"use client";

type Props = {
  value: string;
  locations: string[];
  labels: Record<string, string>;
  loading: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
};

export default function DelhiveryPickupSelect({ value, locations, labels, loading, disabled, onChange }: Props) {
  return <select id="delhivery-pickup-location" value={value} onChange={event => onChange(event.target.value)} disabled={disabled || loading || !locations.length}>
    {loading && <option value={value}>Loading pickup locations…</option>}
    {!loading && !locations.length && <option value="">No pickup locations available</option>}
    {!loading && locations.map(location => <option key={location} value={location}>{labels[location] || location}</option>)}
  </select>;
}
