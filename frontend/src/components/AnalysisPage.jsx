import { useState, useEffect } from 'react';
import { getPeople, getPersonAnalysis, deleteNode, uploadCDR, uploadIPDR } from '../api/client';

export default function AnalysisPage() {
  const [people, setPeople] = useState([]);
  const [selectedPersonId, setSelectedPersonId] = useState('');
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [analysisData, setAnalysisData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState('cdr'); // cdr | ipdr | matches
  const [cdrText, setCdrText] = useState('');
  const [ipdrText, setIpdrText] = useState('');
  const [uploadStatus, setUploadStatus] = useState({ type: '', message: '' });
  const [cdrViewMode, setCdrViewMode] = useState('dashboard'); // dashboard | text | json
  const [ipdrViewMode, setIpdrViewMode] = useState('dashboard'); // dashboard | text | json

  // Load list of all people/suspects
  useEffect(() => {
    fetchPeople();
  }, []);

  const fetchPeople = async () => {
    try {
      const res = await getPeople();
      setPeople(res.data || []);
      if (res.data && res.data.length > 0 && !selectedPersonId) {
        setSelectedPersonId(res.data[0].node_id);
      }
    } catch (err) {
      console.error('Failed to load suspects list:', err);
    }
  };

  // Fetch analysis data when a suspect is selected
  useEffect(() => {
    if (!selectedPersonId) return;
    
    const person = people.find((p) => p.node_id === selectedPersonId);
    setSelectedPerson(person);
    
    loadAnalysis(selectedPersonId);
  }, [selectedPersonId, people]);

  const loadAnalysis = async (id) => {
    setIsLoading(true);
    try {
      const res = await getPersonAnalysis(id);
      setAnalysisData(res.data);
    } catch (err) {
      console.error('Failed to load analysis logs:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUploadCDR = async () => {
    if (!cdrText.trim()) return;
    setUploadStatus({ type: 'loading', message: 'Analyzing CDR logs...' });
    try {
      await uploadCDR(selectedPersonId, { cdr_text: cdrText });
      setUploadStatus({ type: 'success', message: 'CDR logs analyzed successfully!' });
      loadAnalysis(selectedPersonId);
      setCdrText('');
    } catch (err) {
      setUploadStatus({ type: 'error', message: err.response?.data?.detail || 'Failed to upload CDR logs.' });
    }
  };

  const handleUploadIPDR = async () => {
    if (!ipdrText.trim()) return;
    setUploadStatus({ type: 'loading', message: 'Analyzing IPDR logs...' });
    try {
      await uploadIPDR(selectedPersonId, { ipdr_text: ipdrText });
      setUploadStatus({ type: 'success', message: 'IPDR logs analyzed successfully!' });
      loadAnalysis(selectedPersonId);
      setIpdrText('');
    } catch (err) {
      setUploadStatus({ type: 'error', message: err.response?.data?.detail || 'Failed to upload IPDR logs.' });
    }
  };

  const handleDeleteSuspect = async () => {
    if (!selectedPersonId) return;
    if (!window.confirm("Are you sure you want to delete this suspect? This action cannot be undone.")) return;
    
    try {
      await deleteNode(selectedPersonId);
      setSelectedPersonId('');
      fetchPeople();
    } catch (err) {
      console.error('Failed to delete suspect:', err);
      alert('Failed to delete suspect.');
    }
  };

  // Convert raw text logs into objects for tabular rendering
  const parseLogsToRows = (rawText, type) => {
    if (!rawText) return [];
    const lines = rawText.trim().split('\n');
    return lines
      .map((line, i) => {
        const parts = line.split(/[\t,;]+/).map((p) => p.trim());
        if (parts.length < 2 || parts[0].toLowerCase().includes('caller') || parts[0].toLowerCase().includes('called')) {
          return null;
        }
        if (type === 'cdr') {
          return {
            id: i,
            caller: parts[0],
            called: parts[1],
            timestamp: parts[2] || 'Unknown',
            duration: parts[3] || '0',
            type: parts[4] || 'Voice',
          };
        } else {
          return {
            id: i,
            sub_ip: parts[0],
            dest_ip: parts[1],
            timestamp: parts[2] || 'Unknown',
            bytes: parts[3] || '0',
          };
        }
      })
      .filter(Boolean);
  };

  const renderCdrDashboard = (json) => {
    if (!json) return null;
    
    const metrics = json.communication_metrics || {};
    const contacts = json.contact_analysis || {};
    const device = json.device_analysis || {};
    const sim = json.sim_analysis || {};
    const location = json.location_analysis || {};
    const time = json.time_analysis || {};
    const confidence = json.confidence_score !== undefined ? json.confidence_score : 1.0;
    const explanation = json.confidence_explanation || '';

    const formatDuration = (sec) => {
      if (!sec) return '0s';
      const hrs = Math.floor(sec / 3600);
      const mins = Math.floor((sec % 3600) / 60);
      const secs = sec % 60;
      return `${hrs > 0 ? hrs + 'h ' : ''}${mins > 0 ? mins + 'm ' : ''}${secs}s`;
    };

    return (
      <div className="cdr-dashboard animate-appear" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
          <div className="glass-card" style={{ padding: 14, border: '1px solid var(--border-subtle)', background: 'rgba(255, 0, 0, 0.03)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Total Calls</span>
            <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent-cyan)', textShadow: 'var(--glow-cyan)' }}>{metrics.total_calls ?? 0}</span>
          </div>
          <div className="glass-card" style={{ padding: 14, border: '1px solid var(--border-subtle)', background: 'rgba(16, 185, 129, 0.03)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Incoming Calls</span>
            <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-success)', textShadow: 'var(--glow-green)' }}>{metrics.incoming_calls ?? 0}</span>
          </div>
          <div className="glass-card" style={{ padding: 14, border: '1px solid var(--border-subtle)', background: 'rgba(239, 68, 68, 0.03)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Outgoing Calls</span>
            <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-error)' }}>{metrics.outgoing_calls ?? 0}</span>
          </div>
          <div className="glass-card" style={{ padding: 14, border: '1px solid var(--border-subtle)', background: 'rgba(124, 58, 237, 0.03)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Total SMS</span>
            <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent-purple-light)', textShadow: 'var(--glow-purple)' }}>{metrics.total_sms ?? 0}</span>
          </div>
          <div className="glass-card" style={{ padding: 14, border: '1px solid var(--border-subtle)', background: 'rgba(245, 158, 11, 0.03)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Call Duration</span>
            <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-warning)' }}>{formatDuration(metrics.total_duration_sec)}</span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          <div className="analysis-report-box" style={{ background: 'rgba(15, 15, 15, 0.4)' }}>
            <div className="report-header" style={{ color: 'var(--accent-cyan)' }}>👥 Top Interacted Contacts</div>
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {contacts.most_frequently_contacted && contacts.most_frequently_contacted.length > 0 ? (
                contacts.most_frequently_contacted.map((c, idx) => {
                  const maxCount = Math.max(...contacts.most_frequently_contacted.map(item => item.count || 1), 1);
                  const pct = Math.round(((c.count || 0) / maxCount) * 100);
                  return (
                    <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                        <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{c.phone_number}</span>
                        <span style={{ color: 'var(--text-muted)' }}>{c.count} calls ({c.type})</span>
                      </div>
                      <div style={{ height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, var(--accent-purple), var(--accent-cyan))', borderRadius: 3 }} />
                      </div>
                    </div>
                  );
                })
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No contact logs extracted.</div>
              )}
              {contacts.patterns && contacts.patterns.length > 0 && (
                <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: 8, paddingTop: 8 }}>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>Communication Patterns</div>
                  {contacts.patterns.map((p, idx) => (
                    <div key={idx} style={{ fontSize: 11, color: 'var(--text-secondary)' }}>• {p}</div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="analysis-report-box" style={{ background: 'rgba(15, 15, 15, 0.4)' }}>
            <div className="report-header" style={{ color: 'var(--accent-purple-light)' }}>⏰ Temporal Activity Patterns</div>
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <span style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Peak Hours</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  {time.peak_hours && time.peak_hours.length > 0 ? (
                    time.peak_hours.map((h, idx) => (
                      <span key={idx} className="entity-type-tag" style={{ background: 'var(--accent-purple-dim)', color: 'var(--text-primary)', borderColor: 'var(--border-subtle)', margin: 0 }}>
                        {h}
                      </span>
                    ))
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No data</span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 20 }}>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Weekly Ratio</span>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{time.weekday_vs_weekend || 'Unknown'}</div>
                </div>
                <div>
                  <span style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Night Calls</span>
                  <div style={{ fontSize: 12, color: time.night_activity_count > 0 ? 'var(--color-error)' : 'var(--text-secondary)', fontWeight: time.night_activity_count > 0 ? '600' : '400', marginTop: 2 }}>
                    🌙 {time.night_activity_count ?? 0} calls
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          <div className="analysis-report-box" style={{ background: 'rgba(15, 15, 15, 0.4)' }}>
            <div className="report-header" style={{ color: 'var(--color-warning)' }}>📍 Location / Cell Tower Logs</div>
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {location.frequent_towers && location.frequent_towers.length > 0 ? (
                location.frequent_towers.map((tow, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: 6 }}>
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Tower {tow.tower_id}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{tow.address || 'Address unknown'}</div>
                    </div>
                    <span className="entity-type-tag" style={{ margin: 0 }}>{tow.count} hits</span>
                  </div>
                ))
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No location logs parsed.</div>
              )}
              {location.movement_history && location.movement_history.length > 0 && (
                <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: 8, paddingTop: 8 }}>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>Movement timeline</div>
                  {location.movement_history.map((m, idx) => (
                    <div key={idx} style={{ fontSize: 11, color: 'var(--text-secondary)' }}>• {m}</div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="analysis-report-box" style={{ background: 'rgba(15, 15, 15, 0.4)' }}>
            <div className="report-header" style={{ color: 'var(--color-success)' }}>📱 SIM & Device Profile</div>
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <span style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Device IMEIs</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  {device.unique_imeis && device.unique_imeis.length > 0 ? (
                    device.unique_imeis.map((imei, idx) => (
                      <span key={idx} style={{ fontFamily: 'monospace', fontSize: 10, background: 'rgba(16, 185, 129, 0.1)', padding: '2px 6px', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 3 }}>
                        {imei}
                      </span>
                    ))
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No IMEIs extracted</span>
                  )}
                </div>
              </div>
              <div>
                <span style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)' }}>SIM IMSIs</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  {sim.unique_imsis && sim.unique_imsis.length > 0 ? (
                    sim.unique_imsis.map((imsi, idx) => (
                      <span key={idx} style={{ fontFamily: 'monospace', fontSize: 10, background: 'rgba(255, 0, 0, 0.1)', padding: '2px 6px', border: '1px solid rgba(6,182,212,0.2)', borderRadius: 3 }}>
                        {imsi}
                      </span>
                    ))
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No IMSIs extracted</span>
                  )}
                </div>
              </div>
              {(device.change_history?.length > 0 || sim.change_history?.length > 0) && (
                <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: 8, paddingTop: 8 }}>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>Hardware Changes</div>
                  {[...(device.change_history || []), ...(sim.change_history || [])].map((h, idx) => (
                    <div key={idx} style={{ fontSize: 11, color: 'var(--text-secondary)' }}>• {h}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="error-message info" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: 0, padding: 12, background: 'rgba(124, 58, 237, 0.05)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontWeight: 600, fontSize: 12 }}>Engine Confidence Score: {Math.round(confidence * 100)}%</span>
            {explanation && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{explanation}</span>}
          </div>
          <span className="entity-type-tag" style={{ background: confidence > 0.7 ? 'var(--color-success-dim)' : 'var(--color-warning-dim)', color: confidence > 0.7 ? '#a7f3d0' : '#fef3c7', borderColor: confidence > 0.7 ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)', margin: 0 }}>
            {confidence > 0.7 ? 'Verified Profile' : 'Incomplete Data'}
          </span>
        </div>
      </div>
    );
  };

  const renderIpdrDashboard = (json) => {
    if (!json) return null;

    const network = json.network_analysis || {};
    const domain = json.domain_analysis || {};
    const app = json.application_analysis || {};
    const device = json.device_analysis || {};
    const sim = json.sim_analysis || {};
    const location = json.location_analysis || {};
    const time = json.time_analysis || {};
    const recent = json.recent_48h_analysis || {};
    const risk = json.risk_indicators || {};
    const confidence = json.confidence_score !== undefined ? json.confidence_score : 1.0;
    const explanation = json.confidence_explanation || '';

    const domainCount = domain.most_accessed_domains?.length || 0;
    const appCount = app.most_used_applications?.length || 0;

    return (
      <div className="ipdr-dashboard animate-appear" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Risk Badges */}
        {(risk.vpn_detected || risk.tor_detected || risk.proxy_detected || risk.foreign_ips_detected || risk.rapid_location_changes) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 12, background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: 'var(--radius-md)' }}>
            <span style={{ fontWeight: 700, fontSize: 11, color: 'var(--color-error)', display: 'flex', alignItems: 'center', gap: 4, marginRight: 8 }}>⚠️ HIGH RISK INDICATORS DETECTED:</span>
            {risk.tor_detected && <span className="entity-type-tag" style={{ background: 'var(--color-error-dim)', color: '#fca5a5', borderColor: 'rgba(239,68,68,0.4)', margin: 0 }}>🧅 TOR Relay Connection</span>}
            {risk.vpn_detected && <span className="entity-type-tag" style={{ background: 'var(--color-warning-dim)', color: '#fde047', borderColor: 'rgba(245,158,11,0.4)', margin: 0 }}>🛡️ Active VPN Usage</span>}
            {risk.proxy_detected && <span className="entity-type-tag" style={{ background: 'var(--color-warning-dim)', color: '#fde047', borderColor: 'rgba(245,158,11,0.4)', margin: 0 }}>🖥️ Proxy Host detected</span>}
            {risk.foreign_ips_detected && <span className="entity-type-tag" style={{ background: 'var(--color-warning-dim)', color: '#fde047', borderColor: 'rgba(245,158,11,0.4)', margin: 0 }}>🌍 Foreign Network routing</span>}
            {risk.rapid_location_changes && <span className="entity-type-tag" style={{ background: 'var(--color-error-dim)', color: '#fca5a5', borderColor: 'rgba(239,68,68,0.4)', margin: 0 }}>✈️ Velocity Anomaly</span>}
          </div>
        )}

        {/* Metrics Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
          <div className="glass-card" style={{ padding: 14, border: '1px solid var(--border-subtle)', background: 'rgba(255, 0, 0, 0.03)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Total Sessions</span>
            <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent-cyan)', textShadow: 'var(--glow-cyan)' }}>{network.total_sessions ?? 0}</span>
          </div>
          <div className="glass-card" style={{ padding: 14, border: '1px solid var(--border-subtle)', background: 'rgba(16, 185, 129, 0.03)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Unique Public IPs</span>
            <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-success)', textShadow: 'var(--glow-green)' }}>{network.unique_public_ips ?? 0}</span>
          </div>
          <div className="glass-card" style={{ padding: 14, border: '1px solid var(--border-subtle)', background: 'rgba(124, 58, 237, 0.03)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Unique Private IPs</span>
            <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent-purple-light)', textShadow: 'var(--glow-purple)' }}>{network.unique_private_ips ?? 0}</span>
          </div>
          <div className="glass-card" style={{ padding: 14, border: '1px solid var(--border-subtle)', background: 'rgba(245, 158, 11, 0.03)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Accessed Domains</span>
            <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-warning)' }}>{domainCount}</span>
          </div>
          <div className="glass-card" style={{ padding: 14, border: '1px solid var(--border-subtle)', background: 'rgba(255, 0, 0, 0.03)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Identified Apps</span>
            <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent-cyan)' }}>{appCount}</span>
          </div>
        </div>

        {/* Recent 48 Hour Analysis Block */}
        {recent.observed && (
          <div className="analysis-report-box" style={{ borderColor: 'rgba(255, 0, 0, 0.35)', background: 'rgba(255, 0, 0, 0.02)' }}>
            <div className="report-header" style={{ color: 'var(--accent-cyan)', display: 'flex', alignItems: 'center', gap: 8 }}>⚡ Recent 48-Hour Priority Intelligence Summary</div>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: '1.5' }}>{recent.summary}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 12, fontSize: 11 }}>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Last Known Public IP</span>
                  <div style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--accent-cyan)', marginTop: 2 }}>{recent.last_known_ip || 'N/A'}</div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Last Tower Location</span>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginTop: 2 }}>{recent.last_known_location || 'N/A'}</div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Last Device IMEI</span>
                  <div style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-primary)', marginTop: 2 }}>{recent.last_known_device || 'N/A'}</div>
                </div>
              </div>
              
              {((recent.last_accessed_domains && recent.last_accessed_domains.length > 0) || (recent.last_accessed_applications && recent.last_accessed_applications.length > 0)) && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: 10, fontSize: 11 }}>
                  {recent.last_accessed_domains?.length > 0 && (
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Last Domains</span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                        {recent.last_accessed_domains.map((d, idx) => (
                          <div key={idx}>• {d}</div>
                        ))}
                      </div>
                    </div>
                  )}
                  {recent.last_accessed_applications?.length > 0 && (
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Last Applications</span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4, color: 'var(--text-secondary)' }}>
                        {recent.last_accessed_applications.map((a, idx) => (
                          <div key={idx}>• {a}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Top Domains & Applications side-by-side */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          <div className="analysis-report-box" style={{ background: 'rgba(15, 15, 15, 0.4)' }}>
            <div className="report-header" style={{ color: 'var(--accent-cyan)' }}>🌐 Web Activity / Visited Domains</div>
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {domain.most_accessed_domains && domain.most_accessed_domains.length > 0 ? (
                domain.most_accessed_domains.map((d, idx) => {
                  const maxCount = Math.max(...domain.most_accessed_domains.map(item => item.count || 1), 1);
                  const pct = Math.round(((d.count || 0) / maxCount) * 100);
                  return (
                    <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                        <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{d.domain}</span>
                        <span style={{ color: 'var(--text-muted)' }}>{d.count} hits</span>
                      </div>
                      <div style={{ height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, var(--accent-cyan), var(--accent-purple-light))', borderRadius: 3 }} />
                      </div>
                    </div>
                  );
                })
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No domain logs extracted.</div>
              )}
            </div>
          </div>

          <div className="analysis-report-box" style={{ background: 'rgba(15, 15, 15, 0.4)' }}>
            <div className="report-header" style={{ color: 'var(--accent-purple-light)' }}>📱 Application Usage Distribution</div>
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {app.most_used_applications && app.most_used_applications.length > 0 ? (
                app.most_used_applications.map((a, idx) => {
                  const maxCount = Math.max(...app.most_used_applications.map(item => item.count || 1), 1);
                  const pct = Math.round(((a.count || 0) / maxCount) * 100);
                  return (
                    <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                        <span style={{ fontWeight: 600 }}>{a.app}</span>
                        <span style={{ color: 'var(--text-muted)' }}>{a.count} sessions</span>
                      </div>
                      <div style={{ height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, var(--accent-purple-light), var(--accent-purple))', borderRadius: 3 }} />
                      </div>
                    </div>
                  );
                })
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No application logs parsed.</div>
              )}
            </div>
          </div>
        </div>

        {/* Location & Hardware */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          <div className="analysis-report-box" style={{ background: 'rgba(15, 15, 15, 0.4)' }}>
            <div className="report-header" style={{ color: 'var(--color-warning)' }}>📍 Tower & Location Registry</div>
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {location.frequent_towers && location.frequent_towers.length > 0 ? (
                location.frequent_towers.map((tow, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: 6 }}>
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Tower {tow.tower_id}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{tow.address || 'Address unknown'}</div>
                    </div>
                    <span className="entity-type-tag" style={{ margin: 0 }}>{tow.count} hits</span>
                  </div>
                ))
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No location logs.</div>
              )}
            </div>
          </div>

          <div className="analysis-report-box" style={{ background: 'rgba(15, 15, 15, 0.4)' }}>
            <div className="report-header" style={{ color: 'var(--color-success)' }}>📱 SIM & Device Registry</div>
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <span style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Device IMEIs</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  {device.unique_imeis && device.unique_imeis.length > 0 ? (
                    device.unique_imeis.map((imei, idx) => (
                      <span key={idx} style={{ fontFamily: 'monospace', fontSize: 10, background: 'rgba(16, 185, 129, 0.1)', padding: '2px 6px', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 3 }}>
                        {imei}
                      </span>
                    ))
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No IMEIs</span>
                  )}
                </div>
              </div>
              <div>
                <span style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)' }}>SIM IMSIs</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  {sim.unique_imsis && sim.unique_imsis.length > 0 ? (
                    sim.unique_imsis.map((imsi, idx) => (
                      <span key={idx} style={{ fontFamily: 'monospace', fontSize: 10, background: 'rgba(255, 0, 0, 0.1)', padding: '2px 6px', border: '1px solid rgba(6,182,212,0.2)', borderRadius: 3 }}>
                        {imsi}
                      </span>
                    ))
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No IMSIs</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="error-message info" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: 0, padding: 12, background: 'rgba(124, 58, 237, 0.05)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontWeight: 600, fontSize: 12 }}>Engine Confidence Score: {Math.round(confidence * 100)}%</span>
            {explanation && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{explanation}</span>}
          </div>
          <span className="entity-type-tag" style={{ background: confidence > 0.7 ? 'var(--color-success-dim)' : 'var(--color-warning-dim)', color: confidence > 0.7 ? '#a7f3d0' : '#fef3c7', borderColor: confidence > 0.7 ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)', margin: 0 }}>
            {confidence > 0.7 ? 'Verified Profile' : 'Incomplete Data'}
          </span>
        </div>
      </div>
    );
  };

  const cdrRows = parseLogsToRows(analysisData?.cdr_data, 'cdr');
  const ipdrRows = parseLogsToRows(analysisData?.ipdr_data, 'ipdr');
  const matches = analysisData?.matches || [];

  return (
    <div className="analysis-page-container">
      {/* Target Selector Toolbar */}
      <div className="analysis-selector-bar glass-card">
        <label className="section-title" style={{ border: 'none', padding: 0 }}>
          🎯 Select Suspect for Analysis:
        </label>
        <select
          className="search-input"
          style={{ width: '250px', background: '#070715', padding: '8px 12px' }}
          value={selectedPersonId}
          onChange={(e) => setSelectedPersonId(e.target.value)}
        >
          {people.length === 0 && <option value="">No suspects found</option>}
          {people.map((p) => (
            <option key={p.node_id} value={p.node_id}>
              {p.name || `Suspect (${p.node_id.slice(0, 8)})`}
            </option>
          ))}
        </select>
        <button className="btn-ghost" onClick={fetchPeople}>🔄 Refresh Suspect List</button>
        <button className="btn-ghost" onClick={handleDeleteSuspect} style={{ color: 'var(--color-error)' }} disabled={!selectedPersonId}>🗑️ Delete Suspect</button>
      </div>

      {/* Main Analysis Panels */}
      {selectedPerson ? (
        <div className="analysis-grid-layout">
          {/* LEFT: Target Profiling Card */}
          <div className="analysis-left-panel glass-card">
            <div className="section-header">
              <span className="section-title">👤 Target Profile</span>
            </div>
            
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              {/* Polaroid Frame */}
              <div className="polaroid-card animate-flicker" style={{ cursor: 'default', margin: 0, scale: '1.05' }}>
                <div className="polaroid-photo-frame" style={{ width: 140, height: 140 }}>
                  {selectedPerson.picture ? (
                    <img src={selectedPerson.picture} alt={selectedPerson.name} className="polaroid-img" />
                  ) : (
                    <div className="suspect-silhouette" style={{ fontSize: 54 }}>👤</div>
                  )}
                </div>
                <div className="polaroid-label" style={{ fontSize: 13, letterSpacing: '0.04em' }}>
                  {selectedPerson.name || 'UNKNOWN'}
                </div>
              </div>

              {/* Suspect Quick Info */}
              <div className="detail-grid" style={{ width: '100%', marginTop: 8 }}>
                <div className="detail-row">
                  <span className="detail-key">Phone</span>
                  <span className="detail-val" style={{ color: 'var(--accent-cyan)' }}>
                    {selectedPerson.phone_number || 'Not Configured'}
                  </span>
                </div>
                <div className="detail-row">
                  <span className="detail-key">Email</span>
                  <span className="detail-val">{selectedPerson.email || 'Not Configured'}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-key">Social ID</span>
                  <span className="detail-val">{selectedPerson.social_media_id || 'Not Configured'}</span>
                </div>
                {selectedPerson.links && (
                  <div className="detail-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                    <span className="detail-key">Links</span>
                    <span className="detail-val" style={{ wordBreak: 'break-all', fontSize: 10 }}>
                      {selectedPerson.links}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT: Analysis Results Workspace */}
          <div className="analysis-right-panel glass-card">
            <div className="section-header">
              <span className="section-title">📊 Intelligence Workspace</span>
              {/* Sub tabs */}
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className={`filter-tab ${activeSubTab === 'cdr' ? 'active' : ''}`}
                  onClick={() => setActiveSubTab('cdr')}
                >
                  📞 CDR Analysis
                </button>
                <button
                  className={`filter-tab ${activeSubTab === 'ipdr' ? 'active' : ''}`}
                  onClick={() => setActiveSubTab('ipdr')}
                >
                  🌐 IPDR Analysis
                </button>
                <button
                  className={`filter-tab ${activeSubTab === 'matches' ? 'active' : ''}`}
                  onClick={() => setActiveSubTab('matches')}
                >
                  🔗 Cross-References ({matches.length})
                </button>
              </div>
            </div>

            <div style={{ padding: '20px', height: 'calc(100% - 50px)', overflowY: 'auto' }}>
              {isLoading ? (
                <div className="results-placeholder">
                  <div className="spinner" style={{ width: 30, height: 30 }} />
                  <p>Processing target intelligence records...</p>
                </div>
              ) : (
                <>
                  {/* TAB 1: CDR Analysis */}
                  {activeSubTab === 'cdr' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                      {uploadStatus.message && uploadStatus.type !== '' && activeSubTab === 'cdr' && (
                        <div className={`error-message ${uploadStatus.type === 'success' ? 'success' : ''}`}>
                          {uploadStatus.message}
                        </div>
                      )}

                      <div className="analysis-report-box" style={{ padding: 16 }}>
                        <div className="detail-key" style={{ fontSize: 12, marginBottom: 8 }}>Upload Call Detail Records (CDR)</div>
                        <p className="text-muted" style={{ fontSize: 11, marginBottom: 12 }}>
                          Upload or paste Call Detail Records (CDR) below. Format caller number, recipient number, timestamp, and duration (seconds). One call per line, comma or tab separated.
                        </p>
                        <textarea
                          className="search-input"
                          style={{ height: 100, width: '100%', fontFamily: 'monospace', marginBottom: 12 }}
                          placeholder="Paste CDR records here..."
                          value={cdrText}
                          onChange={(e) => setCdrText(e.target.value)}
                        />
                        <button className="btn-primary" onClick={handleUploadCDR} disabled={uploadStatus.type === 'loading'}>
                          {uploadStatus.type === 'loading' ? <div className="spinner" /> : 'Parse & Run CDR Analysis'}
                        </button>
                      </div>

                      {/* CDR Report */}
                      {analysisData?.cdr_analysis_raw ? (
                        <div className="analysis-report-box animate-appear">
                          <div className="report-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 16px' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>📞 Call Log Intelligence Profile</span>
                            {analysisData.cdr_analysis_json && (
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button className={`filter-tab ${cdrViewMode === 'dashboard' ? 'active' : ''}`} style={{ padding: '2px 8px', fontSize: 10, height: 24, margin: 0 }} onClick={() => setCdrViewMode('dashboard')}>📊 Dashboard</button>
                                <button className={`filter-tab ${cdrViewMode === 'text' ? 'active' : ''}`} style={{ padding: '2px 8px', fontSize: 10, height: 24, margin: 0 }} onClick={() => setCdrViewMode('text')}>📄 Summary</button>
                                <button className={`filter-tab ${cdrViewMode === 'json' ? 'active' : ''}`} style={{ padding: '2px 8px', fontSize: 10, height: 24, margin: 0 }} onClick={() => setCdrViewMode('json')}>📁 JSON</button>
                              </div>
                            )}
                          </div>
                          <div className="report-body" style={{ padding: '20px', background: 'rgba(20, 20, 20, 0.4)' }}>
                            {analysisData.cdr_analysis_json && cdrViewMode === 'dashboard' ? (
                              renderCdrDashboard(analysisData.cdr_analysis_json)
                            ) : cdrViewMode === 'json' ? (
                              <pre style={{ fontFamily: 'monospace', fontSize: 11, background: '#050510', padding: 12, borderRadius: 5, overflowX: 'auto', border: '1px solid var(--border-subtle)' }}>
                                {JSON.stringify(analysisData.cdr_analysis_json, null, 2)}
                              </pre>
                            ) : (
                              <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'Inter, sans-serif' }}>
                                {analysisData.cdr_analysis}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : analysisData?.cdr_analysis && (
                        <div className="analysis-report-box animate-appear">
                          <div className="report-header">📞 Call Log Intelligence Profile</div>
                          <div className="report-body" style={{ padding: '20px', whiteSpace: 'pre-wrap', fontFamily: 'Inter, sans-serif' }}>
                            {analysisData.cdr_analysis}
                          </div>
                        </div>
                      )}

                      {/* Raw Logs Table */}
                      {cdrRows.length > 0 && (
                        <div>
                          <div className="detail-section-label" style={{ marginBottom: 8 }}>Parsed Call Records ({cdrRows.length})</div>
                          <div style={{ overflowX: 'auto' }}>
                            <table className="analysis-table">
                              <thead>
                                <tr>
                                  <th>Caller</th>
                                  <th>Called Number</th>
                                  <th>Timestamp</th>
                                  <th>Duration</th>
                                  <th>Type</th>
                                </tr>
                              </thead>
                              <tbody>
                                {cdrRows.map((row) => (
                                  <tr key={row.id}>
                                    <td style={{ fontFamily: 'monospace' }}>{row.caller}</td>
                                    <td style={{ fontFamily: 'monospace' }}>{row.called}</td>
                                    <td>{row.timestamp}</td>
                                    <td>{row.duration}s</td>
                                    <td>{row.type}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB 2: IPDR Analysis */}
                  {activeSubTab === 'ipdr' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                      {uploadStatus.message && uploadStatus.type !== '' && activeSubTab === 'ipdr' && (
                        <div className={`error-message ${uploadStatus.type === 'success' ? 'success' : ''}`}>
                          {uploadStatus.message}
                        </div>
                      )}

                      <div className="analysis-report-box" style={{ padding: 16 }}>
                        <div className="detail-key" style={{ fontSize: 12, marginBottom: 8 }}>Upload IP Detail Records (IPDR)</div>
                        <p className="text-muted" style={{ fontSize: 11, marginBottom: 12 }}>
                          Upload or paste Internet Protocol Data Records (IPDR) below. Format: Subscriber IP, Destination IP, Timestamp, Bytes Transferred, Protocol.
                        </p>
                        <textarea
                          className="search-input"
                          style={{ height: 100, width: '100%', fontFamily: 'monospace', marginBottom: 12 }}
                          placeholder="Paste IPDR records here..."
                          value={ipdrText}
                          onChange={(e) => setIpdrText(e.target.value)}
                        />
                        <button className="btn-primary" onClick={handleUploadIPDR} disabled={uploadStatus.type === 'loading'}>
                          {uploadStatus.type === 'loading' ? <div className="spinner" /> : 'Parse & Run IPDR Analysis'}
                        </button>
                      </div>

                      {/* IPDR Report */}
                      {analysisData?.ipdr_analysis_raw ? (
                        <div className="analysis-report-box animate-appear" style={{ marginTop: 12 }}>
                          <div className="report-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 16px' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>🌐 Network Connection Profile</span>
                            {analysisData.ipdr_analysis_json && (
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button className={`filter-tab ${ipdrViewMode === 'dashboard' ? 'active' : ''}`} style={{ padding: '2px 8px', fontSize: 10, height: 24, margin: 0 }} onClick={() => setIpdrViewMode('dashboard')}>📊 Dashboard</button>
                                <button className={`filter-tab ${ipdrViewMode === 'text' ? 'active' : ''}`} style={{ padding: '2px 8px', fontSize: 10, height: 24, margin: 0 }} onClick={() => setIpdrViewMode('text')}>📄 Summary</button>
                                <button className={`filter-tab ${ipdrViewMode === 'json' ? 'active' : ''}`} style={{ padding: '2px 8px', fontSize: 10, height: 24, margin: 0 }} onClick={() => setIpdrViewMode('json')}>📁 JSON</button>
                              </div>
                            )}
                          </div>
                          <div className="report-body" style={{ padding: '20px', background: 'rgba(20, 20, 20, 0.4)' }}>
                            {analysisData.ipdr_analysis_json && ipdrViewMode === 'dashboard' ? (
                              renderIpdrDashboard(analysisData.ipdr_analysis_json)
                            ) : ipdrViewMode === 'json' ? (
                              <pre style={{ fontFamily: 'monospace', fontSize: 11, background: '#050510', padding: 12, borderRadius: 5, overflowX: 'auto', border: '1px solid var(--border-subtle)' }}>
                                {JSON.stringify(analysisData.ipdr_analysis_json, null, 2)}
                              </pre>
                            ) : (
                              <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'Inter, sans-serif' }}>
                                {analysisData.ipdr_analysis}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : analysisData?.ipdr_analysis && (
                        <div className="analysis-report-box animate-appear" style={{ marginTop: 12 }}>
                          <div className="report-header">🌐 Network Connection Profile</div>
                          <div className="report-body" style={{ padding: '20px', whiteSpace: 'pre-wrap', fontFamily: 'Inter, sans-serif' }}>
                            {analysisData.ipdr_analysis}
                          </div>
                        </div>
                      )}

                      {/* Raw Logs Table */}
                      {ipdrRows.length > 0 && (
                        <div>
                          <div className="detail-section-label" style={{ marginBottom: 8 }}>Parsed Network Activity ({ipdrRows.length})</div>
                          <div style={{ overflowX: 'auto' }}>
                            <table className="analysis-table">
                              <thead>
                                <tr>
                                  <th>Subscriber IP</th>
                                  <th>Destination IP</th>
                                  <th>Timestamp</th>
                                  <th>Data Transferred</th>
                                </tr>
                              </thead>
                              <tbody>
                                {ipdrRows.map((row) => (
                                  <tr key={row.id}>
                                    <td style={{ fontFamily: 'monospace' }}>{row.sub_ip}</td>
                                    <td style={{ fontFamily: 'monospace' }}>{row.dest_ip}</td>
                                    <td>{row.timestamp}</td>
                                    <td>{row.bytes} bytes</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB 2: Cross Reference Matches */}
                  {activeSubTab === 'matches' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {matches.length === 0 ? (
                        <div className="results-placeholder" style={{ padding: '40px 0' }}>
                          <span className="placeholder-icon">🔗</span>
                          <p>No communication matches found with other suspects in the database.</p>
                        </div>
                      ) : (
                        <>
                          <div className="error-message success" style={{ background: 'var(--color-error-dim)', borderColor: 'rgba(239, 68, 68, 0.4)', color: '#f87171' }}>
                            <span>⚠️</span>
                            Direct suspect-to-suspect communication lines identified! Cross-referencing matching logs.
                          </div>

                          <div className="results-list" style={{ padding: 0 }}>
                            {matches.map((match, idx) => (
                              <div key={idx} className="entity-card animate-appear" style={{ borderColor: 'rgba(239, 68, 68, 0.35)', background: 'rgba(239, 68, 68, 0.03)' }}>
                                <div className="entity-card-header">
                                  <span className="entity-icon">🗣️</span>
                                  <div className="entity-info">
                                    <div className="entity-platform" style={{ color: 'var(--color-error)' }}>
                                      COMMUNICATION MATCH
                                    </div>
                                    <div className="entity-value" style={{ fontSize: 14 }}>
                                      {match.name}
                                    </div>
                                    <div className="entity-url" style={{ color: 'var(--text-muted)' }}>
                                      Phone: {match.phone} | Direction: {match.direction}
                                    </div>
                                  </div>
                                  <span className="entity-type-tag" style={{ background: 'var(--color-error-dim)', color: '#fca5a5', borderColor: 'rgba(239,68,68,0.3)' }}>
                                    Suspect Call
                                  </span>
                                </div>
                                <div className="confidence-row" style={{ justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
                                  <span>Call Time: <strong>{match.timestamp}</strong></span>
                                  <span>Duration: <strong>{match.duration}s</strong></span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}


                </>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="results-placeholder glass-card" style={{ padding: 60 }}>
          <span className="placeholder-icon">🔬</span>
          <p>Please select a suspect from the selector toolbar to view CDR & IPDR intelligence report.</p>
        </div>
      )}
    </div>
  );
}
