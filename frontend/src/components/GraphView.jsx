import { useEffect, useRef, useState, useCallback } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import { circular } from 'graphology-layout';

// Node colors by type
const NODE_COLORS = {
  Investigation: '#7c3aed',
  Username: '#06b6d4',
  Website: '#10b981',
  Email: '#f59e0b',
  PhoneNumber: '#ef4444',
  Person: '#ec4899',
  Organization: '#8b5cf6',
  Location: '#84cc16',
};

// Node sizes by type
const NODE_SIZES = {
  Investigation: 20,
  Person: 15,
  Username: 12,
  Email: 12,
  PhoneNumber: 12,
  Website: 10,
  Organization: 13,
  Location: 11,
};

export default function GraphView({ graphData, onNodeClick, isLoading }) {
  const containerRef = useRef(null);
  const sigmaRef = useRef(null);
  const graphRef = useRef(null);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [nodeCount, setNodeCount] = useState(0);
  const [edgeCount, setEdgeCount] = useState(0);

  // Build and initialize Sigma
  useEffect(() => {
    if (!containerRef.current) return;

    // Kill previous sigma instance cleanly
    if (sigmaRef.current) {
      try { sigmaRef.current.kill(); } catch (_) {}
      sigmaRef.current = null;
    }

    if (!graphData || !graphData.nodes || graphData.nodes.length === 0) {
      setNodeCount(0);
      setEdgeCount(0);
      return;
    }

    const graph = new Graph({ multi: false, type: 'mixed' });
    graphRef.current = graph;

    // Add nodes
    graphData.nodes.forEach((node, i) => {
      if (!graph.hasNode(node.id)) {
        graph.addNode(node.id, {
          label: node.label || node.id,
          size: NODE_SIZES[node.node_type] || 10,
          color: NODE_COLORS[node.node_type] || '#7c85a0',
          nodeType: node.node_type,
          // Spread properties for detail view
          ...(node.properties || {}),
          // Initial circular positions
          x: Math.cos((i / graphData.nodes.length) * 2 * Math.PI) * 100,
          y: Math.sin((i / graphData.nodes.length) * 2 * Math.PI) * 100,
        });
      }
    });

    // Add edges
    let edgesAdded = 0;
    graphData.edges.forEach((edge) => {
      if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) return;
      const edgeKey = `${edge.source}--${edge.target}`;
      if (!graph.hasEdge(edgeKey)) {
        try {
          graph.addEdgeWithKey(edgeKey, edge.source, edge.target, {
            label: edge.label || edge.relationship_type || '',
            size: 2,
            color: 'rgba(124, 58, 237, 0.45)',
          });
          edgesAdded++;
        } catch (_) {}
      }
    });

    // Apply circular layout
    circular.assign(graph);

    setNodeCount(graph.order);
    setEdgeCount(edgesAdded);

    // Init sigma with dark theme settings
    const sigma = new Sigma(graph, containerRef.current, {
      renderEdgeLabels: true,
      defaultEdgeType: 'arrow',
      labelFont: 'Inter, sans-serif',
      labelSize: 12,
      labelColor: { color: '#f1f5f9' },
      edgeLabelSize: 10,
      edgeLabelColor: { color: '#94a3b8' },
      defaultNodeType: 'circle',
      minCameraRatio: 0.05,
      maxCameraRatio: 4,
    });
    sigmaRef.current = sigma;

    // Events
    sigma.on('clickNode', ({ node }) => {
      const attrs = graph.getNodeAttributes(node);
      if (onNodeClick) onNodeClick(node, attrs);
    });

    sigma.on('enterNode', ({ node }) => {
      setHoveredNode(node);
      containerRef.current.style.cursor = 'pointer';
    });

    sigma.on('leaveNode', () => {
      setHoveredNode(null);
      containerRef.current.style.cursor = 'default';
    });

    // Cleanup
    return () => {
      if (sigma) {
        try { sigma.kill(); } catch (_) {}
      }
    };
  }, [graphData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Zoom controls
  const zoomIn = useCallback(() => {
    sigmaRef.current?.getCamera().animatedZoom({ duration: 300 });
  }, []);

  const zoomOut = useCallback(() => {
    sigmaRef.current?.getCamera().animatedUnzoom({ duration: 300 });
  }, []);

  const resetCamera = useCallback(() => {
    sigmaRef.current?.getCamera().animatedReset({ duration: 300 });
  }, []);

  // Node search / highlight
  const handleSearch = useCallback((term) => {
    setSearchTerm(term);
    const graph = graphRef.current;
    const sigma = sigmaRef.current;
    if (!graph || !sigma) return;

    graph.forEachNode((node, attrs) => {
      const matches = !term || (attrs.label || '').toLowerCase().includes(term.toLowerCase());
      graph.setNodeAttribute(node, 'color',
        matches
          ? (NODE_COLORS[attrs.nodeType] || '#7c85a0')
          : 'rgba(100,100,100,0.2)'
      );
      graph.setNodeAttribute(node, 'size',
        matches ? (NODE_SIZES[attrs.nodeType] || 10) : 3
      );
    });

    sigma.refresh();
  }, []);

  const isEmpty = !graphData || !graphData.nodes || graphData.nodes.length === 0;

  return (
    <div className="graph-container">
      {/* Controls bar */}
      <div className="graph-controls">
        <input
          className="graph-search"
          placeholder="Search nodes..."
          value={searchTerm}
          onChange={(e) => handleSearch(e.target.value)}
          aria-label="Search graph nodes"
          disabled={isEmpty}
        />
        <button className="graph-btn" onClick={zoomIn} title="Zoom In" aria-label="Zoom in" disabled={isEmpty}>+</button>
        <button className="graph-btn" onClick={zoomOut} title="Zoom Out" aria-label="Zoom out" disabled={isEmpty}>−</button>
        <button className="graph-btn" onClick={resetCamera} title="Reset View" aria-label="Reset camera" disabled={isEmpty}>⌖</button>
      </div>

      {/* Scanning overlay during loading */}
      {isLoading && (
        <div className="scanning-overlay" aria-hidden="true">
          <div className="scan-line" />
        </div>
      )}

      {/* Empty state */}
      {isEmpty && !isLoading && (
        <div className="graph-empty" aria-label="Graph empty state">
          <div className="graph-empty-icon" aria-hidden="true">◎</div>
          <p>Run an investigation to see the relationship graph</p>
          <p className="text-muted" style={{ fontSize: 11 }}>
            Entities and their connections will appear here
          </p>
        </div>
      )}

      {/* Sigma container */}
      <div
        ref={containerRef}
        className="sigma-container"
        aria-label={isEmpty ? 'Empty graph canvas' : `Graph with ${nodeCount} nodes and ${edgeCount} edges`}
        role="img"
      />

      {/* Stats overlay */}
      {!isEmpty && (
        <div
          style={{
            position: 'absolute',
            top: 14,
            left: 14,
            display: 'flex',
            gap: 8,
            fontSize: 11,
            color: 'var(--text-muted)',
            background: 'rgba(15,15,15,0.8)',
            padding: '4px 10px',
            borderRadius: 99,
            border: '1px solid var(--border-subtle)',
            backdropFilter: 'blur(6px)',
          }}
          aria-live="polite"
        >
          <span>{nodeCount} nodes</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span>{edgeCount} edges</span>
          {hoveredNode && (
            <>
              <span style={{ opacity: 0.4 }}>·</span>
              <span style={{ color: 'var(--accent-cyan)' }}>
                {graphRef.current?.getNodeAttribute(hoveredNode, 'label') || hoveredNode}
              </span>
            </>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="graph-legend" aria-label="Graph node type legend">
        {Object.entries(NODE_COLORS).map(([type, color]) => (
          <span key={type} className="legend-item">
            <span className="legend-dot" style={{ background: color }} aria-hidden="true" />
            {type}
          </span>
        ))}
      </div>
    </div>
  );
}
