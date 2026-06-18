import { useState, useEffect } from 'react';
import useInvestigation from './hooks/useInvestigation';
import Header from './components/Header';
import SearchPanel from './components/SearchPanel';
import ResultsPanel from './components/ResultsPanel';
import CorkboardGraph from './components/CorkboardGraph';
import AnalysisPage from './components/AnalysisPage';
import { getPeople, updatePerson, createPerson } from './api/client';

const ENTITY_ICONS = {
  username: '👤', email: '📧', phone: '📱', phonenumber: '📱',
  website: '🌐', person: '👥', organization: '🏢', location: '📍',
  investigation: '🔎', default: '🔗',
};

function getIcon(type) {
  return ENTITY_ICONS[(type || '').toLowerCase()] || ENTITY_ICONS.default;
}

function DetailPanel({ selectedNode, investigation, onAddToNode }) {
  if (!selectedNode && !investigation) {
    return (
      <div className="detail-placeholder">
        <span className="placeholder-icon" aria-hidden="true">🔬</span>
        <p>Select a result item to inspect details</p>
      </div>
    );
  }

  // Node was selected from results or graph
  if (selectedNode) {
    const { id, data } = selectedNode;
    
    // Determine if it is a search result entity (has .value field)
    const isSearchResult = data.value !== undefined;
    
    // Map fields robustly
    const nodeType = isSearchResult 
      ? (data.entity_type || data.label || 'Unknown')
      : (data.nodeType || data.node_type || data.entity_type || data.label || 'Unknown');
      
    const label = isSearchResult
      ? data.value
      : (data.label || data.name || data.value || id);
    
    // Extract properties to display
    const { color, size, x, y, ...rest } = data;
    const properties = { ...rest };
    
    // Don't show technical internal React/d3 fields as property rows if they are raw keys
    delete properties.id;
    delete properties.node_id;
    delete properties.nodeType;
    delete properties.node_type;
    delete properties.entity_type;
    delete properties.label;
    delete properties.value;
    delete properties.name;

    const avatarUrl = data.metadata?.avatar_url || data.metadata?.picture || data.picture || data.avatar_url || properties.picture || properties.avatar_url || (properties.metadata && (properties.metadata.avatar_url || properties.metadata.picture));

    return (
      <div>
        {avatarUrl && (
          <div className="detail-avatar-container">
            <img src={avatarUrl} alt={label} className="detail-avatar" />
          </div>
        )}
        <h2 className="detail-title">
          {!avatarUrl && <span aria-hidden="true">{getIcon(nodeType)}</span>}
          {label}
        </h2>

        <div className="detail-grid">
          <div className="detail-row">
            <span className="detail-key">Type</span>
            <span className="detail-val" style={{ color: color || 'inherit', textTransform: 'capitalize' }}>{nodeType}</span>
          </div>
          <div className="detail-row">
            <span className="detail-key">Identifier</span>
            <span className="detail-val">{label}</span>
          </div>
        </div>

        {Object.keys(properties).length > 0 && (
          <>
            <div className="detail-section-label">Properties</div>
            <div className="detail-grid">
              {Object.entries(properties).map(([k, v]) => {
                if (v === null || v === undefined || v === '') return null;
                // Handle nested metadata if present
                if (k === 'metadata' && typeof v === 'object') {
                  return Object.entries(v).map(([subK, subV]) => {
                    if (subV === null || subV === undefined || subV === '') return null;
                    const displayVal = typeof subV === 'object' ? JSON.stringify(subV) : String(subV);
                    return (
                      <div key={subK} className="detail-row">
                        <span className="detail-key">{subK.replace(/_/g, ' ')}</span>
                        <span className="detail-val" title={displayVal}>{displayVal}</span>
                      </div>
                    );
                  });
                }
                let displayVal = typeof v === 'object' ? JSON.stringify(v) : String(v);
                if (k === 'confidence' && typeof v === 'number') {
                  const scaledVal = v <= 1.0 ? v * 100 : v;
                  displayVal = `${scaledVal}%`;
                }
                return (
                  <div key={k} className="detail-row">
                    <span className="detail-key">{k.replace(/_/g, ' ')}</span>
                    <span className="detail-val" title={displayVal}>{displayVal}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {(data.url || properties.url) && (
          <a
            href={data.url || properties.url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary"
            style={{
              marginTop: '20px',
              background: 'linear-gradient(135deg, #0284c7 0%, var(--accent-cyan) 100%)',
              padding: '10px 16px',
              fontSize: '13px',
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textDecoration: 'none',
              boxSizing: 'border-box',
              gap: '6px',
              color: '#ffffff'
            }}
          >
            🌐 Open Website
          </a>
        )}

        {nodeType.toLowerCase() !== 'person' && nodeType.toLowerCase() !== 'investigation' && nodeType.toLowerCase() !== 'suspect' && onAddToNode && (
          <button
            className="btn-primary"
            style={{
              marginTop: '12px',
              background: 'linear-gradient(135deg, var(--accent-purple) 0%, var(--accent-cyan) 100%)',
              padding: '10px 16px',
              fontSize: '13px',
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
            onClick={() => onAddToNode({ id, label, nodeType, properties })}
          >
            🪢 Add this to Suspect Node
          </button>
        )}
      </div>
    );
  }

  // Fallback: show investigation summary when no node selected
  if (investigation) {
    return (
      <div>
        <h2 className="detail-title">
          <span aria-hidden="true">📋</span>
          Investigation Details
        </h2>
        <div className="detail-grid">
          {[
            ['ID', investigation.investigation_id || investigation.id],
            ['Query', investigation.query],
            ['Type', investigation.query_type],
            ['Status', investigation.status],
            ['Created', investigation.created_at],
            ['Updated', investigation.updated_at],
          ].map(([k, v]) =>
            v != null ? (
              <div key={k} className="detail-row">
                <span className="detail-key">{k}</span>
                <span className="detail-val">{String(v)}</span>
              </div>
            ) : null
          )}
        </div>
        {investigation.error_message && (
          <div className="error-message" style={{ marginTop: 12 }}>
            <span aria-hidden="true">⚠️</span>
            {investigation.error_message}
          </div>
        )}
      </div>
    );
  }
}

function AddToNodeModal({ entity, investigationId, onClose, onSuccess }) {
  const [people, setPeople] = useState([]);
  const [targetType, setTargetType] = useState('existing'); // existing | new
  const [selectedPersonId, setSelectedPersonId] = useState('');
  const [newPersonName, setNewPersonName] = useState('');
  const [targetField, setTargetField] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Fetch all suspects
  useEffect(() => {
    getPeople().then(res => {
      setPeople(res.data || []);
      if (res.data && res.data.length > 0) {
        setSelectedPersonId(res.data[0].node_id);
      }
    }).catch(err => console.error(err));
  }, []);

  // Infer target field based on evidence type
  useEffect(() => {
    if (!entity) return;
    const type = (entity.nodeType || '').toLowerCase();
    if (type === 'email') {
      setTargetField('email');
    } else if (type === 'phonenumber' || type === 'phone') {
      setTargetField('phone_number');
    } else if (type === 'username') {
      setTargetField('social_media_id');
    } else {
      setTargetField('links');
    }
  }, [entity]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!entity || !investigationId) return;
    
    setIsSaving(true);
    setErrorMessage('');

    try {
      const evidenceValue = entity.label; // e.g. the email address or username string

      if (targetType === 'new') {
        if (!newPersonName.trim()) {
          setErrorMessage('Please enter a name for the new suspect.');
          setIsSaving(false);
          return;
        }

        // Create a new Person node
        const personData = {
          name: newPersonName.trim(),
          email: targetField === 'email' ? evidenceValue : '',
          phone_number: targetField === 'phone_number' ? evidenceValue : '',
          social_media_id: targetField === 'social_media_id' ? evidenceValue : '',
          picture: '',
          links: targetField === 'links' ? evidenceValue : '',
          label: 'Person'
        };

        await createPerson(investigationId, personData);
      } else {
        if (!selectedPersonId) {
          setErrorMessage('Please select a suspect.');
          setIsSaving(false);
          return;
        }

        // Find existing suspect
        const person = people.find(p => p.node_id === selectedPersonId);
        if (!person) {
          setErrorMessage('Selected suspect not found.');
          setIsSaving(false);
          return;
        }

        // Update properties
        const updatedProperties = {
          name: person.name,
          email: targetField === 'email' ? evidenceValue : person.email,
          phone_number: targetField === 'phone_number' ? evidenceValue : person.phone_number,
          social_media_id: targetField === 'social_media_id' ? evidenceValue : person.social_media_id,
          picture: person.picture,
          links: targetField === 'links' ? (person.links ? `${person.links}\n${evidenceValue}` : evidenceValue) : person.links,
          label: 'Person'
        };

        await updatePerson(selectedPersonId, updatedProperties);
      }

      onSuccess();
    } catch (err) {
      console.error(err);
      const msg = err.response?.data?.detail || 'Failed to assign evidence to suspect.';
      setErrorMessage(msg);
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content glass-card" style={{ width: '450px', display: 'flex', flexDirection: 'column' }}>
        <div className="section-header">
          <div className="section-title">🪢 Add to Suspect Node</div>
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>

        <div style={{ padding: '20px' }}>
          <div style={{ background: 'rgba(255,255,255,0.02)', padding: 12, borderRadius: 6, marginBottom: 16, border: '1px solid var(--border-subtle)' }}>
            <div className="detail-key" style={{ fontSize: 10, textTransform: 'uppercase' }}>Evidence Item</div>
            <div className="detail-val" style={{ fontSize: 13, fontWeight: '600', color: 'var(--accent-cyan)', marginTop: 2 }}>
              {entity.label} ({entity.nodeType})
            </div>
          </div>

          {errorMessage && (
            <div className="error-message" style={{ marginBottom: 14 }}>
              <span>⚠️</span>
              {errorMessage}
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label className="detail-key" style={{ fontSize: 11, marginBottom: 4, display: 'block' }}>Destination Option</label>
              <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="targetType"
                    checked={targetType === 'existing'}
                    onChange={() => setTargetType('existing')}
                  />
                  Link to Existing Suspect
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="targetType"
                    checked={targetType === 'new'}
                    onChange={() => setTargetType('new')}
                  />
                  Create New Suspect Node
                </label>
              </div>
            </div>

            {targetType === 'existing' ? (
              <div>
                <label className="detail-key" style={{ fontSize: 11, marginBottom: 4, display: 'block' }}>Select Suspect</label>
                {people.length === 0 ? (
                  <div className="text-muted" style={{ fontSize: 11, padding: '8px 0' }}>No suspects found on the board. Please create a new suspect.</div>
                ) : (
                  <select
                    className="search-input"
                    style={{ background: '#070715', padding: '8px 12px', width: '100%' }}
                    value={selectedPersonId}
                    onChange={(e) => setSelectedPersonId(e.target.value)}
                    required
                  >
                    {people.map(p => (
                      <option key={p.node_id} value={p.node_id}>{p.name}</option>
                    ))}
                  </select>
                )}
              </div>
            ) : (
              <div>
                <label className="detail-key" style={{ fontSize: 11, marginBottom: 4, display: 'block' }}>New Suspect Name</label>
                <input
                  className="search-input"
                  value={newPersonName}
                  onChange={(e) => setNewPersonName(e.target.value)}
                  placeholder="e.g. John Doe"
                  required
                />
              </div>
            )}

            <div>
              <label className="detail-key" style={{ fontSize: 11, marginBottom: 4, display: 'block' }}>Assign Evidence Value To Field</label>
              <select
                className="search-input"
                style={{ background: '#070715', padding: '8px 12px', width: '100%' }}
                value={targetField}
                onChange={(e) => setTargetField(e.target.value)}
                required
              >
                <option value="email">Email Address</option>
                <option value="phone_number">Phone Number</option>
                <option value="social_media_id">Social Media ID (Username)</option>
                <option value="links">Related Links</option>
              </select>
            </div>

            <button className="btn-primary" type="submit" disabled={isSaving}>
              {isSaving ? <div className="spinner" /> : (targetType === 'new' ? 'Create Suspect & Add' : 'Link to Suspect')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { investigate, investigation, graphData, isLoading, error, clearInvestigation, fetchGraph } =
    useInvestigation();

  const [activeTab, setActiveTab] = useState('results'); // results | graph | analysis
  const [selectedNode, setSelectedNode] = useState(null);
  const [investigationCount, setInvestigationCount] = useState(0);
  const [isAddToNodeModalOpen, setIsAddToNodeModalOpen] = useState(false);
  const [addToNodeEntity, setAddToNodeEntity] = useState(null);

  const handleInvestigate = (query, queryType) => {
    setSelectedNode(null);
    setInvestigationCount((c) => c + 1);
    investigate(query, queryType);
  };

  const handleEntityClick = (entity) => {
    const nodeId = entity.id || entity.node_id || `${entity.entity_type || 'Entity'}-${entity.value}`;
    setSelectedNode({ id: nodeId, data: entity });
  };

  const handleRefreshGraph = () => {
    const invId = investigation?.investigation_id || investigation?.id;
    if (invId) {
      fetchGraph(invId);
    }
  };

  const handleOpenAddToNode = (entity) => {
    setAddToNodeEntity(entity);
    setIsAddToNodeModalOpen(true);
  };

  const handleCloseAddToNode = () => {
    setIsAddToNodeModalOpen(false);
    setAddToNodeEntity(null);
  };

  const handleAddToNodeSuccess = () => {
    setIsAddToNodeModalOpen(false);
    setAddToNodeEntity(null);
    handleRefreshGraph();
  };

  return (
    <>
      {/* Subtle grid background */}
      <div className="grid-bg" aria-hidden="true" />

      <div className="app-wrapper">
        {/* ── Header ── */}
        <Header activeTab={activeTab} setActiveTab={setActiveTab} investigationCount={investigationCount} />

        {/* ── Tabbed Content layout ── */}
        {activeTab === 'results' && (
          <div className="app-layout animate-appear">
            {/* COLUMN 1: SEARCH PANEL */}
            <aside className="sidebar search-sidebar" aria-label="Investigation query">
              <SearchPanel
                onInvestigate={handleInvestigate}
                isLoading={isLoading}
                error={error}
              />
            </aside>

            {/* COLUMN 2: RESULTS PANEL */}
            <aside className="sidebar results-sidebar" aria-label="Investigation results">
              <ResultsPanel
                investigation={investigation}
                isLoading={isLoading}
                onEntityClick={handleEntityClick}
              />
            </aside>

            {/* COLUMN 3: DETAIL PANEL */}
            <main className="main-content details-panel-container" aria-label="Investigation details" style={{ overflowY: 'auto', padding: '24px' }}>
              <div className="detail-panel" style={{ flex: '1 1 auto', width: '100%', height: '100%', background: 'transparent' }}>
                <DetailPanel
                  selectedNode={selectedNode}
                  investigation={investigation}
                  onAddToNode={handleOpenAddToNode}
                />
              </div>
            </main>
          </div>
        )}

        {activeTab === 'graph' && (
          <div className="app-layout" style={{ flexDirection: 'column' }}>
            <main className="main-content" aria-label="Corkboard Suspect Map" style={{ flex: 1 }}>
              <CorkboardGraph
                graphData={graphData}
                isLoading={isLoading}
                onRefresh={handleRefreshGraph}
                investigationId={investigation?.investigation_id || investigation?.id}
              />
            </main>
          </div>
        )}

        {activeTab === 'analysis' && (
          <div className="app-layout" style={{ flexDirection: 'column' }}>
            <main className="main-content animate-appear" aria-label="CDR/IPDR Syndicate Analysis" style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
              <AnalysisPage />
            </main>
          </div>
        )}
      </div>

      {isAddToNodeModalOpen && addToNodeEntity && (
        <AddToNodeModal
          entity={addToNodeEntity}
          investigationId={investigation?.investigation_id || investigation?.id}
          onClose={handleCloseAddToNode}
          onSuccess={handleAddToNodeSuccess}
        />
      )}
    </>
  );
}
