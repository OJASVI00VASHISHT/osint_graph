import { useState, useEffect } from 'react';
import { getRecentInvestigations } from '../hooks/useInvestigation';

const QUERY_TYPES = [
  { id: 'username', label: 'Username', icon: '👤', placeholder: 'Enter username...' },
  { id: 'email', label: 'Email', icon: '📧', placeholder: 'Enter email address...' },
  { id: 'phone', label: 'Phone', icon: '📱', placeholder: 'Enter phone number...' },
  { id: 'name', label: 'Name', icon: '🔍', placeholder: 'Enter full name...' },
];

const TYPE_ICONS = {
  username: '👤',
  email: '📧',
  phone: '📱',
  name: '🔍',
};

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function SearchPanel({ onInvestigate, isLoading, error }) {
  const [query, setQuery] = useState('');
  const [queryType, setQueryType] = useState('username');
  const [recentLimit, setRecentLimit] = useState(10);
  const [recent, setRecent] = useState([]);

  useEffect(() => {
    setRecent(getRecentInvestigations());
  }, [isLoading]); // refresh after each investigation

  const activePlaceholder =
    QUERY_TYPES.find((t) => t.id === queryType)?.placeholder || 'Enter query...';

  const handleSubmit = (e) => {
    e?.preventDefault();
    if (query.trim() && !isLoading) {
      onInvestigate(query.trim(), queryType);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSubmit();
  };

  const handleRecentClick = (item) => {
    setQuery(item.query);
    setQueryType(item.queryType);
    onInvestigate(item.query, item.queryType);
  };

  return (
    <div className="search-panel">
      {/* Search section */}
      <div className="section-header">
        <div className="section-title">
          <span className="icon">⚡</span>
          New Investigation
        </div>
      </div>

      <div className="search-body">
        {/* Query type selector */}
        <div className="query-type-selector" role="group" aria-label="Query type">
          {QUERY_TYPES.map((t) => (
            <button
              key={t.id}
              className={`type-btn ${queryType === t.id ? 'active' : ''}`}
              onClick={() => setQueryType(t.id)}
              aria-pressed={queryType === t.id}
              title={`Search by ${t.label}`}
            >
              <span className="type-icon" aria-hidden="true">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        {/* Search input */}
        <div className="search-input-wrapper">
          <input
            id="investigation-query"
            className="search-input"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={activePlaceholder}
            disabled={isLoading}
            autoComplete="off"
            spellCheck={false}
            aria-label="Investigation query"
          />
        </div>

        {/* Submit button */}
        <button
          id="investigate-btn"
          className="btn-primary"
          onClick={handleSubmit}
          disabled={isLoading || !query.trim()}
          aria-busy={isLoading}
        >
          {isLoading ? (
            <>
              <span className="spinner" aria-hidden="true" />
              Scanning...
            </>
          ) : (
            <>
              <span aria-hidden="true">🔎</span>
              Investigate
            </>
          )}
        </button>

        {/* Error */}
        {error && (
          <div className="error-message" role="alert">
            <span aria-hidden="true">⚠️</span>
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Recent investigations */}
      <div className="recent-panel">
        <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="section-title">
            <span className="icon">🕐</span>
            Recent
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {recent.length > 0 && (
              <span className="badge">{recent.length}</span>
            )}
            <select
              className="search-input"
              style={{ padding: '2px 6px', fontSize: '10px', height: '24px', minHeight: '24px' }}
              value={recentLimit}
              onChange={(e) => setRecentLimit(Number(e.target.value))}
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </div>
        </div>

        <div className="recent-list" aria-label="Recent investigations" style={{ overflowY: 'auto', maxHeight: '400px' }}>
          {recent.length === 0 ? (
            <div className="recent-empty">
              <span className="empty-icon" aria-hidden="true">📂</span>
              <span>No recent investigations</span>
            </div>
          ) : (
            recent.slice(0, recentLimit).map((item, idx) => (
              <button
                key={idx}
                className="recent-item"
                onClick={() => handleRecentClick(item)}
                title={`Re-investigate: ${item.query}`}
                style={{ background: 'none', border: 'none', textAlign: 'left', width: '100%' }}
              >
                <span className="recent-item-icon" aria-hidden="true">
                  {TYPE_ICONS[item.queryType] || '🔍'}
                </span>
                <div className="recent-item-info">
                  <div className="recent-item-query">{item.query}</div>
                  <div className="recent-item-meta">
                    <span className="text-muted">{item.queryType}</span>
                    <span>·</span>
                    <span>{timeAgo(item.timestamp)}</span>
                  </div>
                </div>
                {item.status && (
                  <span
                    className={`status-badge ${item.status}`}
                    style={{ fontSize: '9px', padding: '2px 6px' }}
                  >
                    {item.status}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
