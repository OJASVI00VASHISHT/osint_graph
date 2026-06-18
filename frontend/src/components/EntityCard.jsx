import { useState } from 'react';

const ENTITY_ICONS = {
  username: '👤',
  email: '📧',
  phone: '📱',
  phonenumber: '📱',
  website: '🌐',
  person: '👥',
  organization: '🏢',
  location: '📍',
  investigation: '🔎',
  default: '🔗',
};

function getConfidenceColor(confidence) {
  if (confidence >= 80) return '#10b981';      // green
  if (confidence >= 60) return '#f59e0b';      // yellow
  if (confidence >= 40) return '#f97316';      // orange
  return '#ef4444';                            // red
}

function getEntityIcon(entityType) {
  if (!entityType) return ENTITY_ICONS.default;
  return ENTITY_ICONS[entityType.toLowerCase()] || ENTITY_ICONS.default;
}

function truncate(str, max = 30) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

export default function EntityCard({ entity, onClick }) {
  const [imgFailed, setImgFailed] = useState(false);
  const {
    entity_type,
    value,
    platform,
    url,
    confidence = 0,
    metadata = {},
  } = entity;

  const actualType = entity_type || entity.label || 'unknown';
  const icon = getEntityIcon(actualType);
  
  // Scale confidence to 0-100 if it is returned as a decimal between 0.0 and 1.0
  const scaledConfidence = confidence <= 1.0 ? confidence * 100 : confidence;
  const confColor = getConfidenceColor(scaledConfidence);
  const confPct = Math.min(100, Math.max(0, scaledConfidence));

  const avatarUrl = metadata?.avatar_url || metadata?.picture;

  return (
    <article
      className="entity-card"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.()}
      aria-label={`${actualType} entity: ${value}`}
    >
      <div className="entity-card-header">
        {avatarUrl && !imgFailed ? (
          <img
            src={avatarUrl}
            alt={value}
            className="entity-avatar"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <span className="entity-icon" aria-hidden="true">{icon}</span>
        )}
        <div className="entity-info">
          {platform && (
            <div className="entity-platform">{platform}</div>
          )}
          <div className="entity-value" title={value}>
            {truncate(value, 32)}
          </div>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="entity-url"
              onClick={(e) => e.stopPropagation()}
              title={url}
            >
              ↗ View source
            </a>
          )}
        </div>
        <span className="entity-type-tag">{actualType}</span>
      </div>

      {/* Confidence bar */}
      <div className="confidence-row">
        <span className="confidence-label">Confidence</span>
        <div className="confidence-bar" role="progressbar" aria-valuenow={confPct} aria-valuemin={0} aria-valuemax={100}>
          <div
            className="confidence-fill"
            style={{ width: `${confPct}%`, background: confColor }}
          />
        </div>
        <span className="confidence-value" style={{ color: confColor }}>
          {confPct}%
        </span>
      </div>
    </article>
  );
}
