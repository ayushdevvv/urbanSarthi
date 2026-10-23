import { Sparkles, X } from 'lucide-react';

export default function CreatePriorityQueueItemModal({ form, setForm, onClose, onSubmit, saving }) {
  return (
    <div className="modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="pq-create-modal" role="dialog" aria-modal="true" aria-labelledby="pq-create-title">
        <div className="pq-modal-head">
          <div>
            <span className="eyebrow">NEW INTAKE</span>
            <h3 id="pq-create-title">Add operational report</h3>
            <p>AI will rank this report. No commands are sent to city infrastructure.</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <form onSubmit={onSubmit} className="pq-form">
          <label>
            Report title
            <input required minLength={4} maxLength={180} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="e.g. Signal failure at Ring Road crossing" autoFocus />
          </label>
          <label>
            Details
            <textarea rows={4} maxLength={2500} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="What happened, potential impact, available evidence…" />
          </label>
          <div className="pq-form-grid">
            <label>
              Category
              <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
                <option value="traffic">Traffic</option>
                <option value="air_quality">Air quality</option>
                <option value="public_transport">Public transport</option>
                <option value="infrastructure">Infrastructure</option>
                <option value="safety">Public safety</option>
                <option value="operations">Operations</option>
              </select>
            </label>
            <label>
              Source
              <select value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })}>
                <option value="operator">Operator</option>
                <option value="citizen_report">Citizen report</option>
                <option value="camera_review">Camera review</option>
                <option value="sensor">Sensor / feed</option>
                <option value="import">Imported</option>
              </select>
            </label>
          </div>
          <label>Location<input maxLength={180} value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Junction, road, station or area" /></label>
          <div className="pq-modal-actions">
            <button type="button" className="utility" onClick={onClose}>Cancel</button>
            <button className="primary" type="submit" disabled={saving}>
              {saving ? 'Scoring report…' : <><Sparkles size={15} aria-hidden="true" /> Create and triage</>}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
