export default function BrandMark({ compact = false }) {
  return <div className={`brand ${compact ? 'brand-compact' : ''}`}>
    <img className="brand-icon-image" src="/favicon.png" alt="" aria-hidden="true" />
    {!compact && <div className="brand-wordmark"><b>UrbanSaarthi</b><small>Air Quality · Traffic Intelligence</small></div>}
  </div>;
}
