export default function PageIntro({ eyebrow, title, description, action, className = '' }) {
  return <div className={`intro ${className}`}><div><div className="eyebrow">{eyebrow}</div><h2>{title}</h2><p>{description}</p></div>{action && <div className="intro-actions">{action}</div>}</div>;
}

export function MetricCard({ label, value, detail, icon: Icon, delta, tone = '' }) {
  return <div className={`metric-card ${tone}`}><span>{Icon && <Icon size={16} />}{label}</span><b>{value ?? '—'}</b>{detail && <small>{detail}</small>}{delta && <em>{delta}</em>}</div>;
}
