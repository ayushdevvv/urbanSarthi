export default function BrandMark({ compact = false }) {
  return <div className={`brand ${compact ? 'brand-compact' : ''}`} aria-label="UrbanSaarthi">
    <span className="brand-icon"><img src="/urbansaarthi-logo.png" alt="" width="42" height="42" /></span>
    {!compact && <div className="brand-wordmark"><b>UrbanSaarthi</b><small>City mobility intelligence</small></div>}
  </div>;
}
