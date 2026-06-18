import { useEffect, useState } from 'react';
import { healthCheck, clearAllData } from '../api/client';
import { clearRecentInvestigations } from '../hooks/useInvestigation';

export default function Header({ activeTab, setActiveTab, investigationCount = 0 }) {
  const [backendStatus, setBackendStatus] = useState('checking'); // 'online' | 'offline' | 'checking'

  useEffect(() => {
    const check = async () => {
      try {
        await healthCheck();
        setBackendStatus('online');
      } catch {
        setBackendStatus('offline');
      }
    };

    check();
    const interval = setInterval(check, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleNuke = async () => {
    if (window.confirm("🚨 WARNING! This will completely delete all data in the database and clear all recent searches. Are you sure?")) {
      try {
        await clearAllData();
        clearRecentInvestigations();
        window.location.reload();
      } catch (e) {
        console.error(e);
        alert("Failed to clear data.");
      }
    }
  };

  return (
    <header className="app-header" role="banner">
      {/* Logo */}
      <div className="header-logo">
        <div className="header-logo-icon" aria-hidden="true">🔍</div>
        <div className="header-logo-text">
          <div className="header-logo-title">
            <span className="purple">OSINT</span>
            <span style={{ color: 'rgba(241,245,249,0.5)', margin: '0 4px' }}>·</span>
            <span className="cyan">Graph</span>
          </div>
          <div className="header-logo-subtitle">Investigative Relationship Graph Generator</div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="header-tabs">
        <button
          className={`header-tab-btn ${activeTab === 'results' ? 'active' : ''}`}
          onClick={() => setActiveTab('results')}
        >
          📂 Results List
        </button>
        <button
          className={`header-tab-btn ${activeTab === 'graph' ? 'active' : ''}`}
          onClick={() => setActiveTab('graph')}
        >
          📌 Corkboard Graph
        </button>
        <button
          className={`header-tab-btn ${activeTab === 'analysis' ? 'active' : ''}`}
          onClick={() => setActiveTab('analysis')}
        >
          📊 CDR/IPDR Analysis
        </button>
      </div>

      {/* Right side */}
      <div className="header-right">
        <button
          onClick={handleNuke}
          className="btn-ghost"
          style={{
            marginRight: '12px',
            color: 'var(--color-error)',
            borderColor: 'rgba(239, 68, 68, 0.2)',
            padding: '4px 10px',
            fontSize: '11px',
            background: 'rgba(239, 68, 68, 0.05)'
          }}
        >
          🚨 Nuke Database
        </button>
        {investigationCount > 0 && (
          <div className="header-stat" title="Total investigations run this session">
            <span className="header-stat-value">{investigationCount}</span>
            <span className="header-stat-label">Investigations</span>
          </div>
        )}

        <div
          className={`status-indicator ${backendStatus === 'online' ? 'online' : backendStatus === 'offline' ? 'offline' : ''}`}
          role="status"
          aria-label={`Backend status: ${backendStatus}`}
          title={`API: http://localhost:8000 — ${backendStatus}`}
        >
          <span
            className={`status-dot ${backendStatus === 'online' ? 'pulsing' : ''}`}
            aria-hidden="true"
          />
          {backendStatus === 'checking' && 'Connecting...'}
          {backendStatus === 'online' && 'API Online'}
          {backendStatus === 'offline' && 'API Offline'}
        </div>
      </div>
    </header>
  );
}
