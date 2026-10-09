import { BarChart3 } from 'lucide-react';

export default function BrandMark({ compact = false }) {
  return <div className={`brand ${compact ? 'brand-compact' : ''}`}><div className="brand-icon"><BarChart3 size={22} strokeWidth={2.5} /></div>{!compact && <div><b>UrbanSaarthi</b><small>India urban<br className="authority-break"/> intelligence</small></div>}</div>;
}
