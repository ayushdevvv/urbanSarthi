import { LoaderCircle } from 'lucide-react';
import './premium-loading-screen.css';

export default function PremiumLoadingScreen({
  title = 'Preparing your workspace',
  detail = 'Connecting to the latest operations data.',
}) {
  return <section className="premium-loading-screen" role="status" aria-live="polite" aria-label={title}>
    <div className="premium-loading-card">
      <div className="premium-loading-mark" aria-hidden="true">
        <span className="premium-loading-orbit orbit-one" />
        <span className="premium-loading-orbit orbit-two" />
        <span className="premium-loading-core"><LoaderCircle size={30} strokeWidth={1.8}/></span>
      </div>
      <div className="premium-loading-brand">URBANSAARTHI</div>
      <h2>{title}</h2>
      <p>{detail}</p>
      <div className="premium-loading-track" aria-hidden="true"><i /></div>
    </div>
  </section>;
}
