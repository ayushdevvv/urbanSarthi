export function sourceLabel(value, fallback = 'Configured source') {
  const text = String(value || '').trim();
  if (!text) return fallback;
  if (/synthetic-demo|scenario-sample|demo engine|demo data|demo records|synthetic demo/i.test(text)) return 'Scenario estimate';
  if (/synthetic|scenario/i.test(text)) return 'Scenario data';
  if (/osrm|openstreetmap|routing provider/i.test(text)) return 'Road-network estimate';
  if (/cpcb|caaqms/i.test(text)) return 'CPCB / CAAQMS';
  if (/gtfs/i.test(text)) return 'GTFS timetable';
  return text;
}

export function cleanScenarioText(value) {
  return String(value || '')
    .replace(/DEMO_FALLBACK:\s*/gi, '')
    .replace(/SAMPLE_FALLBACK:\s*/gi, '')
    .replace(/synthetic-demo|scenario-sample/gi, 'scenario estimate')
    .replace(/synthetic demo/gi, 'illustrative scenario')
    .replace(/\bdemo\b/gi, 'scenario')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function fallbackNotice(value) {
  return /^(SAMPLE_FALLBACK|DEMO_FALLBACK):/i.test(String(value || ''));
}
