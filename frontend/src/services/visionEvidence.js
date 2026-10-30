const STORAGE_KEY = 'airtraffic.latestVisionEvidence';
const LEGACY_STORAGE_KEY = 'hawaflow.latestVisionEvidence';

export function readLatestVisionEvidence() {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    const raw = current ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (current == null && parsed) localStorage.setItem(STORAGE_KEY, raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveLatestVisionEvidence(evidence) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(evidence));
  } catch {
    // Storage is optional: the current analysis report remains available on its page.
  }
}
