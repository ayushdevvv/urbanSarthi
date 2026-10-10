export default function BrandMark({ compact = false }) {
  return <div className={`brand ${compact ? 'brand-compact' : ''}`}>
    <img className="brand-icon-image" src="/urbansaarthi-mark.svg" alt="" aria-hidden="true" />
    {!compact && <div className="brand-wordmark"><b>UrbanSaarthi</b><small>City intelligence for everyone</small></div>}
  </div>;
}
