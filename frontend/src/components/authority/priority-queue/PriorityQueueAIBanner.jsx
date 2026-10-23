import { Bot, ShieldAlert } from 'lucide-react';

export default function PriorityQueueAIBanner({ meta }) {
  const groqConfigured = Boolean(meta?.groq_configured);

  return (
    <section className="pq-ai-banner" aria-label="AI triage status">
      <div className="pq-ai-icon"><Bot size={23} aria-hidden="true" /></div>
      <div className="pq-ai-copy">
        <div className="pq-ai-heading">
          AI-assisted triage
          <span className={`pq-ai-status ${groqConfigured ? 'ready' : 'fallback'}`}>
            <i aria-hidden="true" />
            {groqConfigured ? 'Groq key configured' : 'Rules fallback active'}
          </span>
        </div>
        <p>
          {groqConfigured
            ? `Groq triage is configured for ${meta.model}; provider availability is checked per request and failures fall back to rules. Only the title, details and category are sent after basic contact/secret redaction. Avoid personal or confidential data. Results are advisory and require human review.`
            : 'Connect GROQ_API_KEY on the backend for semantic triage. Until then, transparent severity keywords produce a deterministic fallback priority. Only report title, details and category are sent; common contact details are redacted, but never enter personal or confidential data.'}
        </p>
      </div>
      <div className="pq-ai-side"><ShieldAlert size={15} aria-hidden="true" /><span>Human approval<br />required</span></div>
    </section>
  );
}
