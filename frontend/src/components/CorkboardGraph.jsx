import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { updatePerson, uploadCDR, uploadIPDR, getPersonAnalysis, createPerson, createRelationship, deleteNode, getPeople } from '../api/client';

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

export default function CorkboardGraph({ graphData, isLoading, onRefresh, investigationId }) {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [positions, setPositions] = useState({});
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  
  // Dragging node state
  const [draggedNode, setDraggedNode] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const panRef = useRef(pan);
  panRef.current = pan;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  
  // Modal / Dialog state
  const [activeNode, setActiveNode] = useState(null);
  const [editForm, setEditForm] = useState({
    name: '',
    email: '',
    phone_number: '',
    social_media_id: '',
    picture: '',
    links: '',
  });
  const [dialogTab, setDialogTab] = useState('details'); // details | cdr | ipdr
  const [cdrViewMode, setCdrViewMode] = useState('dashboard'); // dashboard | text | json
  const [ipdrViewMode, setIpdrViewMode] = useState('dashboard'); // dashboard | text | json
  const [cdrText, setCdrText] = useState('');
  const [ipdrText, setIpdrText] = useState('');
  const [uploadStatus, setUploadStatus] = useState({ type: '', message: '' }); // success | error | loading
  const [isSaving, setIsSaving] = useState(false);

  // Add Suspect Modal
  const [isAddSuspectOpen, setIsAddSuspectOpen] = useState(false);
  const [addSuspectForm, setAddSuspectForm] = useState({
    name: '',
    email: '',
    phone_number: '',
    social_media_id: '',
    picture: '',
    links: '',
  });

  // Add Connection Modal
  const [isAddConnectionOpen, setIsAddConnectionOpen] = useState(false);
  const [addConnectionForm, setAddConnectionForm] = useState({
    fromNodeId: '',
    toNodeId: '',
    label: 'CALLED',
  });

  // Add Existing Modal
  const [isAddExistingOpen, setIsAddExistingOpen] = useState(false);
  const [existingPeople, setExistingPeople] = useState([]);
  const [selectedExistingId, setSelectedExistingId] = useState('');

  const boardRef = useRef(null);
  const canvasRef = useRef(null);

  // Wheel zoom effect
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e) => {
      e.preventDefault();
      const zoomFactor = 0.05;
      setZoom((prevZoom) => {
        if (e.deltaY < 0) {
          return Math.min(2.0, prevZoom + zoomFactor);
        } else {
          return Math.max(0.4, prevZoom - zoomFactor);
        }
      });
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', handleWheel);
    };
  }, []);

  // Auto-center board when nodes are first loaded
  const hasCenteredRef = useRef(false);

  const centerWorkspace = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const canvasWidth = canvas.clientWidth;
    const canvasHeight = canvas.clientHeight;
    
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    
    nodes.forEach(node => {
      const pos = positionsRef.current[node.id];
      if (pos && !isNaN(pos.x) && !isNaN(pos.y)) {
        if (pos.x < minX) minX = pos.x;
        if (pos.x > maxX) maxX = pos.x;
        if (pos.y < minY) minY = pos.y;
        if (pos.y > maxY) maxY = pos.y;
      }
    });
    
    const targetZoom = 1;
    setZoom(targetZoom);
    
    if (minX !== Infinity) {
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      setPan({
        x: canvasWidth / 2 - centerX * targetZoom,
        y: canvasHeight / 2 - centerY * targetZoom,
      });
    } else {
      setPan({
        x: canvasWidth / 2 - 1250 * targetZoom,
        y: canvasHeight / 2 - 1000 * targetZoom,
      });
    }
  }, [nodes]);

  useEffect(() => {
    if (nodes.length > 0 && Object.keys(positions).length > 0 && !hasCenteredRef.current) {
      hasCenteredRef.current = true;
      // Delay slightly to ensure canvas clientWidth/clientHeight are populated
      setTimeout(() => {
        centerWorkspace();
      }, 100);
    }
  }, [nodes, positions, centerWorkspace]);

  // Load and layout graph nodes
  useEffect(() => {
    if (!graphData || !graphData.nodes) {
      setNodes([]);
      setEdges([]);
      return;
    }
    // Load saved positions if they exist
    let savedPositions = {};
    if (investigationId) {
      try {
        const saved = JSON.parse(localStorage.getItem(`corkboard_pos_${investigationId}`) || '{}');
        savedPositions = saved;
      } catch (e) {
        console.error('Failed to parse saved positions:', e);
      }
    }

    // Filter to keep ONLY Person and suspect nodes
    const filteredNodes = graphData.nodes.filter(
      node => node.node_type === 'Person' || node.node_type === 'suspect'
    );

    // Calculate viewport center in board coordinates
    const canvas = boardRef.current?.parentElement;
    let boardCenterX = 1250;
    let boardCenterY = 1000;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      boardCenterX = (rect.width / 2 - panRef.current.x) / zoomRef.current;
      boardCenterY = (rect.height / 2 - panRef.current.y) / zoomRef.current;
    }

    const initialPos = {};
    const processedNodes = filteredNodes.map((node, i) => {
      const saved = savedPositions[node.id];
      let x, y;
      
      if (saved) {
        x = saved.x;
        y = saved.y;
      } else if (positionsRef.current && positionsRef.current[node.id]) {
        // Keep existing layout position if we already computed/assigned it
        x = positionsRef.current[node.id].x;
        y = positionsRef.current[node.id].y;
      } else if (typeof node.x === 'number' && typeof node.y === 'number') {
        const scale = 2.2;
        x = node.x * scale + 1250;
        y = node.y * scale + 1000;
      } else {
        // New node: place at viewport center!
        x = boardCenterX;
        y = boardCenterY;
      }
      
      initialPos[node.id] = { x, y };
      return node;
    });

    // Filter edges to only connect nodes that exist in our filtered list
    const personIds = new Set(processedNodes.map(n => n.id));
    const processedEdges = (graphData.edges || []).filter(
      edge => personIds.has(edge.source) && personIds.has(edge.target)
    );

    setPositions(initialPos);
    setNodes(processedNodes);
    setEdges(processedEdges);

  }, [graphData, investigationId]);

  // Sync activeNode with the updated node details if the dialog is open
  useEffect(() => {
    if (activeNode) {
      const freshNode = nodes.find(n => n.id === activeNode.id);
      if (freshNode) {
        // Only update if metadata or label has actually changed to prevent infinite re-render loop
        if (JSON.stringify(freshNode.metadata) !== JSON.stringify(activeNode.metadata) || freshNode.label !== activeNode.label) {
          setActiveNode(freshNode);
        }
      }
    }
  }, [nodes, activeNode]);

  // Handle board panning
  const handleBoardMouseDown = (e) => {
    const isNodeCard = e.target.closest('.node-card-draggable');
    const isModal = e.target.closest('.modal-overlay') || e.target.closest('.modal-content');
    const isButton = e.target.closest('button') || e.target.closest('select') || e.target.closest('input') || e.target.closest('a');
    
    if (!isNodeCard && !isModal && !isButton) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleBoardMouseMove = (e) => {
    if (isPanning) {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
    } else if (draggedNode) {
      // Update dragged node position relative to static parent canvas rect
      const canvas = boardRef.current?.parentElement;
      if (!canvas) return;
      
      const canvasRect = canvas.getBoundingClientRect();
      const x = (e.clientX - canvasRect.left - pan.x) / zoom;
      const y = (e.clientY - canvasRect.top - pan.y) / zoom;
      
      const newPos = { x: x - dragOffset.x, y: y - dragOffset.y };
      setPositions((prev) => {
        const updated = {
          ...prev,
          [draggedNode]: newPos,
        };
        if (investigationId) {
          try {
            localStorage.setItem(`corkboard_pos_${investigationId}`, JSON.stringify(updated));
          } catch (e) {}
        }
        return updated;
      });
    }
  };

  const handleBoardMouseUp = () => {
    setIsPanning(false);
    setDraggedNode(null);
  };

  // Node Dragging Handlers
  const handleNodeMouseDown = (e, nodeId) => {
    e.stopPropagation();
    const pos = positions[nodeId] || { x: 0, y: 0 };
    const canvas = boardRef.current?.parentElement;
    if (!canvas) return;
    
    const canvasRect = canvas.getBoundingClientRect();
    
    // Calculate cursor offset relative to the node's position on the board
    const cursorX = (e.clientX - canvasRect.left - pan.x) / zoom;
    const cursorY = (e.clientY - canvasRect.top - pan.y) / zoom;
    
    setDragOffset({
      x: cursorX - pos.x,
      y: cursorY - pos.y,
    });
    setDraggedNode(nodeId);
  };

  // Form submits for manual creation
  const handleAddSuspectPictureChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setAddSuspectForm((prev) => ({ ...prev, picture: reader.result }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAddSuspectSubmit = async (e) => {
    e.preventDefault();
    if (!investigationId) return;
    setIsSaving(true);
    setUploadStatus({ type: 'loading', message: 'Creating manual suspect...' });
    
    try {
      await createPerson(investigationId, {
        name: addSuspectForm.name,
        email: addSuspectForm.email,
        phone_number: addSuspectForm.phone_number,
        social_media_id: addSuspectForm.social_media_id,
        picture: addSuspectForm.picture,
        links: addSuspectForm.links,
        label: 'Person',
      });
      
      setUploadStatus({ type: 'success', message: 'Suspect created and added to board!' });
      setAddSuspectForm({
        name: '',
        email: '',
        phone_number: '',
        social_media_id: '',
        picture: '',
        links: '',
      });
      setIsAddSuspectOpen(false);
      setIsSaving(false);
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error(err);
      const msg = err.response?.data?.detail || 'Failed to create suspect.';
      setUploadStatus({ type: 'error', message: msg });
      setIsSaving(false);
    }
  };

  const handleOpenAddExisting = async () => {
    try {
      setUploadStatus({ type: '', message: '' });
      const res = await getPeople();
      setExistingPeople(res.data || []);
      if (res.data && res.data.length > 0) {
        setSelectedExistingId(res.data[0].node_id);
      }
      setIsAddExistingOpen(true);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddExistingSubmit = async (e) => {
    e.preventDefault();
    if (!selectedExistingId || !investigationId) return;
    setIsSaving(true);
    try {
      await createRelationship({
        from_node_id: investigationId,
        to_node_id: selectedExistingId,
        label: 'CONTAINS'
      });
      setIsAddExistingOpen(false);
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error(err);
      alert('Failed to add existing node.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddConnectionSubmit = async (e) => {
    e.preventDefault();
    if (!addConnectionForm.fromNodeId || !addConnectionForm.toNodeId) {
      setUploadStatus({ type: 'error', message: 'Please select both source and target nodes.' });
      return;
    }
    if (addConnectionForm.fromNodeId === addConnectionForm.toNodeId) {
      setUploadStatus({ type: 'error', message: 'Cannot connect a node to itself.' });
      return;
    }
    
    setIsSaving(true);
    setUploadStatus({ type: 'loading', message: 'Creating connection wire...' });
    
    try {
      await createRelationship({
        from_node_id: addConnectionForm.fromNodeId,
        to_node_id: addConnectionForm.toNodeId,
        label: addConnectionForm.label.toUpperCase().trim(),
      });
      
      setUploadStatus({ type: 'success', message: 'Connection wire created successfully!' });
      setAddConnectionForm({
        fromNodeId: '',
        toNodeId: '',
        label: 'CALLED',
      });
      setIsAddConnectionOpen(false);
      setIsSaving(false);
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error(err);
      const msg = err.response?.data?.detail || 'Failed to create connection.';
      setUploadStatus({ type: 'error', message: msg });
      setIsSaving(false);
    }
  };

  // Open Edit Profile Dialog
  const handleNodeClick = async (node) => {
    setActiveNode(node);
    setDialogTab('details');
    setUploadStatus({ type: '', message: '' });
    
    const meta = node.metadata || {};
    setEditForm({
      name: node.label || '',
      email: meta.email || '',
      phone_number: meta.phone_number || '',
      social_media_id: meta.social_media_id || '',
      picture: meta.picture || '',
      links: meta.links || '',
    });
    
    setCdrText(meta.cdr_data || '');
    setIpdrText(meta.ipdr_data || '');
  };

  // Picture file upload helper
  const handlePictureChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setEditForm((prev) => ({ ...prev, picture: reader.result }));
      };
      reader.readAsDataURL(file);
    }
  };

  // Save suspect details updates
  const handleSaveDetails = async (e) => {
    e.preventDefault();
    if (!activeNode) return;
    setIsSaving(true);
    setUploadStatus({ type: 'loading', message: 'Saving profile...' });
    
    try {
      await updatePerson(activeNode.id, {
        name: editForm.name,
        email: editForm.email,
        phone_number: editForm.phone_number,
        social_media_id: editForm.social_media_id,
        picture: editForm.picture,
        links: editForm.links,
        label: activeNode.node_type === 'Investigation' ? 'Investigation' : 'Person',
      });
      
      setUploadStatus({ type: 'success', message: 'Profile updated successfully!' });
      setIsSaving(false);
      
      // Update node details locally in graph nodes
      setNodes((prev) =>
        prev.map((n) =>
          n.id === activeNode.id
            ? {
                ...n,
                label: editForm.name,
                metadata: {
                  ...n.metadata,
                  email: editForm.email,
                  phone_number: editForm.phone_number,
                  social_media_id: editForm.social_media_id,
                  picture: editForm.picture,
                  links: editForm.links,
                },
                // Promote edited non-investigation nodes to Person
                node_type: n.node_type === 'Investigation' ? 'Investigation' : 'Person',
              }
            : n
        )
      );

      // Trigger board refresh in parent
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error(err);
      setUploadStatus({ type: 'error', message: 'Failed to update profile.' });
      setIsSaving(false);
    }
  };

  const handleDownloadReport = () => {
    const reportText = `
========================================
SUSPECT INTELLIGENCE REPORT
========================================
Name: ${editForm.name || 'Unknown'}
Email: ${editForm.email || 'N/A'}
Phone Number: ${editForm.phone_number || 'N/A'}
Social Media / Username ID: ${editForm.social_media_id || 'N/A'}

Related Links:
${editForm.links || 'N/A'}

========================================
CDR ANALYSIS (CALL DATA RECORDS)
========================================
${cdrText || 'No CDR data available.'}

========================================
IPDR ANALYSIS (INTERNET PROTOCOL LOGS)
========================================
${ipdrText || 'No IPDR data available.'}
    `.trim();

    const blob = new Blob([reportText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `suspect_report_${editForm.name || 'unknown'}.txt`.replace(/\s+/g, '_');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDeleteNode = async () => {
    if (!activeNode) return;
    if (!window.confirm("Are you sure you want to delete this node? This action cannot be undone.")) return;
    
    try {
      await deleteNode(activeNode.id);
      setActiveNode(null);
      
      // Update local state
      setNodes((prev) => prev.filter(n => n.id !== activeNode.id));
      setEdges((prev) => prev.filter(e => e.source !== activeNode.id && e.target !== activeNode.id));

      if (onRefresh) onRefresh();
    } catch (err) {
      console.error('Failed to delete node:', err);
      alert('Failed to delete node.');
    }
  };

  const validateCDRText = (text) => {
    if (!text || typeof text !== 'string') return false;
    const lines = text.trim().split('\n');
    let validLinesCount = 0;
    let totalDataLines = 0;

    for (let line of lines) {
      line = line.trim();
      if (!line) continue;
      
      const lowerLine = line.toLowerCase();
      if (lowerLine.includes('caller') || lowerLine.includes('called') || lowerLine.includes('calling') || lowerLine.includes('recipient') || lowerLine.includes('phone') || lowerLine.includes('duration') || lowerLine.includes('timestamp') || lowerLine.includes('type')) {
        continue;
      }
      
      totalDataLines++;
      const parts = line.split(/[\t,;]+/).map(p => p.trim().replace(/^['"]+|['"]+$/g, ''));
      if (parts.length < 2) continue;

      let phones = [];
      const phoneRegex = /^\d{7,15}$/;
      const isDatePattern = /^\d{4}-\d{2}-\d{2}/;

      for (let p of parts) {
        const cleanP = p.replace(/[\s\-\(\)\+]/g, '');
        if (phoneRegex.test(cleanP) && !isDatePattern.test(p)) {
          phones.push(p);
        }
      }
      
      if (phones.length >= 1) {
        validLinesCount++;
      }
    }

    return validLinesCount > 0;
  };

  const validateIPDRText = (text) => {
    if (!text || typeof text !== 'string') return false;
    const lines = text.trim().split('\n');
    let validLinesCount = 0;
    let totalDataLines = 0;

    const ipv4Pattern = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
    const ipv6Pattern = /^(?:[A-Fa-f0-9]{1,4}:){7}[A-Fa-f0-9]{1,4}$/;

    for (let line of lines) {
      line = line.trim();
      if (!line) continue;

      const lowerLine = line.toLowerCase();
      if (lowerLine.includes('subscriber ip') || lowerLine.includes('destination ip') || lowerLine.includes('bytes') || lowerLine.includes('protocol')) {
        continue;
      }

      totalDataLines++;
      const parts = line.split(/[\t,;]+/).map(p => p.trim().replace(/^['"]+|['"]+$/g, ''));
      if (parts.length < 2) continue;

      let ips = [];
      for (let p of parts) {
        if (ipv4Pattern.test(p) || ipv6Pattern.test(p)) {
          ips.push(p);
        }
      }

      if (ips.length >= 2) {
        validLinesCount++;
      }
    }

    return validLinesCount > 0;
  };

  // CDR Upload Parser
  const handleCDRSubmit = async () => {
    if (!activeNode) return;
    if (!validateCDRText(cdrText)) {
      setUploadStatus({ type: 'error', message: 'Unsupported file uploaded' });
      return;
    }
    setUploadStatus({ type: 'loading', message: 'Parsing and analyzing CDR logs...' });
    
    try {
      const res = await uploadCDR(activeNode.id, cdrText);
      setUploadStatus({
        type: 'success',
        message: `Parsed ${res.data.records_count} calling records. ${res.data.matches.length} matches found with other suspects!`,
      });
      
      // Update local node state analysis
      setNodes((prev) =>
        prev.map((n) =>
          n.id === activeNode.id
            ? {
                ...n,
                metadata: {
                  ...n.metadata,
                  cdr_data: cdrText,
                  cdr_analysis: res.data.analysis,
                },
              }
            : n
        )
      );
      setActiveNode((prevActive) => {
        if (!prevActive) return null;
        return {
          ...prevActive,
          metadata: {
            ...prevActive.metadata,
            cdr_data: cdrText,
            cdr_analysis: res.data.analysis,
          }
        };
      });
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error(err);
      const msg = err.response?.data?.detail || 'Failed to analyze CDR logs.';
      setUploadStatus({ type: 'error', message: msg });
    }
  };

  // IPDR Upload Parser
  const handleIPDRSubmit = async () => {
    if (!activeNode) return;
    if (!validateIPDRText(ipdrText)) {
      setUploadStatus({ type: 'error', message: 'Unsupported file uploaded' });
      return;
    }
    setUploadStatus({ type: 'loading', message: 'Parsing and analyzing IP traffic logs...' });
    
    try {
      const res = await uploadIPDR(activeNode.id, ipdrText);
      setUploadStatus({
        type: 'success',
        message: `IPDR data parsed (${res.data.records_count} records analyzed). Traffic analysis report generated.`,
      });
      
      // Update local state analysis
      setNodes((prev) =>
        prev.map((n) =>
          n.id === activeNode.id
            ? {
                ...n,
                metadata: {
                  ...n.metadata,
                  ipdr_data: ipdrText,
                  ipdr_analysis: res.data.analysis,
                },
              }
            : n
        )
      );
      setActiveNode((prevActive) => {
        if (!prevActive) return null;
        return {
          ...prevActive,
          metadata: {
            ...prevActive.metadata,
            ipdr_data: ipdrText,
            ipdr_analysis: res.data.analysis,
          }
        };
      });
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error(err);
      const msg = err.response?.data?.detail || 'Failed to analyze IPDR logs.';
      setUploadStatus({ type: 'error', message: msg });
    }
  };

  // Draw red string lines between nodes
  const renderThreads = () => {
    const lines = [];
    const seen = new Set();

    edges.forEach((edge, idx) => {
      const sourcePos = positions[edge.source];
      const targetPos = positions[edge.target];
      if (!sourcePos || !targetPos || isNaN(sourcePos.x) || isNaN(sourcePos.y) || isNaN(targetPos.x) || isNaN(targetPos.y)) return;

      const key = `${edge.source}-${edge.target}-${edge.label}`;
      if (seen.has(key)) return;
      seen.add(key);

      // Add pushpin-to-pushpin center thread line
      // Subtract card heights/widths roughly for offset if needed, or draw pin-to-pin
      const x1 = sourcePos.x;
      const y1 = sourcePos.y;
      const x2 = targetPos.x;
      const y2 = targetPos.y;
      
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;

      lines.push(
        <g key={`edge-${edge.id || idx}`}>
          {/* Thread Shadow Glow */}
          <line
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="rgba(239, 68, 68, 0.4)"
            strokeWidth="5"
            strokeLinecap="round"
          />
          {/* Core Red Thread */}
          <line
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="#ef4444"
            strokeWidth="2"
            strokeLinecap="round"
          />
          {/* Relationship tag in the middle */}
          <g transform={`translate(${midX}, ${midY})`}>
            <rect
              x={-35}
              y={-9}
              width={70}
              height={18}
              rx={4}
              fill="#1e1b4b"
              stroke="#ef4444"
              strokeWidth="1"
            />
            <text
              fill="#f87171"
              fontSize="8"
              fontFamily="JetBrains Mono, monospace"
              textAnchor="middle"
              y="3"
            >
              {edge.label || 'LINK'}
            </text>
          </g>
        </g>
      );
    });
    return lines;
  };

  const isEmpty = nodes.length === 0;

  // Minimap logic
  const getMinimapData = () => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) {
      return { nodes: [], edges: [], viewport: null, bbox: null, canvasSize: { width: 1000, height: 700 } };
    }

    const canvasWidth = canvas.clientWidth;
    const canvasHeight = canvas.clientHeight;
    
    // Get bounding box of all nodes
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    
    nodes.forEach(node => {
      const pos = positions[node.id];
      if (pos && !isNaN(pos.x) && !isNaN(pos.y)) {
        if (pos.x < minX) minX = pos.x;
        if (pos.x > maxX) maxX = pos.x;
        if (pos.y < minY) minY = pos.y;
        if (pos.y > maxY) maxY = pos.y;
      }
    });

    const padding = 200;
    if (minX === Infinity) {
      minX = 0; maxX = 2500; minY = 0; maxY = 2000;
    } else {
      minX -= padding;
      maxX += padding;
      minY -= padding;
      maxY += padding;
    }

    const bboxWidth = maxX - minX;
    const bboxHeight = maxY - minY;

    const minimapWidth = 164; // inner width
    const minimapHeight = 100; // inner height

    const scaleX = minimapWidth / bboxWidth;
    const scaleY = minimapHeight / bboxHeight;
    const mapScale = Math.min(scaleX, scaleY, 0.25);

    const contentWidth = bboxWidth * mapScale;
    const contentHeight = bboxHeight * mapScale;
    const offsetX = (minimapWidth - contentWidth) / 2;
    const offsetY = (minimapHeight - contentHeight) / 2;

    // Map nodes
    const mapNodes = nodes.map(node => {
      const pos = positions[node.id] || { x: 1250, y: 1000 };
      return {
        id: node.id,
        x: offsetX + (pos.x - minX) * mapScale,
        y: offsetY + (pos.y - minY) * mapScale,
        color: NODE_COLORS[node.node_type] || '#ec4899',
      };
    });

    // Map edges
    const mapEdges = edges.map(edge => {
      const sourcePos = positions[edge.source];
      const targetPos = positions[edge.target];
      if (!sourcePos || !targetPos || isNaN(sourcePos.x) || isNaN(sourcePos.y) || isNaN(targetPos.x) || isNaN(targetPos.y)) return null;
      return {
        id: edge.id,
        x1: offsetX + (sourcePos.x - minX) * mapScale,
        y1: offsetY + (sourcePos.y - minY) * mapScale,
        x2: offsetX + (targetPos.x - minX) * mapScale,
        y2: offsetY + (targetPos.y - minY) * mapScale,
      };
    }).filter(Boolean);

    // Map viewport
    const viewLeft = -pan.x / zoom;
    const viewTop = -pan.y / zoom;
    const viewRight = (canvasWidth - pan.x) / zoom;
    const viewBottom = (canvasHeight - pan.y) / zoom;

    const viewport = {
      x: offsetX + (viewLeft - minX) * mapScale,
      y: offsetY + (viewTop - minY) * mapScale,
      width: (viewRight - viewLeft) * mapScale,
      height: (viewBottom - viewTop) * mapScale,
    };

    return {
      nodes: mapNodes,
      edges: mapEdges,
      viewport,
      bbox: { minX, maxX, minY, maxY, mapScale, offsetX, offsetY },
      canvasSize: { width: canvasWidth, height: canvasHeight }
    };
  };

  const handleMinimapClick = (e) => {
    const minimapElement = e.currentTarget;
    const rect = minimapElement.getBoundingClientRect();
    
    // Subtract padding (8px) and header height (24px)
    const clickX = e.clientX - rect.left - 8; 
    const clickY = e.clientY - rect.top - 24;

    const data = getMinimapData();
    if (!data.bbox) return;

    const { minX, minY, mapScale, offsetX, offsetY } = data.bbox;
    const { width: canvasWidth, height: canvasHeight } = data.canvasSize;

    // Convert click position back to board coordinate system
    const boardX = minX + (clickX - offsetX) / mapScale;
    const boardY = minY + (clickY - offsetY) / mapScale;

    // Set pan to center on this board coordinate
    setPan({
      x: canvasWidth / 2 - boardX * zoom,
      y: canvasHeight / 2 - boardY * zoom,
    });
  };

  const handleMinimapMouseMove = (e) => {
    if (e.buttons === 1) {
      handleMinimapClick(e);
    }
  };

  const parseCdrAnalysis = (rawText) => {
    if (!rawText) return { markdown: '', json: null };
    const jsonMatch = rawText.match(/```json\s*([\s\S]*?)\s*```/i);
    let json = null;
    let markdown = rawText;
    if (jsonMatch) {
      try {
        json = JSON.parse(jsonMatch[1].trim());
        markdown = rawText.replace(/```json\s*([\s\S]*?)\s*```/gi, '').trim();
      } catch (e) {
        const bracesMatch = rawText.match(/(\{[\s\S]*\})/);
        if (bracesMatch) {
          try {
            json = JSON.parse(bracesMatch[1].trim());
            markdown = rawText.replace(/(\{[\s\S]*\})/, '').trim();
          } catch (err) {
            console.error("Failed to parse JSON from cdr_analysis:", err);
          }
        }
      }
    } else {
      const bracesMatch = rawText.match(/(\{[\s\S]*\})/);
      if (bracesMatch) {
        try {
          json = JSON.parse(bracesMatch[1].trim());
          markdown = rawText.replace(/(\{[\s\S]*\})/, '').trim();
        } catch (err) {
          console.error("Failed to parse JSON from cdr_analysis:", err);
        }
      }
    }
    return { markdown, json };
  };

  const renderCdrDashboard = (json) => {
    if (!json) return null;
    
    const metrics = json.communication_metrics || {};
    const contacts = json.contact_analysis || {};
    const device = json.device_analysis || {};
    const sim = json.sim_analysis || {};
    const location = json.location_analysis || {};
    const time = json.time_analysis || {};
    const recent = json.recent_48h_analysis || {};
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
      <div className="cdr-dashboard animate-appear" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8 }}>
          <div className="glass-card" style={{ padding: 10, border: '1px solid var(--border-subtle)', background: 'rgba(255, 0, 0, 0.03)', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 9, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Calls</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent-cyan)' }}>{metrics.total_calls ?? 0}</span>
          </div>
          <div className="glass-card" style={{ padding: 10, border: '1px solid var(--border-subtle)', background: 'rgba(16, 185, 129, 0.03)', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 9, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Incoming</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-success)' }}>{metrics.incoming_calls ?? 0}</span>
          </div>
          <div className="glass-card" style={{ padding: 10, border: '1px solid var(--border-subtle)', background: 'rgba(239, 68, 68, 0.03)', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 9, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Outgoing</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-error)' }}>{metrics.outgoing_calls ?? 0}</span>
          </div>
          <div className="glass-card" style={{ padding: 10, border: '1px solid var(--border-subtle)', background: 'rgba(124, 58, 237, 0.03)', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 9, textTransform: 'uppercase', color: 'var(--text-muted)' }}>SMS</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent-purple-light)' }}>{metrics.total_sms ?? 0}</span>
          </div>
          <div className="glass-card" style={{ padding: 10, border: '1px solid var(--border-subtle)', background: 'rgba(245, 158, 11, 0.03)', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 9, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Duration</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-warning)', marginTop: 2 }}>{formatDuration(metrics.total_duration_sec)}</span>
          </div>
        </div>

        {/* Recent 48 Hour Analysis Block */}
        {recent.observed && (
          <div className="analysis-report-box" style={{ borderColor: 'rgba(255, 0, 0, 0.35)', background: 'rgba(255, 0, 0, 0.02)' }}>
            <div className="report-header" style={{ color: 'var(--accent-cyan)', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', fontSize: 10 }}>⚡ Recent 48-Hour Intelligence Summary</div>
            <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--text-primary)', lineHeight: '1.4' }}>{recent.summary}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, borderTop: '1px solid var(--border-subtle)', paddingTop: 8, fontSize: 10 }}>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Location</span>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginTop: 2 }}>{recent.last_known_location || 'N/A'}</div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>IMEI</span>
                  <div style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-primary)', marginTop: 2 }}>{recent.last_known_device || 'N/A'}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="analysis-report-box" style={{ background: 'rgba(15, 15, 15, 0.4)' }}>
          <div className="report-header" style={{ color: 'var(--accent-cyan)', padding: '6px 12px', fontSize: 10 }}>👥 Top Interacted Contacts</div>
          <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {contacts.most_frequently_contacted && contacts.most_frequently_contacted.length > 0 ? (
              contacts.most_frequently_contacted.slice(0, 3).map((c, idx) => {
                const maxCount = Math.max(...contacts.most_frequently_contacted.map(item => item.count || 1), 1);
                const pct = Math.round(((c.count || 0) / maxCount) * 100);
                return (
                  <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{c.phone_number}</span>
                      <span style={{ color: 'var(--text-muted)' }}>{c.count} calls ({c.type})</span>
                    </div>
                    <div style={{ height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, var(--accent-purple), var(--accent-cyan))', borderRadius: 2 }} />
                    </div>
                  </div>
                );
              })
            ) : (
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>No contact logs extracted.</div>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="analysis-report-box" style={{ background: 'rgba(15, 15, 15, 0.4)' }}>
            <div className="report-header" style={{ color: 'var(--color-warning)', padding: '6px 12px', fontSize: 10 }}>📍 Primary Locations</div>
            <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10 }}>
              {location.frequent_towers && location.frequent_towers.length > 0 ? (
                location.frequent_towers.slice(0, 2).map((tow, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontFamily: 'monospace' }}>Tower {tow.tower_id}</span>
                    <span style={{ color: 'var(--accent-cyan)' }}>{tow.count} hits</span>
                  </div>
                ))
              ) : (
                <div style={{ color: 'var(--text-muted)' }}>No location logs.</div>
              )}
            </div>
          </div>
          
          <div className="analysis-report-box" style={{ background: 'rgba(15, 15, 15, 0.4)' }}>
            <div className="report-header" style={{ color: 'var(--accent-purple-light)', padding: '6px 12px', fontSize: 10 }}>⏰ Temporal Profile</div>
            <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10 }}>
              <div>Peak: <strong style={{ color: 'var(--text-primary)' }}>{time.peak_hours?.[0] || 'N/A'}</strong></div>
              <div>Night calls: <strong style={{ color: time.night_activity_count > 0 ? 'var(--color-error)' : 'var(--text-secondary)' }}>{time.night_activity_count ?? 0}</strong></div>
            </div>
          </div>
        </div>

        <div className="analysis-report-box" style={{ background: 'rgba(15, 15, 15, 0.4)' }}>
          <div className="report-header" style={{ color: 'var(--color-success)', padding: '6px 12px', fontSize: 10 }}>📱 Hardware / Network Identifiers</div>
          <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>IMEI:</span>
              <span style={{ fontFamily: 'monospace', color: 'var(--text-primary)' }}>{device.unique_imeis?.[0] || 'Unknown'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>IMSI:</span>
              <span style={{ fontFamily: 'monospace', color: 'var(--text-primary)' }}>{sim.unique_imsis?.[0] || 'Unknown'}</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const parseIpdrAnalysis = (rawText) => {
    if (!rawText) return { markdown: '', json: null };
    const jsonMatch = rawText.match(/```json\s*([\s\S]*?)\s*```/i);
    let json = null;
    let markdown = rawText;
    if (jsonMatch) {
      try {
        json = JSON.parse(jsonMatch[1].trim());
        markdown = rawText.replace(/```json\s*([\s\S]*?)\s*```/gi, '').trim();
      } catch (e) {
        const bracesMatch = rawText.match(/(\{[\s\S]*\})/);
        if (bracesMatch) {
          try {
            json = JSON.parse(bracesMatch[1].trim());
            markdown = rawText.replace(/(\{[\s\S]*\})/, '').trim();
          } catch (err) {
            console.error("Failed to parse JSON from ipdr_analysis:", err);
          }
        }
      }
    } else {
      const bracesMatch = rawText.match(/(\{[\s\S]*\})/);
      if (bracesMatch) {
        try {
          json = JSON.parse(bracesMatch[1].trim());
          markdown = rawText.replace(/(\{[\s\S]*\})/, '').trim();
        } catch (err) {
          console.error("Failed to parse JSON from ipdr_analysis:", err);
        }
      }
    }
    return { markdown, json };
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
      <div className="ipdr-dashboard animate-appear" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Risk Badges */}
        {(risk.vpn_detected || risk.tor_detected || risk.proxy_detected || risk.foreign_ips_detected || risk.rapid_location_changes) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 12px', background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '4px' }}>
            <span style={{ fontWeight: 700, fontSize: 10, color: 'var(--color-error)', display: 'flex', alignItems: 'center', gap: 4, marginRight: 4 }}>⚠️ RISK:</span>
            {risk.tor_detected && <span className="entity-type-tag" style={{ background: 'var(--color-error-dim)', color: '#fca5a5', borderColor: 'rgba(239,68,68,0.3)', margin: 0, padding: '1px 4px', fontSize: 9 }}>🧅 TOR</span>}
            {risk.vpn_detected && <span className="entity-type-tag" style={{ background: 'var(--color-warning-dim)', color: '#fde047', borderColor: 'rgba(245,158,11,0.3)', margin: 0, padding: '1px 4px', fontSize: 9 }}>🛡️ VPN</span>}
            {risk.proxy_detected && <span className="entity-type-tag" style={{ background: 'var(--color-warning-dim)', color: '#fde047', borderColor: 'rgba(245,158,11,0.3)', margin: 0, padding: '1px 4px', fontSize: 9 }}>🖥️ Proxy</span>}
            {risk.foreign_ips_detected && <span className="entity-type-tag" style={{ background: 'var(--color-warning-dim)', color: '#fde047', borderColor: 'rgba(245,158,11,0.3)', margin: 0, padding: '1px 4px', fontSize: 9 }}>🌍 Foreign IP</span>}
            {risk.rapid_location_changes && <span className="entity-type-tag" style={{ background: 'var(--color-error-dim)', color: '#fca5a5', borderColor: 'rgba(239,68,68,0.3)', margin: 0, padding: '1px 4px', fontSize: 9 }}>✈️ Velocity</span>}
          </div>
        )}

        {/* Metrics Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 8 }}>
          <div className="glass-card" style={{ padding: 10, border: '1px solid var(--border-subtle)', background: 'rgba(255, 0, 0, 0.03)', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 9, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Sessions</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent-cyan)' }}>{network.total_sessions ?? 0}</span>
          </div>
          <div className="glass-card" style={{ padding: 10, border: '1px solid var(--border-subtle)', background: 'rgba(16, 185, 129, 0.03)', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 9, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Public IPs</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-success)' }}>{network.unique_public_ips ?? 0}</span>
          </div>
          <div className="glass-card" style={{ padding: 10, border: '1px solid var(--border-subtle)', background: 'rgba(124, 58, 237, 0.03)', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 9, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Private IPs</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent-purple-light)' }}>{network.unique_private_ips ?? 0}</span>
          </div>
          <div className="glass-card" style={{ padding: 10, border: '1px solid var(--border-subtle)', background: 'rgba(245, 158, 11, 0.03)', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 9, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Domains</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-warning)' }}>{domainCount}</span>
          </div>
          <div className="glass-card" style={{ padding: 10, border: '1px solid var(--border-subtle)', background: 'rgba(255, 0, 0, 0.03)', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 9, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Apps</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent-cyan)' }}>{appCount}</span>
          </div>
        </div>

        {/* Recent 48 Hour Analysis Block */}
        {recent.observed && (
          <div className="analysis-report-box" style={{ borderColor: 'rgba(255, 0, 0, 0.25)', background: 'rgba(255, 0, 0, 0.02)' }}>
            <div className="report-header" style={{ color: 'var(--accent-cyan)', padding: '6px 12px', fontSize: 10 }}>⚡ Recent 48-Hour Intel Summary</div>
            <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--text-primary)', lineHeight: '1.4' }}>{recent.summary}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, borderTop: '1px solid var(--border-subtle)', paddingTop: 8, fontSize: 10 }}>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Last Public IP:</span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--accent-cyan)', marginLeft: 4 }}>{recent.last_known_ip || 'N/A'}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Last Location:</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)', marginLeft: 4 }}>{recent.last_known_location || 'N/A'}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Visited Domains & Applications */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="analysis-report-box" style={{ background: 'rgba(15, 15, 15, 0.4)' }}>
            <div className="report-header" style={{ color: 'var(--accent-cyan)', padding: '6px 12px', fontSize: 10 }}>🌐 Top Web Domains</div>
            <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {domain.most_accessed_domains && domain.most_accessed_domains.length > 0 ? (
                domain.most_accessed_domains.slice(0, 3).map((d, idx) => {
                  const maxCount = Math.max(...domain.most_accessed_domains.map(item => item.count || 1), 1);
                  const pct = Math.round(((d.count || 0) / maxCount) * 100);
                  return (
                    <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                        <span style={{ fontFamily: 'monospace', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '120px' }}>{d.domain}</span>
                        <span style={{ color: 'var(--text-muted)' }}>{d.count} hits</span>
                      </div>
                      <div style={{ height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, var(--accent-cyan), var(--accent-purple-light))', borderRadius: 2 }} />
                      </div>
                    </div>
                  );
                })
              ) : (
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>No domain logs.</div>
              )}
            </div>
          </div>

          <div className="analysis-report-box" style={{ background: 'rgba(15, 15, 15, 0.4)' }}>
            <div className="report-header" style={{ color: 'var(--accent-purple-light)', padding: '6px 12px', fontSize: 10 }}>📱 Top Applications</div>
            <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {app.most_used_applications && app.most_used_applications.length > 0 ? (
                app.most_used_applications.slice(0, 3).map((a, idx) => {
                  const maxCount = Math.max(...app.most_used_applications.map(item => item.count || 1), 1);
                  const pct = Math.round(((a.count || 0) / maxCount) * 100);
                  return (
                    <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                        <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '120px' }}>{a.app}</span>
                        <span style={{ color: 'var(--text-muted)' }}>{a.count} sess</span>
                      </div>
                      <div style={{ height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, var(--accent-purple-light), var(--accent-purple))', borderRadius: 2 }} />
                      </div>
                    </div>
                  );
                })
              ) : (
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>No app logs.</div>
              )}
            </div>
          </div>
        </div>

        {/* Location & Hardware */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="analysis-report-box" style={{ background: 'rgba(15, 15, 15, 0.4)' }}>
            <div className="report-header" style={{ color: 'var(--color-warning)', padding: '6px 12px', fontSize: 10 }}>📍 Primary Locations</div>
            <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10 }}>
              {location.frequent_towers && location.frequent_towers.length > 0 ? (
                location.frequent_towers.slice(0, 2).map((tow, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontFamily: 'monospace' }}>Tower {tow.tower_id}</span>
                    <span style={{ color: 'var(--accent-cyan)' }}>{tow.count} hits</span>
                  </div>
                ))
              ) : (
                <div style={{ color: 'var(--text-muted)' }}>No location logs.</div>
              )}
            </div>
          </div>

          <div className="analysis-report-box" style={{ background: 'rgba(15, 15, 15, 0.4)' }}>
            <div className="report-header" style={{ color: 'var(--color-success)', padding: '6px 12px', fontSize: 10 }}>📱 Hardware / Identifiers</div>
            <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>IMEI:</span>
                <span style={{ fontFamily: 'monospace', color: 'var(--text-primary)' }}>{device.unique_imeis?.[0] || 'Unknown'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>IMSI:</span>
                <span style={{ fontFamily: 'monospace', color: 'var(--text-primary)' }}>{sim.unique_imsis?.[0] || 'Unknown'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const parsedCdrAnalysis = useMemo(() => {
    return parseCdrAnalysis(activeNode?.metadata?.cdr_analysis);
  }, [activeNode?.metadata?.cdr_analysis]);

  const parsedIpdrAnalysis = useMemo(() => {
    return parseIpdrAnalysis(activeNode?.metadata?.ipdr_analysis);
  }, [activeNode?.metadata?.ipdr_analysis]);

  return (
    <div className="corkboard-wrapper">
      {/* Zoom / Navigation Controls */}
      <div className="corkboard-controls">
        <span className="controls-title">Investigation Board</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {investigationId && (
            <>
              <button
                style={{
                  padding: '8px 16px',
                  fontSize: '12px',
                  fontWeight: '600',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  border: '1px solid #ef4444',
                  background: 'rgba(239, 68, 68, 0.15)',
                  color: '#fca5a5',
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(239, 68, 68, 0.3)';
                  e.currentTarget.style.boxShadow = '0 0 10px rgba(239, 68, 68, 0.5)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
                onClick={() => {
                  setIsAddSuspectOpen(true);
                  setUploadStatus({ type: '', message: '' });
                }}
              >
                👤 Add Node / Suspect
              </button>
              <button
                style={{
                  padding: '8px 16px',
                  fontSize: '12px',
                  fontWeight: '600',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  border: '1px solid #06b6d4',
                  background: 'rgba(255, 0, 0, 0.15)',
                  color: '#67e8f9',
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 0, 0, 0.3)';
                  e.currentTarget.style.boxShadow = '0 0 10px rgba(255, 0, 0, 0.5)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 0, 0, 0.15)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
                onClick={() => {
                  setIsAddConnectionOpen(true);
                  setUploadStatus({ type: '', message: '' });
                }}
              >
                🪢 Add Connection
              </button>
              <button
                style={{
                  padding: '8px 16px',
                  fontSize: '12px',
                  fontWeight: '600',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  border: '1px solid #10b981',
                  background: 'rgba(16, 185, 129, 0.15)',
                  color: '#6ee7b7',
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(16, 185, 129, 0.3)';
                  e.currentTarget.style.boxShadow = '0 0 10px rgba(16, 185, 129, 0.5)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(16, 185, 129, 0.15)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
                onClick={handleOpenAddExisting}
              >
                🔗 Link Existing Node
              </button>
              <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.15)', margin: '0 4px' }} />
            </>
          )}
          <button className="graph-btn" onClick={() => setZoom((z) => Math.min(2, z + 0.1))} title="Zoom In">+</button>
          <button className="graph-btn" onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))} title="Zoom Out">−</button>
          <button className="graph-btn" onClick={centerWorkspace} title="Center Workspace">⌖</button>
          <button 
            className="graph-btn" 
            onClick={() => {
              if (investigationId) {
                try {
                  localStorage.removeItem(`corkboard_pos_${investigationId}`);
                } catch (e) {}
              }
              hasCenteredRef.current = false;
              if (onRefresh) onRefresh();
            }} 
            title="Reset Node Layout"
          >
            🧹
          </button>
        </div>
      </div>

      {/* Main Corkboard canvas */}
      <div
        ref={canvasRef}
        className="corkboard-canvas"
        onMouseDown={handleBoardMouseDown}
        onMouseMove={handleBoardMouseMove}
        onMouseUp={handleBoardMouseUp}
        onMouseLeave={handleBoardMouseUp}
      >
        {isLoading && <div className="scanning-overlay"><div className="scan-line" /></div>}
        
        {isEmpty && !isLoading && (
          <div className="graph-empty">
            <span className="placeholder-icon">📌</span>
            <p>Run an OSINT investigation to populate suspects & evidence</p>
          </div>
        )}

        {/* Draggable container with zoom and pan transforms */}
        <div
          ref={boardRef}
          className="corkboard-content"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
          }}
        >
          {/* Corkboard grid grid-pattern */}
          <div className="corkboard-grid" />

          {/* SVG Thread layer underneath */}
          {!isEmpty && (
            <svg
              className="corkboard-svg-layer"
              width="2500"
              height="2000"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                pointerEvents: 'none',
                zIndex: 1,
                overflow: 'visible',
              }}
            >
              {renderThreads()}
            </svg>
          )}

          {/* Draggable Suspect Cards (Nodes) */}
          {nodes.map((node) => {
            const pos = positions[node.id] || { x: 1250, y: 1000 };
            const isPerson = node.node_type === 'Person' || node.node_type === 'suspect';
            const nodeMeta = node.metadata || {};
            const pictureUrl = nodeMeta.picture;
            
            // Layout styling classes
            const cardClass = isPerson ? 'polaroid-card' : 'evidence-note';
            const borderCol = NODE_COLORS[node.node_type] || '#64748b';

            return (
              <div
                key={node.id}
                className={`node-card-draggable ${cardClass}`}
                style={{
                  left: pos.x,
                  top: pos.y,
                  borderColor: isPerson ? '#e2e8f0' : borderCol,
                  transform: 'translate(-50%, -50%)',
                }}
                onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                onDoubleClick={() => handleNodeClick(node)}
              >
                {/* Red pushpin at the top of everything */}
                <div className="pushpin" />

                {/* Suspect Polaroid rendering */}
                {isPerson ? (
                  <>
                    <div className="polaroid-photo-frame">
                      {pictureUrl ? (
                        <img src={pictureUrl} alt={node.label} className="polaroid-img" />
                      ) : (
                        <div className="suspect-silhouette">👤</div>
                      )}
                    </div>
                    <div className="polaroid-label">{node.label}</div>
                  </>
                ) : (
                  // Evidence yellow sticky note rendering
                  <>
                    <div className="evidence-header">
                      <span className="evidence-type-badge" style={{ background: borderCol }}>
                        {node.node_type}
                      </span>
                    </div>
                    <div className="evidence-body">{node.label}</div>
                    {nodeMeta.platform && <div className="evidence-platform">{nodeMeta.platform}</div>}
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Minimap widget */}
        {!isEmpty && (() => {
          const mData = getMinimapData();
          return (
            <div 
              className="corkboard-minimap glass-card" 
              style={{
                position: 'absolute',
                bottom: '16px',
                right: '16px',
                width: '180px',
                height: '135px',
                background: 'rgba(20, 20, 20, 0.9)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                padding: '8px',
                display: 'flex',
                flexDirection: 'column',
                zIndex: 10,
                userSelect: 'none',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
                cursor: 'crosshair'
              }}
              onMouseDown={handleMinimapClick}
              onMouseMove={handleMinimapMouseMove}
            >
              <div style={{
                fontSize: '9px',
                fontWeight: '600',
                color: '#94a3b8',
                marginBottom: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}>
                <span>🗺️ Minimap</span>
                <span style={{ fontSize: '8px', opacity: 0.6 }}>Drag to Pan</span>
              </div>
              <div style={{
                position: 'relative',
                width: '164px',
                height: '100px',
                background: 'rgba(0, 0, 0, 0.3)',
                borderRadius: '4px',
                overflow: 'hidden',
                border: '1px solid rgba(255, 255, 255, 0.05)'
              }}>
                <svg width="164" height="100" style={{ pointerEvents: 'none' }}>
                  {/* Grid pattern on minimap background */}
                  <defs>
                    <pattern id="miniGrid" width="10" height="10" patternUnits="userSpaceOnUse">
                      <path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(255, 255, 255, 0.02)" strokeWidth="0.5" />
                    </pattern>
                  </defs>
                  <rect width="164" height="100" fill="url(#miniGrid)" />

                  {/* Edges */}
                  {mData.edges.map((edge, idx) => (
                    <line
                      key={`mini-edge-${idx}`}
                      x1={edge.x1}
                      y1={edge.y1}
                      x2={edge.x2}
                      y2={edge.y2}
                      stroke="rgba(239, 68, 68, 0.3)"
                      strokeWidth="1"
                    />
                  ))}

                  {/* Nodes */}
                  {mData.nodes.map(node => (
                    <circle
                      key={`mini-node-${node.id}`}
                      cx={node.x}
                      cy={node.y}
                      r="3.5"
                      fill={node.color}
                      stroke="rgba(255, 255, 255, 0.2)"
                      strokeWidth="0.5"
                    />
                  ))}

                  {/* Viewport rectangle */}
                  {mData.viewport && (
                    <rect
                      x={mData.viewport.x}
                      y={mData.viewport.y}
                      width={mData.viewport.width}
                      height={mData.viewport.height}
                      fill="rgba(239, 68, 68, 0.12)"
                      stroke="#ef4444"
                      strokeWidth="1"
                    />
                  )}
                </svg>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Edit Suspect Dialog Modal */}
      {activeNode && (
        <div className="modal-overlay">
          <div className="modal-content glass-card" style={{ width: '600px', maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div className="section-header" style={{ flexShrink: 0 }}>
              <div className="section-title">
                <span>🔬</span>
                Investigate & Edit Suspect
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn-ghost" onClick={handleDownloadReport} style={{ color: 'var(--accent-cyan)' }}>📥 Download Data</button>
                <button className="btn-ghost" onClick={handleDeleteNode} style={{ color: 'var(--color-error)' }}>🗑️ Delete</button>
                <button className="btn-ghost" onClick={() => setActiveNode(null)}>Close</button>
              </div>
            </div>

            {/* Dialog tab buttons */}
            <div className="filter-tabs" style={{ background: 'rgba(255,255,255,0.01)', padding: '8px 16px', flexShrink: 0 }}>
              <button className={`filter-tab ${dialogTab === 'details' ? 'active' : ''}`} onClick={() => setDialogTab('details')}>
                 Suspect Details
              </button>
              <button className={`filter-tab ${dialogTab === 'cdr' ? 'active' : ''}`} onClick={() => setDialogTab('cdr')}>
                📞 CDR Call Logs
              </button>
              <button className={`filter-tab ${dialogTab === 'ipdr' ? 'active' : ''}`} onClick={() => setDialogTab('ipdr')}>
                🌐 IPDR Traffic Logs
              </button>
            </div>

            <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
              {/* STATUS BAR MESSAGE */}
              {uploadStatus.message && (
                <div
                  className={`error-message ${uploadStatus.type === 'success' ? 'success' : ''}`}
                  style={{
                    marginBottom: 16,
                    borderColor: uploadStatus.type === 'success' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)',
                    background: uploadStatus.type === 'success' ? 'var(--color-success-dim)' : 'var(--color-error-dim)',
                    color: uploadStatus.type === 'success' ? 'var(--color-success)' : 'var(--color-error)',
                  }}
                >
                  <span>{uploadStatus.type === 'success' ? '✅' : uploadStatus.type === 'loading' ? '⏳' : '⚠️'}</span>
                  {uploadStatus.message}
                </div>
              )}

              {/* TABS 1: Suspect Details form */}
              {dialogTab === 'details' && (
                <form onSubmit={handleSaveDetails} className="search-body" style={{ padding: 0 }}>
                  <div style={{ display: 'flex', gap: 16 }}>
                    {/* Left: Polaroid preview */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <div className="polaroid-card" style={{ cursor: 'default', margin: 0 }}>
                        <div className="polaroid-photo-frame" style={{ width: 110, height: 110 }}>
                          {editForm.picture ? (
                            <img src={editForm.picture} alt="Preview" className="polaroid-img" />
                          ) : (
                            <div className="suspect-silhouette" style={{ fontSize: 44 }}>👤</div>
                          )}
                        </div>
                      </div>
                      <label className="btn-ghost" style={{ marginTop: 8, cursor: 'pointer', textAlign: 'center', fontSize: 11 }}>
                        Upload Photo
                        <input type="file" accept="image/*" onChange={handlePictureChange} style={{ display: 'none' }} />
                      </label>
                    </div>

                    {/* Right fields */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div>
                        <label className="detail-key" style={{ fontSize: 11, marginBottom: 4, display: 'block' }}>Suspect Name</label>
                        <input
                          className="search-input"
                          value={editForm.name}
                          onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                          required
                          placeholder="Suspect Name"
                        />
                      </div>
                      <div>
                        <label className="detail-key" style={{ fontSize: 11, marginBottom: 4, display: 'block' }}>Email Address</label>
                        <input
                          className="search-input"
                          type="email"
                          value={editForm.email}
                          onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                          placeholder="email@suspect.com"
                        />
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label className="detail-key" style={{ fontSize: 11, marginBottom: 4, display: 'block' }}>Phone Number</label>
                      <input
                        className="search-input"
                        value={editForm.phone_number}
                        onChange={(e) => setEditForm({ ...editForm, phone_number: e.target.value })}
                        placeholder="+1 555-0199"
                      />
                    </div>
                    <div>
                      <label className="detail-key" style={{ fontSize: 11, marginBottom: 4, display: 'block' }}>Social Media / Username ID</label>
                      <input
                        className="search-input"
                        value={editForm.social_media_id}
                        onChange={(e) => setEditForm({ ...editForm, social_media_id: e.target.value })}
                        placeholder="johndoe_id"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="detail-key" style={{ fontSize: 11, marginBottom: 4, display: 'block' }}>Related Links (one per line)</label>
                    <textarea
                      className="search-input"
                      style={{ height: '70px', fontFamily: 'monospace' }}
                      value={editForm.links}
                      onChange={(e) => setEditForm({ ...editForm, links: e.target.value })}
                      placeholder="https://facebook.com/suspect-id"
                    />
                  </div>

                  <button className="btn-primary" type="submit" disabled={isSaving}>
                    {isSaving ? <div className="spinner" /> : 'Save Profile Details'}
                  </button>
                </form>
              )}

              {/* TABS 2: CDR File paste/upload */}
              {dialogTab === 'cdr' && (() => {
                const { markdown, json } = parsedCdrAnalysis;
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {/* If analysis exists, show it! */}
                    {activeNode.metadata?.cdr_analysis ? (
                      <div className="analysis-report-box animate-appear" style={{ background: 'rgba(15, 15, 15, 0.4)', border: '1px solid var(--border-default)', borderRadius: '6px', overflow: 'hidden' }}>
                        <div className="report-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--accent-cyan)' }}>
                          <span>📞 Call Log Intelligence Profile</span>
                          {json && (
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button className={`filter-tab ${cdrViewMode === 'dashboard' ? 'active' : ''}`} style={{ padding: '2px 8px', fontSize: 9, height: 20, margin: 0 }} onClick={() => setCdrViewMode('dashboard')}>Dashboard</button>
                              <button className={`filter-tab ${cdrViewMode === 'text' ? 'active' : ''}`} style={{ padding: '2px 8px', fontSize: 9, height: 20, margin: 0 }} onClick={() => setCdrViewMode('text')}>Summary</button>
                              <button className={`filter-tab ${cdrViewMode === 'json' ? 'active' : ''}`} style={{ padding: '2px 8px', fontSize: 9, height: 20, margin: 0 }} onClick={() => setCdrViewMode('json')}>JSON</button>
                            </div>
                          )}
                        </div>
                        <div className="report-body" style={{ padding: '16px', fontSize: '12px', lineHeight: '1.5', color: 'var(--text-secondary)', fontFamily: 'Inter, sans-serif', maxHeight: '350px', overflowY: 'auto' }}>
                          {json && cdrViewMode === 'dashboard' ? (
                            renderCdrDashboard(json)
                          ) : json && cdrViewMode === 'json' ? (
                            <pre style={{ fontFamily: 'monospace', fontSize: 10, background: '#050510', padding: 8, borderRadius: 4, overflowX: 'auto', border: '1px solid var(--border-subtle)', margin: 0 }}>
                              {JSON.stringify(json, null, 2)}
                            </pre>
                          ) : (
                            <div style={{ whiteSpace: 'pre-wrap' }}>
                              {markdown}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-muted" style={{ fontSize: 11, textAlign: 'center', padding: '12px 0', border: '1px dashed var(--border-subtle)', borderRadius: '6px' }}>
                        No CDR analysis available yet. Upload logs below to generate.
                      </div>
                    )}

                  <p className="text-muted" style={{ fontSize: 11, lineHeight: 1.5, marginTop: 6 }}>
                    Upload or paste Call Detail Records (CDR) below. Format caller number, recipient number, timestamp, and duration (seconds). One call per line, comma or tab separated.
                  </p>
                  
                  {/* File Upload Selector */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label className="detail-key" style={{ fontSize: 10 }}>Select CDR Log File (.txt, .csv, .log):</label>
                    <input
                      type="file"
                      accept=".txt,.csv,.log"
                      className="search-input"
                      style={{ background: '#070715', padding: '6px 10px', fontSize: '11px', width: '100%' }}
                      onChange={(e) => {
                        const file = e.target.files[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (event) => {
                            const text = event.target.result;
                            if (!validateCDRText(text)) {
                              setUploadStatus({ type: 'error', message: 'Unsupported file uploaded' });
                              setCdrText('');
                            } else {
                              setCdrText(text);
                              setUploadStatus({ type: 'success', message: `Loaded file: ${file.name} (${file.size} bytes)` });
                            }
                          };
                          reader.readAsText(file);
                        }
                      }}
                    />
                  </div>

                  <pre style={{ background: 'rgba(0,0,0,0.3)', padding: 6, borderRadius: 4, fontSize: 9, fontFamily: 'monospace', color: '#86efac' }}>
                    +15550100, +15550199, 2026-06-09 14:02:11, 230, Voice
                  </pre>
                  <textarea
                    className="search-input"
                    style={{ height: 90, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}
                    value={cdrText}
                    onChange={(e) => setCdrText(e.target.value)}
                    placeholder="Enter or load CDR logs here..."
                  />
                  <button className="btn-primary" onClick={handleCDRSubmit} disabled={uploadStatus.type === 'loading'}>
                    {uploadStatus.type === 'loading' ? <div className="spinner" /> : 'Parse & Run CDR Analysis'}
                  </button>
                </div>
              );
            })()}

              {/* TABS 3: IPDR File paste/upload */}
              {dialogTab === 'ipdr' && (() => {
                const { markdown, json } = parsedIpdrAnalysis;
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {/* If analysis exists, show it! */}
                    {activeNode.metadata?.ipdr_analysis ? (
                      <div className="analysis-report-box animate-appear" style={{ background: 'rgba(15, 15, 15, 0.4)', border: '1px solid var(--border-default)', borderRadius: '6px', overflow: 'hidden' }}>
                        <div className="report-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--accent-cyan)' }}>
                          <span>🌐 Network Connection Profile</span>
                          {json && (
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button className={`filter-tab ${ipdrViewMode === 'dashboard' ? 'active' : ''}`} style={{ padding: '2px 8px', fontSize: 9, height: 20, margin: 0 }} onClick={() => setIpdrViewMode('dashboard')}>Dashboard</button>
                              <button className={`filter-tab ${ipdrViewMode === 'text' ? 'active' : ''}`} style={{ padding: '2px 8px', fontSize: 9, height: 20, margin: 0 }} onClick={() => setIpdrViewMode('text')}>Summary</button>
                              <button className={`filter-tab ${ipdrViewMode === 'json' ? 'active' : ''}`} style={{ padding: '2px 8px', fontSize: 9, height: 20, margin: 0 }} onClick={() => setIpdrViewMode('json')}>JSON</button>
                            </div>
                          )}
                        </div>
                        <div className="report-body" style={{ padding: '16px', fontSize: '12px', lineHeight: '1.5', color: 'var(--text-secondary)', fontFamily: 'Inter, sans-serif', maxHeight: '350px', overflowY: 'auto' }}>
                          {json && ipdrViewMode === 'dashboard' ? (
                            renderIpdrDashboard(json)
                          ) : json && ipdrViewMode === 'json' ? (
                            <pre style={{ fontFamily: 'monospace', fontSize: 10, background: '#050510', padding: 8, borderRadius: 4, overflowX: 'auto', border: '1px solid var(--border-subtle)', margin: 0 }}>
                              {JSON.stringify(json, null, 2)}
                            </pre>
                          ) : (
                            <div style={{ whiteSpace: 'pre-wrap' }}>
                              {markdown}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-muted" style={{ fontSize: 11, textAlign: 'center', padding: '12px 0', border: '1px dashed var(--border-subtle)', borderRadius: '6px' }}>
                        No IPDR analysis available yet. Upload logs below to generate.
                      </div>
                    )}

                    <p className="text-muted" style={{ fontSize: 11, lineHeight: 1.5, marginTop: 6 }}>
                      Upload or paste Internet Protocol Detail Records (IPDR). Format subscriber IP, destination IP, timestamp, and bytes transferred. One record per line.
                    </p>

                    {/* File Upload Selector */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <label className="detail-key" style={{ fontSize: 10 }}>Select IPDR Log File (.txt, .csv, .log):</label>
                      <input
                        type="file"
                        accept=".txt,.csv,.log"
                        className="search-input"
                        style={{ background: '#070715', padding: '6px 10px', fontSize: '11px', width: '100%' }}
                        onChange={(e) => {
                          const file = e.target.files[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onload = (event) => {
                              const text = event.target.result;
                              if (!validateIPDRText(text)) {
                                setUploadStatus({ type: 'error', message: 'Unsupported file uploaded' });
                                setIpdrText('');
                              } else {
                                setIpdrText(text);
                                setUploadStatus({ type: 'success', message: `Loaded file: ${file.name} (${file.size} bytes)` });
                              }
                            };
                            reader.readAsText(file);
                          }
                        }}
                      />
                    </div>

                    <pre style={{ background: 'rgba(0,0,0,0.3)', padding: 6, borderRadius: 4, fontSize: 9, fontFamily: 'monospace', color: '#86efac' }}>
                      192.168.1.5, 45.33.2.14, 2026-06-09 14:05:00, 48201
                    </pre>
                    <textarea
                      className="search-input"
                      style={{ height: 90, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}
                      value={ipdrText}
                      onChange={(e) => setIpdrText(e.target.value)}
                      placeholder="Enter or load IPDR logs here..."
                    />
                    <button className="btn-primary" onClick={handleIPDRSubmit} disabled={uploadStatus.type === 'loading'}>
                      {uploadStatus.type === 'loading' ? <div className="spinner" /> : 'Parse & Run IPDR Analysis'}
                    </button>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Add Suspect Modal */}
      {isAddSuspectOpen && (
        <div className="modal-overlay">
          <div className="modal-content glass-card" style={{ width: '500px', maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div className="section-header" style={{ flexShrink: 0 }}>
              <div className="section-title">
                <span>👤</span>
                Add New Suspect
              </div>
              <button className="btn-ghost" onClick={() => setIsAddSuspectOpen(false)}>Close</button>
            </div>

            <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
              {uploadStatus.message && (
                <div
                  className={`error-message ${uploadStatus.type === 'success' ? 'success' : ''}`}
                  style={{
                    marginBottom: 16,
                    borderColor: uploadStatus.type === 'success' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)',
                    background: uploadStatus.type === 'success' ? 'var(--color-success-dim)' : 'var(--color-error-dim)',
                    color: uploadStatus.type === 'success' ? 'var(--color-success)' : 'var(--color-error)',
                  }}
                >
                  <span>{uploadStatus.type === 'success' ? '✅' : uploadStatus.type === 'loading' ? '⏳' : '⚠️'}</span>
                  {uploadStatus.message}
                </div>
              )}

              <form onSubmit={handleAddSuspectSubmit} className="search-body" style={{ padding: 0 }}>
                <div style={{ display: 'flex', gap: 16 }}>
                  {/* Left: Polaroid preview */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div className="polaroid-card" style={{ cursor: 'default', margin: 0 }}>
                      <div className="polaroid-photo-frame" style={{ width: 100, height: 100 }}>
                        {addSuspectForm.picture ? (
                          <img src={addSuspectForm.picture} alt="Preview" className="polaroid-img" />
                        ) : (
                          <div className="suspect-silhouette" style={{ fontSize: 36 }}>👤</div>
                        )}
                      </div>
                    </div>
                    <label className="btn-ghost" style={{ marginTop: 8, cursor: 'pointer', textAlign: 'center', fontSize: 10 }}>
                      Upload Photo
                      <input type="file" accept="image/*" onChange={handleAddSuspectPictureChange} style={{ display: 'none' }} />
                    </label>
                  </div>

                  {/* Right fields */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div>
                      <label className="detail-key" style={{ fontSize: 11, marginBottom: 4, display: 'block' }}>Suspect Name</label>
                      <input
                        className="search-input"
                        value={addSuspectForm.name}
                        onChange={(e) => setAddSuspectForm({ ...addSuspectForm, name: e.target.value })}
                        required
                        placeholder="Suspect Name"
                      />
                    </div>
                    <div>
                      <label className="detail-key" style={{ fontSize: 11, marginBottom: 4, display: 'block' }}>Email Address</label>
                      <input
                        className="search-input"
                        type="email"
                        value={addSuspectForm.email}
                        onChange={(e) => setAddSuspectForm({ ...addSuspectForm, email: e.target.value })}
                        placeholder="email@suspect.com"
                      />
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label className="detail-key" style={{ fontSize: 11, marginBottom: 4, display: 'block' }}>Phone Number</label>
                    <input
                      className="search-input"
                      value={addSuspectForm.phone_number}
                      onChange={(e) => setAddSuspectForm({ ...addSuspectForm, phone_number: e.target.value })}
                      placeholder="+1 555-0199"
                    />
                  </div>
                  <div>
                    <label className="detail-key" style={{ fontSize: 11, marginBottom: 4, display: 'block' }}>Social ID / Username</label>
                    <input
                      className="search-input"
                      value={addSuspectForm.social_media_id}
                      onChange={(e) => setAddSuspectForm({ ...addSuspectForm, social_media_id: e.target.value })}
                      placeholder="johndoe_id"
                    />
                  </div>
                </div>

                <div>
                  <label className="detail-key" style={{ fontSize: 11, marginBottom: 4, display: 'block' }}>Related Links (one per line)</label>
                  <textarea
                    className="search-input"
                    style={{ height: '60px', fontFamily: 'monospace' }}
                    value={addSuspectForm.links}
                    onChange={(e) => setAddSuspectForm({ ...addSuspectForm, links: e.target.value })}
                    placeholder="https://facebook.com/suspect-id"
                  />
                </div>

                <button className="btn-primary" type="submit" disabled={isSaving}>
                  {isSaving ? <div className="spinner" /> : 'Create Suspect'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Add Connection Modal */}
      {isAddConnectionOpen && (
        <div className="modal-overlay">
          <div className="modal-content glass-card" style={{ width: '450px', maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div className="section-header" style={{ flexShrink: 0 }}>
              <div className="section-title">
                <span>🪢</span>
                Add Connection Wire
              </div>
              <button className="btn-ghost" onClick={() => setIsAddConnectionOpen(false)}>Close</button>
            </div>

            <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
              {uploadStatus.message && (
                <div
                  className={`error-message ${uploadStatus.type === 'success' ? 'success' : ''}`}
                  style={{
                    marginBottom: 16,
                    borderColor: uploadStatus.type === 'success' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)',
                    background: uploadStatus.type === 'success' ? 'var(--color-success-dim)' : 'var(--color-error-dim)',
                    color: uploadStatus.type === 'success' ? 'var(--color-success)' : 'var(--color-error)',
                  }}
                >
                  <span>{uploadStatus.type === 'success' ? '✅' : uploadStatus.type === 'loading' ? '⏳' : '⚠️'}</span>
                  {uploadStatus.message}
                </div>
              )}

              <form onSubmit={handleAddConnectionSubmit} className="search-body" style={{ padding: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label className="detail-key" style={{ fontSize: 11, marginBottom: 4, display: 'block' }}>Source Target</label>
                  <select
                    className="search-input"
                    style={{ background: '#070715', padding: '8px 12px', width: '100%' }}
                    value={addConnectionForm.fromNodeId}
                    onChange={(e) => setAddConnectionForm({ ...addConnectionForm, fromNodeId: e.target.value })}
                    required
                  >
                    <option value="">-- Select Source Node --</option>
                    {nodes.filter(n => n.node_type !== 'Investigation').map(n => (
                      <option key={n.id} value={n.id}>{n.label} ({n.node_type})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="detail-key" style={{ fontSize: 11, marginBottom: 4, display: 'block' }}>Target Destination</label>
                  <select
                    className="search-input"
                    style={{ background: '#070715', padding: '8px 12px', width: '100%' }}
                    value={addConnectionForm.toNodeId}
                    onChange={(e) => setAddConnectionForm({ ...addConnectionForm, toNodeId: e.target.value })}
                    required
                  >
                    <option value="">-- Select Target Node --</option>
                    {nodes.filter(n => n.node_type !== 'Investigation').map(n => (
                      <option key={n.id} value={n.id}>{n.label} ({n.node_type})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="detail-key" style={{ fontSize: 11, marginBottom: 4, display: 'block' }}>Relationship Type / Label</label>
                  <input
                    className="search-input"
                    value={addConnectionForm.label}
                    onChange={(e) => setAddConnectionForm({ ...addConnectionForm, label: e.target.value })}
                    required
                    placeholder="e.g. CALLED, FRIEND, COLLABORATOR"
                  />
                </div>

                <button className="btn-primary" type="submit" disabled={isSaving}>
                  {isSaving ? <div className="spinner" /> : 'Connect with Wire'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Add Existing Suspect Modal */}
      {isAddExistingOpen && (
        <div className="modal-overlay" style={{ zIndex: 10000 }}>
          <div className="modal-content glass-card" style={{ width: '450px', display: 'flex', flexDirection: 'column' }}>
            <div className="section-header">
              <div className="section-title">🔗 Link Existing Suspect</div>
              <button className="btn-ghost" onClick={() => setIsAddExistingOpen(false)}>Close</button>
            </div>
            <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
              <p className="text-muted" style={{ fontSize: 11, marginBottom: 16 }}>
                Pull a previously created suspect into the current investigation graph.
              </p>
              <form onSubmit={handleAddExistingSubmit} className="search-body" style={{ padding: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label className="detail-key" style={{ fontSize: 11, marginBottom: 4, display: 'block' }}>Select Suspect</label>
                  {existingPeople.length === 0 ? (
                    <div className="text-muted" style={{ fontSize: 11, padding: '8px 0' }}>No suspects found in database.</div>
                  ) : (
                    <select
                      className="search-input"
                      style={{ background: '#070715', padding: '8px 12px', width: '100%' }}
                      value={selectedExistingId}
                      onChange={(e) => setSelectedExistingId(e.target.value)}
                      required
                    >
                      {existingPeople.map(p => (
                        <option key={p.node_id} value={p.node_id}>{p.name || 'Unnamed Suspect'}</option>
                      ))}
                    </select>
                  )}
                </div>
                <button className="btn-primary" type="submit" disabled={isSaving || existingPeople.length === 0}>
                  {isSaving ? <div className="spinner" /> : 'Link to Investigation'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
