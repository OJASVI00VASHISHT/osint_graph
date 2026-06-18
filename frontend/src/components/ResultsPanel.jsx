import { useState, useMemo } from 'react';
import EntityCard from './EntityCard';
import StatusBadge from './StatusBadge';

const FILTER_TABS = [
  { id: 'all', label: 'All' },
  { id: 'username', label: 'Username' },
  { id: 'email', label: 'Email' },
  { id: 'phone', label: 'Phone' },
  { id: 'website', label: 'Website' },
  { id: 'person', label: 'Person' },
  { id: 'organization', label: 'Org' },
  { id: 'location', label: 'Location' },
];

function SkeletonCards({ count = 4 }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="skeleton-card"
          style={{ animationDelay: `${i * 0.15}s` }}
          aria-hidden="true"
        />
      ))}
    </>
  );
}

export default function ResultsPanel({ investigation, isLoading, onEntityClick }) {
  const [activeFilter, setActiveFilter] = useState('all');

  const entities = useMemo(() => {
    return investigation?.results || investigation?.entities || [];
  }, [investigation]);

  const filteredEntities = useMemo(() => {
    if (activeFilter === 'all') return entities;
    return entities.filter(
      (e) => (e.entity_type || e.label || '').toLowerCase() === activeFilter.toLowerCase()
    );
  }, [entities, activeFilter]);

  const platforms = useMemo(() => {
    const seen = new Set();
    entities.forEach((e) => e.platform && seen.add(e.platform));
    return seen.size;
  }, [entities]);

  return (
    <div className="results-panel" aria-label="Investigation results">
      {/* Header */}
      <div className="section-header">
        <div className="section-title">
          <span className="icon">📊</span>
          Results
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {investigation && (
            <StatusBadge status={investigation.status} />
          )}
          {entities.length > 0 && (
            <span className="badge">{entities.length}</span>
          )}
        </div>
      </div>

      {/* Investigation banner */}
      {investigation && (
        <div className="investigation-banner">
          <span aria-hidden="true" style={{ fontSize: 12, color: 'var(--text-muted)' }}>Query:</span>
          <span className="inv-query">{investigation.query}</span>
          <span className="text-muted" style={{ fontSize: 11, flexShrink: 0 }}>
            #{(investigation.investigation_id || investigation.id || '').slice(0, 8)}
          </span>
        </div>
      )}

      {/* Filter tabs */}
      {entities.length > 0 && (
        <div className="filter-tabs" role="tablist" aria-label="Filter entities by type">
          {FILTER_TABS.map((tab) => {
            const count =
              tab.id === 'all'
                ? entities.length
                : entities.filter(
                    (e) => (e.entity_type || e.label || '').toLowerCase() === tab.id
                  ).length;

            if (count === 0 && tab.id !== 'all') return null;

            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeFilter === tab.id}
                className={`filter-tab ${activeFilter === tab.id ? 'active' : ''}`}
                onClick={() => setActiveFilter(tab.id)}
              >
                {tab.label}
                {count > 0 && (
                  <span style={{ marginLeft: 4, opacity: 0.7 }}>({count})</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Content */}
      <div className="results-list" role="feed" aria-busy={isLoading}>
        {isLoading && entities.length === 0 ? (
          <SkeletonCards count={5} />
        ) : !investigation && !isLoading ? (
          <div className="results-placeholder">
            <span className="placeholder-icon" aria-hidden="true">🕵️</span>
            <p>Start an investigation to see results</p>
            <p className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
              Enter a username, email, phone number, or name above
            </p>
          </div>
        ) : filteredEntities.length === 0 && !isLoading ? (
          <div className="results-placeholder">
            <span className="placeholder-icon" aria-hidden="true">🔍</span>
            <p>
              {activeFilter === 'all'
                ? 'No entities found for this investigation.'
                : `No ${activeFilter} entities found.`}
            </p>
          </div>
        ) : (
          filteredEntities.map((entity, idx) => (
            <EntityCard
              key={entity.id || `${entity.entity_type}-${entity.value}-${idx}`}
              entity={entity}
              onClick={() => onEntityClick?.(entity)}
            />
          ))
        )}

        {/* Show skeletons at the bottom while more are loading */}
        {isLoading && entities.length > 0 && <SkeletonCards count={2} />}
      </div>

      {/* Footer */}
      {entities.length > 0 && (
        <div className="results-footer">
          Found <strong style={{ color: 'var(--accent-purple-light)' }}>{entities.length}</strong> {entities.length === 1 ? 'entity' : 'entities'}
          {platforms > 0 && (
            <> across <strong style={{ color: 'var(--accent-cyan)' }}>{platforms}</strong> {platforms === 1 ? 'platform' : 'platforms'}</>
          )}
        </div>
      )}
    </div>
  );
}
