import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Compass,
  Cpu,
  Layers,
  LocateFixed,
  MapPin,
  Navigation,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  Wind,
} from 'lucide-react';
import CityMap from '../../components/maps/CityMap.jsx';
import { api } from '../../services/api/client.js';
import './agent-page.css';

const CITY_PRESETS = [
  { name: 'Delhi NCR', lat: 28.6139, lon: 77.2090 },
  { name: 'Bengaluru', lat: 12.9716, lon: 77.5946 },
  { name: 'Mumbai', lat: 19.0760, lon: 72.8777 },
  { name: 'Pune', lat: 18.5204, lon: 73.8567 },
  { name: 'Hyderabad', lat: 17.3850, lon: 78.4867 },
  { name: 'Kolkata', lat: 22.5726, lon: 88.3639 },
];

const SAMPLE_PROMPTS = [
  'Connaught Place traffic',
  'What is the air quality near my location?',
  'Best route from CP to ITO',
  'Traffic around Silk Board in Bengaluru',
  'Cleanest route from CP to India Gate',
  'Signal strategy for congested corridors',
];

const POPULAR_DESTINATIONS = [
  { name: 'ITO, New Delhi', lat: 28.6287, lon: 77.2411 },
  { name: 'India Gate', lat: 28.6129, lon: 77.2295 },
  { name: 'Connaught Place', lat: 28.6315, lon: 77.2167 },
  { name: 'Marathahalli (BLR)', lat: 12.9591, lon: 77.6974 },
  { name: 'Whitefield (BLR)', lat: 12.9698, lon: 77.7499 },
  { name: 'BKC (Mumbai)', lat: 19.0657, lon: 72.8687 },
];

