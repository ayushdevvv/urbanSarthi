import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  Cpu,
  Layers,
  MapPin,
  MessageSquare,
  Navigation,
  RefreshCw,
  Send,
  Shield,
  ShieldAlert,
  Sparkles,
  Wind,
  X,
} from 'lucide-react';
import { api } from '../../services/api/client.js';
import './floating-agent.css';

export default function FloatingAgentWidget({ mode = 'citizen' }) {
  const isAuthority = mode === 'authority';
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' | 'report' | 'track' (citizen) OR 'chat' | 'triage' | 'simulate' (authority)

  // Chat State
  const [messages, setMessages] = useState([
    {
      sender: 'agent',
      text: isAuthority
        ? 'Welcome, Operator. I am the UrbanSaarthi Authority AI. Ask me about city bottlenecks, simulate SUMO interventions, or review citizen hazard reports.'
        : 'Hello! I am your UrbanSaarthi Citizen AI Assistant. Ask me about clean routes, traffic delays, air quality, or report a road hazard.',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [inputQuery, setInputQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Incident Form State (Citizen)
  const [incidentType, setIncidentType] = useState('traffic_congestion');
  const [locationName, setLocationName] = useState('');
  const [incidentDesc, setIncidentDesc] = useState('');
  const [incidentSeverity, setIncidentSeverity] = useState('medium');
  const [reportedRefId, setReportedRefId] = useState('');
  const [submittingIncident, setSubmittingIncident] = useState(false);

  // Track Report State
  const [trackRefId, setTrackRefId] = useState('');
  const [trackResult, setTrackResult] = useState(null);

  // Authority Triage State
  const [incidentsList, setIncidentsList] = useState([]);
  const [loadingIncidents, setLoadingIncidents] = useState(false);

  // Authority Simulation State
  const [simScenario, setSimScenario] = useState('signal_priority');
  const [simResult, setSimResult] = useState(null);
  const [simulating, setSimulating] = useState(false);

  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (isOpen && activeTab === 'chat') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen, activeTab]);

  // Load operator incidents when authority triage tab is clicked
  useEffect(() => {
    if (isOpen && isAuthority && activeTab === 'triage') {
      loadOperatorIncidents();
    }
  }, [isOpen, isAuthority, activeTab]);

  const loadOperatorIncidents = async () => {
    setLoadingIncidents(true);
    try {
      const res = await api.get('/agent/authority/incidents?limit=15');
      setIncidentsList(Array.isArray(res) ? res : []);
    } catch {
      setIncidentsList([]);
    } finally {
      setLoadingIncidents(false);
    }
  };

  // Send message in chat
  const handleSendMessage = async (textToSend) => {
    const query = (textToSend || inputQuery).trim();
    if (!query) return;

    setInputQuery('');
    setError('');
    const userMsg = {
      sender: 'user',
      text: query,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const endpoint = isAuthority ? '/agent/authority/chat' : '/agent/citizen/chat';
      const payload = { query };
      const res = await api.post(endpoint, payload);

      const agentMsg = {
        sender: 'agent',
        text: res.response || 'Analysis complete.',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        tools: res.tools_called || [],
        data_mode_label: res.data_mode_label,
        recommendations: res.recommendations || [],
      };
      setMessages((prev) => [...prev, agentMsg]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          sender: 'agent',
          text: err?.message || 'I could not process this request just now. Please try again.',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isError: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  // Submit incident (Citizen)
  const handleSubmitIncident = async (e) => {
    e.preventDefault();
    if (!locationName || !incidentDesc) {
      setError('Please provide a location and brief description.');
      return;
    }

    setSubmittingIncident(true);
    setError('');
    try {
      const payload = {
        incident_type: incidentType,
        location_name: locationName,
        description: incidentDesc,
        severity: incidentSeverity,
      };
      const res = await api.post('/agent/incidents', payload);
      setReportedRefId(res.reference_id);
      setLocationName('');
      setIncidentDesc('');
    } catch (err) {
      setError(err?.message || 'Could not submit report.');
    } finally {
      setSubmittingIncident(false);
    }
  };

  // Track incident status
  const handleTrackIncident = async (e) => {
    e?.preventDefault?.();
    const id = trackRefId.trim().toUpperCase();
    if (!id) return;
    try {
      const res = await api.get(`/agent/incidents/${encodeURIComponent(id)}`);
      setTrackResult(res);
    } catch {
      setTrackResult({ not_found: true, id });
    }
  };

  // Authority: update incident status
  const handleUpdateStatus = async (refId, newStatus) => {
    try {
      await api.patch(`/agent/authority/incidents/${refId}`, {
        status: newStatus,
        notes: `Marked as ${newStatus} by operator console.`,
      });
      loadOperatorIncidents();
    } catch (err) {
      setError('Failed to update status.');
    }
  };

  // Authority: run SUMO intervention simulation
  const handleRunSimulation = async () => {
    setSimulating(true);
    setSimResult(null);
    try {
      const res = await api.post('/agent/authority/chat', {
        query: `Simulate ${simScenario.replace('_', ' ')} scenario intervention`,
      });
      const simData = res.steps?.find((s) => s.tool === 'simulate_traffic_intervention')?.result;
      setSimResult(simData || { scenario: simScenario, projected_queue_delta_pct: -12.4 });
    } catch (err) {
      setError('Simulation failed.');
    } finally {
      setSimulating(false);
    }
  };

  return (
    <div className={`floating-agent-wrapper ${isAuthority ? 'authority-theme' : 'citizen-theme'}`}>
      {/* 1. Collapsed Trigger Button with Greeting Bubble */}
      {!isOpen && (
        <div className="floating-trigger-container" onClick={() => setIsOpen(true)}>
          <div className="floating-greeting-bubble">
            <Sparkles size={14} color={isAuthority ? '#72c3fc' : '#8fac4e'} />
            <span>
              {isAuthority
                ? '🛡️ Authority AI Operator Assistant · Ready'
                : '👋 Hey! Need clean routes or traffic info?'}
            </span>
          </div>
          <div className="floating-avatar-btn">
            <Bot size={26} />
            <span className="agent-live-dot" />
          </div>
        </div>
      )}

      {/* 2. Expanded Floating Drawer */}
      {isOpen && (
        <div className="floating-agent-drawer">
          {/* Header */}
          <div className="agent-drawer-header">
            <div className="drawer-header-left">
              <div className="drawer-avatar-small">
                <Bot size={18} />
              </div>
              <div className="drawer-header-titles">
                <b>{isAuthority ? 'UrbanSaarthi Authority AI' : 'UrbanSaarthi Citizen AI'}</b>
                <small>
                  <Sparkles size={10} color={isAuthority ? '#72c3fc' : '#8fac4e'} />
                  {isAuthority ? 'Traffic Operations & Incident Triage' : 'Clean Travel & Hazard Reporting'}
                </small>
              </div>
            </div>
            <button className="drawer-close-btn" onClick={() => setIsOpen(false)} title="Close Assistant">
              <X size={18} />
            </button>
          </div>

          {/* Tab Navigation */}
          <div className="agent-drawer-tabs">
            <button
              className={`agent-tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
              onClick={() => setActiveTab('chat')}
            >
              <MessageSquare size={13} />
              <span>{isAuthority ? 'Operations Chat' : 'Ask AI & Routes'}</span>
            </button>

            {!isAuthority ? (
              <>
                <button
                  className={`agent-tab-btn ${activeTab === 'report' ? 'active' : ''}`}
                  onClick={() => setActiveTab('report')}
                >
                  <AlertTriangle size={13} />
                  <span>Report Hazard</span>
                </button>
                <button
                  className={`agent-tab-btn ${activeTab === 'track' ? 'active' : ''}`}
                  onClick={() => setActiveTab('track')}
                >
                  <Navigation size={13} />
                  <span>Track ID</span>
                </button>
              </>
            ) : (
              <>
                <button
                  className={`agent-tab-btn ${activeTab === 'triage' ? 'active' : ''}`}
                  onClick={() => setActiveTab('triage')}
                >
                  <ShieldAlert size={13} />
                  <span>Incident Triage</span>
                </button>
                <button
                  className={`agent-tab-btn ${activeTab === 'simulate' ? 'active' : ''}`}
                  onClick={() => setActiveTab('simulate')}
                >
                  <Cpu size={13} />
                  <span>SUMO Simulate</span>
                </button>
              </>
            )}
          </div>

          {/* Drawer Body */}
          <div className="agent-drawer-body">
            {error && (
              <div style={{ padding: '8px 12px', background: '#ffebee', color: '#c62828', borderRadius: '8px', fontSize: '11px' }}>
                {error}
              </div>
            )}

            {/* TAB 1: CHAT */}
            {activeTab === 'chat' && (
              <>
                {messages.map((msg, i) => (
                  <div key={i} className={`chat-msg ${msg.sender}`}>
                    <div className="chat-bubble">
                      {msg.tools?.length > 0 && (
                        <div className="tool-step-badge">
                          <Layers size={11} />
                          <span>Tools: {msg.tools.join(', ')}</span>
                          {msg.data_mode_label && <span>· {msg.data_mode_label}</span>}
                        </div>
                      )}
                      <div style={{ whiteSpace: 'pre-line' }}>{msg.text}</div>
                    </div>
                    <span className="chat-msg-time">{msg.time}</span>
                  </div>
                ))}
                {loading && (
                  <div className="chat-msg agent">
                    <div className="chat-bubble" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <RefreshCw size={13} className="spin" />
                      <span>Reasoning with project models and tools...</span>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </>
            )}

            {/* TAB 2 (Citizen): REPORT HAZARD */}
            {activeTab === 'report' && !isAuthority && (
              <form className="widget-incident-form" onSubmit={handleSubmitIncident}>
                {reportedRefId ? (
                  <div style={{ textAlign: 'center', padding: '20px 10px', background: 'var(--surface2)', borderRadius: '12px' }}>
                    <CheckCircle2 size={36} color="#62d66a" style={{ margin: '0 auto 8px' }} />
                    <b style={{ display: 'block', fontSize: '15px' }}>Report Successfully Submitted!</b>
                    <p style={{ fontSize: '12px', color: 'var(--muted)', margin: '6px 0 12px' }}>
                      Your reference tracking ID:
                    </p>
                    <div style={{ display: 'inline-block', padding: '6px 14px', background: 'var(--surface)', border: '1px solid #9ec65c', borderRadius: '8px', fontWeight: 800, fontSize: '15px' }}>
                      {reportedRefId}
                    </div>
                    <p style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '12px' }}>
                      Logged in the city operations queue. You can check status anytime using this ID.
                    </p>
                    <button
                      type="button"
                      className="widget-submit-btn"
                      style={{ marginTop: '10px' }}
                      onClick={() => setReportedRefId('')}
                    >
                      Report Another Incident
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="widget-form-group">
                      <label>Incident Type</label>
                      <select value={incidentType} onChange={(e) => setIncidentType(e.target.value)}>
                        <option value="traffic_congestion">Heavy Traffic Congestion</option>
                        <option value="accident">Traffic Accident</option>
                        <option value="waterlogging">Waterlogging / Flooding</option>
                        <option value="road_damage">Pothole / Road Damage</option>
                        <option value="signal_failure">Traffic Light Malfunction</option>
                      </select>
                    </div>

                    <div className="widget-form-group">
                      <label>Location / Landmark</label>
                      <input
                        type="text"
                        placeholder="e.g. Connaught Place Outer Circle, Moti Bagh"
                        value={locationName}
                        onChange={(e) => setLocationName(e.target.value)}
                        required
                      />
                    </div>

                    <div className="widget-form-group">
                      <label>Description</label>
                      <textarea
                        rows={3}
                        placeholder="Describe the issue, lane blockages, or severity..."
                        value={incidentDesc}
                        onChange={(e) => setIncidentDesc(e.target.value)}
                        required
                      />
                    </div>

                    <div className="widget-form-group">
                      <label>Severity Level</label>
                      <select value={incidentSeverity} onChange={(e) => setIncidentSeverity(e.target.value)}>
                        <option value="low">Low - Minor Slowdown</option>
                        <option value="medium">Medium - Lane Obstructed</option>
                        <option value="high">High - Road Blocked / Severe</option>
                        <option value="critical">Critical - Emergency / Collision</option>
                      </select>
                    </div>

                    <button type="submit" className="widget-submit-btn" disabled={submittingIncident}>
                      {submittingIncident ? <RefreshCw size={14} className="spin" /> : <Send size={14} />}
                      <span>Submit Incident to Authority</span>
                    </button>
                  </>
                )}
              </form>
            )}

            {/* TAB 3 (Citizen): TRACK ID */}
            {activeTab === 'track' && !isAuthority && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <form onSubmit={handleTrackIncident} style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    placeholder="Enter ID: e.g. INC-2026-A1B2"
                    className="drawer-input"
                    value={trackRefId}
                    onChange={(e) => setTrackRefId(e.target.value)}
                  />
                  <button type="submit" className="drawer-send-btn">
                    <Send size={14} />
                  </button>
                </form>

                {trackResult && (
                  <div style={{ padding: '14px', background: 'var(--surface2)', borderRadius: '10px', border: '1px solid var(--border)' }}>
                    {trackResult.not_found ? (
                      <div style={{ color: '#d1493b', fontSize: '12px' }}>
                        No incident report found with ID <b>{trackResult.id}</b>.
                      </div>
                    ) : (
                      <div style={{ fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <b>{trackResult.reference_id}</b>
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontWeight: 700,
                              textTransform: 'uppercase',
                              fontSize: '10px',
                              background:
                                trackResult.status === 'resolved'
                                  ? '#e6f7eb'
                                  : trackResult.status === 'verified'
                                  ? '#e3f2fd'
                                  : '#fff3e0',
                              color:
                                trackResult.status === 'resolved'
                                  ? '#2e7d32'
                                  : trackResult.status === 'verified'
                                  ? '#1565c0'
                                  : '#e65100',
                            }}
                          >
                            {trackResult.status}
                          </span>
                        </div>
                        <div><b>Issue:</b> {trackResult.title}</div>
                        <div><b>Severity:</b> {trackResult.severity?.toUpperCase()}</div>
                        <div><b>Logged:</b> {new Date(trackResult.reported_at).toLocaleString()}</div>
                        {trackResult.resolution_note && (
                          <div style={{ marginTop: '4px', padding: '6px', background: 'var(--surface)', borderRadius: '6px' }}>
                            <b>Operator Note:</b> {trackResult.resolution_note}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* TAB 2 (Authority): INCIDENT TRIAGE */}
            {activeTab === 'triage' && isAuthority && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>
                    Operator Triage Queue ({incidentsList.length})
                  </span>
                  <button
                    className="icon-utility-btn"
                    onClick={loadOperatorIncidents}
                    disabled={loadingIncidents}
                    style={{ padding: '2px 8px', fontSize: '10px' }}
                  >
                    <RefreshCw size={10} className={loadingIncidents ? 'spin' : ''} />
                    <span>Refresh</span>
                  </button>
                </div>

                {incidentsList.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '24px 10px', color: 'var(--muted)', fontSize: '12px' }}>
                    No incident reports in queue.
                  </div>
                ) : (
                  incidentsList.map((inc) => (
                    <div key={inc.id || inc.reference_id} className="triage-incident-card">
                      <div className="triage-card-header">
                        <span className="triage-ref-tag">{inc.reference_id}</span>
                        <span className={`triage-severity-pill ${inc.severity}`}>{inc.severity}</span>
                      </div>
                      <div className="triage-card-title">{inc.title}</div>
                      <div style={{ fontSize: '11px', color: 'var(--muted)' }}>{inc.description}</div>
                      <div style={{ fontSize: '10px', color: 'var(--muted)' }}>Status: <b>{inc.status?.toUpperCase()}</b></div>
                      {inc.status !== 'resolved' && (
                        <div className="triage-actions-row">
                          {inc.status === 'submitted' && (
                            <button
                              className="triage-action-btn verify"
                              onClick={() => handleUpdateStatus(inc.reference_id, 'verified')}
                            >
                              Verify & Dispatch
                            </button>
                          )}
                          <button
                            className="triage-action-btn resolve"
                            onClick={() => handleUpdateStatus(inc.reference_id, 'resolved')}
                          >
                            Mark Resolved
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {/* TAB 3 (Authority): SUMO SIMULATE */}
            {activeTab === 'simulate' && isAuthority && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div className="widget-form-group">
                  <label>Intervention Scenario</label>
                  <select value={simScenario} onChange={(e) => setSimScenario(e.target.value)}>
                    <option value="signal_priority">Adaptive Green Wave Signal Priority</option>
                    <option value="demand_surge">Peak Hour Demand Surge (Spillback)</option>
                    <option value="baseline">Baseline Equilibrium Model</option>
                  </select>
                </div>

                <button
                  className="widget-submit-btn"
                  onClick={handleRunSimulation}
                  disabled={simulating}
                >
                  {simulating ? <RefreshCw size={14} className="spin" /> : <Cpu size={14} />}
                  <span>Run SUMO Model Simulation</span>
                </button>

                {simResult && (
                  <div style={{ padding: '14px', background: 'var(--surface2)', borderRadius: '10px', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <b>Simulation Output · {simResult.scenario?.replace('_', ' ').toUpperCase()}</b>
                      <div>
                        Projected 30-min Queue Delta:{' '}
                        <b style={{ color: simResult.projected_queue_delta_pct < 0 ? '#2e7d32' : '#c62828' }}>
                          {simResult.projected_queue_delta_pct > 0 ? `+${simResult.projected_queue_delta_pct}%` : `${simResult.projected_queue_delta_pct}%`}
                        </b>
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '4px' }}>
                        * Model trained on 518,400 SUMO rows. Analytical projection; does not replace certified municipal operator dispatch.
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Drawer Footer (Only in Chat Tab) */}
          {activeTab === 'chat' && (
            <div style={{ borderTop: '1px solid var(--border)', padding: '8px 14px', background: 'var(--surface)' }}>
              {/* Quick sample chips */}
              <div className="drawer-quick-chips">
                {!isAuthority ? (
                  <>
                    <button className="drawer-chip" onClick={() => handleSendMessage('Best route from CP to ITO')}>
                      🗺️ CP to ITO
                    </button>
                    <button className="drawer-chip" onClick={() => handleSendMessage('Air quality near my location')}>
                      😷 Local AQI
                    </button>
                    <button className="drawer-chip" onClick={() => handleSendMessage('Connaught Place traffic')}>
                      🚦 Traffic Check
                    </button>
                  </>
                ) : (
                  <>
                    <button className="drawer-chip" onClick={() => handleSendMessage('Check traffic bottlenecks and vehicle counts')}>
                      🚦 Bottlenecks
                    </button>
                    <button className="drawer-chip" onClick={() => handleSendMessage('Simulate signal priority intervention')}>
                      ⚡ Sim Signal Wave
                    </button>
                    <button className="drawer-chip" onClick={() => handleSendMessage('Review citizen incident reports')}>
                      🛡️ Triage Reports
                    </button>
                  </>
                )}
              </div>

              <form
                className="agent-drawer-footer"
                style={{ padding: '8px 0 0', borderTop: 'none' }}
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage();
                }}
              >
                <input
                  type="text"
                  className="drawer-input"
                  placeholder={isAuthority ? 'Ask about traffic, signals, YOLO, or triage...' : 'Ask about routes, traffic, AQI...'}
                  value={inputQuery}
                  onChange={(e) => setInputQuery(e.target.value)}
                />
                <button type="submit" className="drawer-send-btn" disabled={loading}>
                  <Send size={15} />
                </button>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
