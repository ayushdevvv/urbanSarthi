export default function BrandMark({ compact = false }) {
  return <div className={`brand ${compact ? 'brand-compact' : ''}`}>
    <svg className="brand-icon-image" viewBox="0 0 64 64" role="img" aria-label="UrbanSaarthi logo">
      <defs><linearGradient id="urbanSaarthiGradient" x1="8" y1="6" x2="56" y2="60"><stop stopColor="#D6F49B"/><stop offset="1" stopColor="#A6D85B"/></linearGradient></defs>
      <rect x="2" y="2" width="60" height="60" rx="18" fill="#123F35"/>
      <path d="M14 39.5 25.5 28l8 7.5L49.5 19" stroke="url(#urbanSaarthiGradient)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <path d="M39 19h10.5v10.5" stroke="url(#urbanSaarthiGradient)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <path d="M14 47h36" stroke="#EAF4E0" strokeOpacity=".65" strokeWidth="3" strokeLinecap="round"/>
    </svg>
    {!compact && <div className="brand-wordmark"><b>UrbanSaarthi</b><small>City intelligence for everyone</small></div>}
  </div>;
}