export default function AgentPage({ adminMode = false }) {
  const [query, setQuery] = useState('Best route from CP to ITO');
  const [selectedCity, setSelectedCity] = useState(CITY_PRESETS[0]);
  const [latitude, setLatitude] = useState(CITY_PRESETS[0].lat);
  const [longitude, setLongitude] = useState(CITY_PRESETS[0].lon);
  const [destLat, setDestLat] = useState('');
  const [destLon, setDestLon] = useState('');
  const [mode, setMode] = useState(adminMode ? 'authority' : 'citizen');

  const [loading, setLoading] = useState(false);
  const [agentStatus, setAgentStatus] = useState(null);
  const [agentResult, setAgentResult] = useState(null);
  const [error, setError] = useState('');
  const [showTrace, setShowTrace] = useState(true);

  // Fetch agent status on load
  useEffect(() => {
    let active = true;
    api.get('/agent/status')
      .then((res) => { if (active) setAgentStatus(res); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  // Update coordinates when city preset changes
  const handleCityChange = (cityName) => {
    const preset = CITY_PRESETS.find((c) => c.name === cityName);
    if (preset) {
      setSelectedCity(preset);
      setLatitude(preset.lat);
      setLongitude(preset.lon);
    }
  };

  // Run Agent
  const handleAnalyze = useCallback(async (customQuery, customDestLat, customDestLon) => {
    const q = (customQuery !== undefined ? customQuery : query).trim();
    if (!q) {
      setError('Please enter a query or choose a sample prompt.');
      return;
    }

    setLoading(true);
    setError('');

    const targetDestLat = customDestLat !== undefined ? customDestLat : (destLat ? Number(destLat) : null);
    const targetDestLon = customDestLon !== undefined ? customDestLon : (destLon ? Number(destLon) : null);

    try {
      const payload = {
        query: q,
        latitude: Number(latitude),
        longitude: Number(longitude),
        dest_latitude: targetDestLat,
        dest_longitude: targetDestLon,
        mode: mode,
      };

      const res = await api.post('/agent/analyze', payload);
      setAgentResult(res);
      if (res?.coordinates?.destination) {
        setDestLat(res.coordinates.destination[0]);
        setDestLon(res.coordinates.destination[1]);
      }
    } catch (err) {
      setError(err?.message || 'Agent analysis could not be completed.');
    } finally {
      setLoading(false);
    }
  }, [query, latitude, longitude, destLat, destLon, mode]);

  // Run initial analysis once on mount
  useEffect(() => {
    handleAnalyze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detect GPS Location
  const handleUseLocation = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(Number(pos.coords.latitude.toFixed(4)));
        setLongitude(Number(pos.coords.longitude.toFixed(4)));
      },
      () => setError('Could not access your location. Permission denied.')
    );
  };

  // Extract tools from result
  const trafficResult = agentResult?.agent_steps?.find((s) => s.tool === 'get_traffic_snapshot')?.result;
  const aqiResult = agentResult?.agent_steps?.find((s) => s.tool === 'get_aqi_snapshot')?.result;
  const routeResult = agentResult?.agent_steps?.find((s) => s.tool === 'analyze_routes')?.result;
  const signalResult = agentResult?.agent_steps?.find((s) => s.tool === 'recommend_signal_strategy')?.result;

  const isRouteNeedsDest = routeResult?.status === 'needs_destination';

  // Map markers and routes
  const mapMarkers = [];
  if (latitude && longitude) {
    mapMarkers.push({
      lat: latitude,
      lng: longitude,
      title: 'Origin / Monitored Location',
      kind: 'normal',
    });
  }
  if (routeResult?.destination?.latitude && routeResult?.destination?.longitude) {
    mapMarkers.push({
      lat: routeResult.destination.latitude,
      lng: routeResult.destination.longitude,
      title: 'Destination',
      kind: 'critical',
    });
  }

  const mapRouteOptions = (routeResult?.routes || []).map((r, idx) => ({
    id: r.id,
    color: r.recommended ? '#82a94f' : idx === 1 ? '#5d91c7' : '#9b74b8',
    coordinates: (r.geometry?.coordinates || []).map((pt) => ({ lat: pt[1], lng: pt[0] })),
    selected: r.recommended,
  }));

  const recommendedRoute = routeResult?.routes?.find((r) => r.recommended);
  const primaryRouteCoords = (recommendedRoute?.geometry?.coordinates || []).map((pt) => ({
    lat: pt[1],
    lng: pt[0],
  }));

  return (
    <div className="agent-page-container">
      {/* Header Banner */}
      <div className="agent-header-card">
        <div className="agent-header-left">
          <div className="agent-avatar-icon">
            <Bot size={28} />
          </div>
          <div className="agent-titles">
            <h1>Traffic & Air Intelligence</h1>
            <p>
              Rule-based reasoning engine coordinating SUMO traffic simulations, Open-Meteo CAMS atmospheric data, and road corridor route advisors without third-party LLM key lock-in.
            </p>
          </div>
        </div>

        <div className="agent-status-badges">
          <div
            className={`provenance-pill ${
              agentResult?.data_mode === 'live'
                ? 'live'
                : agentResult?.data_mode === 'sumo_model'
                ? 'sumo'
                : 'mixed'
            }`}
          >
            <Sparkles size={13} />
            <span>{agentResult?.data_mode_label || '⚡ SUMO Traffic Model · 🌐 Open-Meteo'}</span>
          </div>
          <div className="city-indicator-pill">
            Region: <b>{agentResult?.city || selectedCity.name}</b>
          </div>
        </div>
      </div>

      {/* Query Bar & Controls */}
      <div className="agent-query-card">
        <form
          className="agent-search-bar"
          onSubmit={(e) => {
            e.preventDefault();
            handleAnalyze();
          }}
        >
          <input
            className="agent-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask anything about traffic, pollution, or route planning (e.g. 'Best route from CP to ITO')"
          />
          <button type="submit" className="agent-submit-btn" disabled={loading}>
            {loading ? <RefreshCw size={16} className="spin" /> : <Send size={16} />}
            <span>Analyze</span>
          </button>
        </form>

        {/* Chips */}
        <div className="agent-chips-row">
          <span className="chips-label">Sample Prompts:</span>
          {SAMPLE_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              className="sample-chip"
              onClick={() => {
                setQuery(prompt);
                handleAnalyze(prompt);
              }}
            >
              {prompt}
            </button>
          ))}
        </div>

        {/* Context Controls */}
        <div className="agent-context-toolbar">
          <div className="context-controls-left">
            <div className="context-group">
              <Compass size={14} />
              <span>City:</span>
              <select
                value={selectedCity.name}
                onChange={(e) => handleCityChange(e.target.value)}
              >
                {CITY_PRESETS.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="context-group">
              <MapPin size={14} />
              <span>Origin:</span>
              <input
                type="number"
                step="0.0001"
                style={{ width: '85px' }}
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
                placeholder="Lat"
              />
              <input
                type="number"
                step="0.0001"
                style={{ width: '85px' }}
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
                placeholder="Lon"
              />
              <button
                type="button"
                className="icon-utility-btn"
                onClick={handleUseLocation}
                title="Use current GPS location"
              >
                <LocateFixed size={12} />
                <span>GPS</span>
              </button>
            </div>

            <div className="context-group">
              <Navigation size={14} />
              <span>Dest:</span>
              <input
                type="number"
                step="0.0001"
                style={{ width: '85px' }}
                value={destLat}
                onChange={(e) => setDestLat(e.target.value)}
                placeholder="Dest Lat"
              />
              <input
                type="number"
                step="0.0001"
                style={{ width: '85px' }}
                value={destLon}
                onChange={(e) => setDestLon(e.target.value)}
                placeholder="Dest Lon"
              />
            </div>
          </div>

          <div className="mode-toggle-group">
            <button
              type="button"
              className={`mode-btn ${mode === 'citizen' ? 'active' : ''}`}
              onClick={() => setMode('citizen')}
            >
              Citizen
            </button>
            <button
              type="button"
              className={`mode-btn ${mode === 'authority' ? 'active' : ''}`}
              onClick={() => setMode('authority')}
            >
              Authority
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="notice notice-error">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Results Container */}
      {agentResult && (
        <>
          {/* Executive Summary */}
          <div className="agent-summary-panel">
            <div className="summary-heading">
              <Sparkles size={18} color="#82a94f" />
              <span>Agent Analysis & Intelligence Brief</span>
            </div>
            <div className="summary-markdown-content">{agentResult.summary}</div>
          </div>

          {/* Structured Recommendations Cards */}
          {agentResult.recommendations?.length > 0 && (
            <div className="recommendations-grid">
              {agentResult.recommendations.map((rec, idx) => (
                <div
                  key={`${rec.title}-${idx}`}
                  className={`recommendation-card priority-${rec.priority || 'medium'}`}
                >
                  <div className="rec-header">
                    <span className="rec-icon">{rec.icon}</span>
                    <span className="rec-title">{rec.title}</span>
                  </div>
                  <div className="rec-text">{rec.text}</div>
                  {rec.action && <div className="rec-action">{rec.action}</div>}
                </div>
              ))}
            </div>
          )}

          {/* Missing Destination Banner (Issue 4 Handling) */}
          {isRouteNeedsDest && (
            <div className="needs-destination-banner">
              <div className="needs-dest-title">
                <AlertCircle size={18} />
                <span>Destination Coordinates Required for Route Analysis</span>
              </div>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--text)' }}>
                You requested route advice, but no destination coordinates were provided. Select a common landmark below to immediately compute the cleanest and fastest alternatives:
              </p>
              <div className="needs-dest-chips">
                {POPULAR_DESTINATIONS.map((dest) => (
                  <button
                    key={dest.name}
                    type="button"
                    className="landmark-select-btn"
                    onClick={() => {
                      setDestLat(dest.lat);
                      setDestLon(dest.lon);
                      handleAnalyze(undefined, dest.lat, dest.lon);
                    }}
                  >
                    <MapPin size={12} />
                    <span>{dest.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Route Comparison Panel + Map */}
          {routeResult?.routes?.length > 0 && (
            <div className="tool-result-panel">
              <div className="panel-title-bar">
                <h3>
                  <Navigation size={17} color="#5d91c7" />
                  <span>Route Alternatives & Pollution Exposure</span>
                </h3>
                <span className="status-pill">{routeResult.data_mode_label}</span>
              </div>

              {/* Map */}
              <div style={{ height: '320px', position: 'relative' }}>
                <CityMap
                  city={agentResult.city || selectedCity.name}
                  markers={mapMarkers}
                  route={primaryRouteCoords}
                  routeOptions={mapRouteOptions}
                  zoom={12}
                />
              </div>

              {/* Route Options Comparison */}
              <div className="routes-comparison-container">
                {routeResult.routes.map((r) => (
                  <div
                    key={r.id}
                    className={`route-card ${r.recommended ? 'is-recommended' : ''}`}
                  >
                    {r.recommended && (
                      <span className="route-badge-recommended">Recommended</span>
                    )}
                    <div className="route-name">{r.name}</div>
                    <div className="route-desc">{r.description}</div>
                    <div className="route-stats-chips">
                      <div className="route-stat-chip">
                        <span>⏱️ {r.estimated_duration_min} min</span>
                      </div>
                      <div className="route-stat-chip">
                        <span>📏 {r.distance_km} km</span>
                      </div>
                      <div className="route-stat-chip">
                        <span>🚦 Congestion: {r.congestion_level} ({r.congestion_score}/100)</span>
                      </div>
                      <div className="route-stat-chip">
                        <span>🌫️ AQI Exposure: {r.aqi_exposure} ({r.aqi_category})</span>
                      </div>
                      <div className="route-stat-chip">
                        <span>🌿 Est. CO₂: {r.co2_estimate_g}g</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Traffic Snapshot Panel */}
          {trafficResult && (
            <div className="tool-result-panel">
              <div className="panel-title-bar">
                <h3>
                  <Activity size={17} color="#8fac4e" />
                  <span>Traffic Corridor Dynamics · {trafficResult.city || selectedCity.name}</span>
                </h3>
                <span className="status-pill">{trafficResult.data_mode_label}</span>
              </div>

              <div className="kpi-metrics-row">
                <div className="kpi-cell">
                  <span>Congestion Score</span>
                  <b>{trafficResult.summary?.mean_congestion_score}/100 ({trafficResult.summary?.congestion_level})</b>
                </div>
                <div className="kpi-cell">
                  <span>Vehicles Monitored</span>
                  <b>{trafficResult.summary?.total_vehicles?.toLocaleString?.() || '—'}</b>
                </div>
                <div className="kpi-cell">
                  <span>Heavy Corridors</span>
                  <b>{trafficResult.summary?.heavy_roads_now || 0}</b>
                </div>
                <div className="kpi-cell">
                  <span>30-Min Queue Trend</span>
                  <b>{trafficResult.summary?.queue_change_percent > 0 ? `+${trafficResult.summary.queue_change_percent}%` : `${trafficResult.summary?.queue_change_percent}%`}</b>
                </div>
              </div>

              {trafficResult.roads?.length > 0 && (
                <table className="road-corridors-table">
                  <thead>
                    <tr>
                      <th>Corridor</th>
                      <th>Level Now</th>
                      <th>Score</th>
                      <th>Vehicles</th>
                      <th>30-Min Outlook</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trafficResult.roads.map((rd, i) => (
                      <tr key={`${rd.road}-${i}`}>
                        <td><b>{rd.road}</b></td>
                        <td>
                          <span
                            style={{
                              fontWeight: 700,
                              color:
                                rd.congestion_level === 'Severe'
                                  ? '#ce6257'
                                  : rd.congestion_level === 'High'
                                  ? '#d9a642'
                                  : rd.congestion_level === 'Moderate'
                                  ? '#bca03f'
                                  : '#7bb58b',
                            }}
                          >
                            {rd.congestion_level}
                          </span>
                        </td>
                        <td>{rd.congestion_score}/100</td>
                        <td>{rd.vehicle_count}</td>
                        <td>{rd.predicted_level_30min}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* AQI Snapshot Panel */}
          {aqiResult && (
            <div className="tool-result-panel">
              <div className="panel-title-bar">
                <h3>
                  <Wind size={17} color="#5599c7" />
                  <span>Atmospheric & Air Quality Snapshot</span>
                </h3>
                <span className="status-pill">{aqiResult.data_mode_label}</span>
              </div>

              <div className="kpi-metrics-row">
                <div className="kpi-cell">
                  <span>Air Quality Index</span>
                  <b>{aqiResult.current?.us_aqi} ({aqiResult.current?.category})</b>
                </div>
                <div className="kpi-cell">
                  <span>Dominant Pollutant</span>
                  <b>{aqiResult.current?.dominant_pollutant || 'PM2.5'}</b>
                </div>
                <div className="kpi-cell">
                  <span>PM2.5 Concentration</span>
                  <b>{aqiResult.current?.pm25_ug_m3} µg/m³</b>
                </div>
                <div className="kpi-cell">
                  <span>PM10 Concentration</span>
                  <b>{aqiResult.current?.pm10_ug_m3} µg/m³</b>
                </div>
              </div>

              {aqiResult.health_advice && (
                <div style={{ padding: '14px 20px', fontSize: '13px', color: 'var(--text)', background: 'var(--surface2)' }}>
                  <b>Health Advice: </b>{aqiResult.health_advice}
                </div>
              )}
            </div>
          )}

          {/* Signal Strategy Panel (if present) */}
          {signalResult && (
            <div className="tool-result-panel">
              <div className="panel-title-bar">
                <h3>
                  <Cpu size={17} color="#d9a642" />
                  <span>Signal Timing Advisory · {signalResult.strategy_label}</span>
                </h3>
                <span className="status-pill">Cycle: {signalResult.recommended_cycle_seconds}s</span>
              </div>

              <div className="kpi-metrics-row">
                <div className="kpi-cell">
                  <span>Recommended Cycle</span>
                  <b>{signalResult.recommended_cycle_seconds} seconds</b>
                </div>
                <div className="kpi-cell">
                  <span>Expected Queue Reduction</span>
                  <b>{signalResult.expected_queue_reduction_pct}%</b>
                </div>
                <div className="kpi-cell">
                  <span>Priority Corridor</span>
                  <b>{signalResult.priority_direction}</b>
                </div>
              </div>

              <div className="phase-bars-container">
                <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>
                  Phase Allocation Breakdown
                </span>
                {(signalResult.phases || []).map((ph, idx) => (
                  <div key={idx} className="phase-bar-row">
                    <span>{ph.movement}</span>
                    <div className="phase-track">
                      <div
                        className="phase-fill"
                        style={{
                          width: `${(ph.green_seconds / signalResult.recommended_cycle_seconds) * 100}%`,
                        }}
                      />
                    </div>
                    <b>{ph.green_seconds}s green</b>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Reasoning Steps & Tool Trace */}
          <div className="agent-trace-panel">
            <div
              className="trace-header"
              style={{ cursor: 'pointer' }}
              onClick={() => setShowTrace(!showTrace)}
            >
              <div className="trace-title">
                <Brain size={18} color="#8fac4e" />
                <span>Agent Execution Chain & Tool Selection Trace</span>
                <span className="status-pill">{agentResult.tools_called?.length} tools invoked</span>
              </div>
              <button
                type="button"
                className="icon-utility-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowTrace(!showTrace);
                }}
              >
                {showTrace ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                <span>{showTrace ? 'Hide Trace' : 'View Trace'}</span>
              </button>
            </div>

            {showTrace && (
              <div className="trace-steps-container">
                {agentResult.agent_steps?.map((step) => (
                  <div
                    key={step.step}
                    className={`trace-step-item ${step.status}`}
                  >
                    <div className="step-number-circle">
                      {step.status === 'success' ? (
                        <CheckCircle2 size={16} color="#7bb58b" />
                      ) : step.status === 'needs_destination' ? (
                        <AlertCircle size={16} color="#d9a642" />
                      ) : (
                        step.step
                      )}
                    </div>
                    <div className="step-body">
                      <div className="step-meta-row">
                        <div className="step-tool-name">
                          <Layers size={14} />
                          <span>{step.tool_label}</span>
                        </div>
                        <span className="status-pill">{step.data_mode_label}</span>
                      </div>
                      <div className="step-thought">{step.thought}</div>
                      <div className="step-result-snippet">{step.result_summary}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
