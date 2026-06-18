import { useState, useRef, useCallback, useEffect } from 'react';
import { startInvestigation, getInvestigation, getGraph } from '../api/client';

const POLL_INTERVAL_MS = 2000;
const RECENT_KEY = 'osint_recent';
const MAX_RECENT = 50;

function saveRecent(entry) {
  try {
    const existing = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    const filtered = existing.filter(
      (e) => !(e.query === entry.query && e.queryType === entry.queryType)
    );
    const updated = [entry, ...filtered].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
  } catch (_) {}
}

export function getRecentInvestigations() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch (_) {
    return [];
  }
}

export function clearRecentInvestigations() {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch (_) {}
}

export default function useInvestigation() {
  const [investigation, setInvestigation] = useState(null);
  const [graphData, setGraphData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const fetchGraph = useCallback(async (id) => {
    try {
      const res = await getGraph(id);
      setGraphData(res.data);
    } catch (err) {
      console.error('Failed to fetch graph data:', err);
    }
  }, []);

  const pollInvestigation = useCallback(
    (id) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const res = await getInvestigation(id);
          const data = res.data;
          setInvestigation(data);

          if (data.status === 'complete') {
            stopPolling();
            setIsLoading(false);
            await fetchGraph(id);
          } else if (data.status === 'error') {
            stopPolling();
            setIsLoading(false);
            setError(data.error_message || 'Investigation failed.');
          }
        } catch (err) {
          stopPolling();
          setIsLoading(false);
          setError('Failed to poll investigation status.');
          console.error(err);
        }
      }, POLL_INTERVAL_MS);
    },
    [stopPolling, fetchGraph]
  );

  const investigate = useCallback(
    async (query, queryType) => {
      if (!query || !query.trim()) {
        setError('Please enter a search query.');
        return;
      }

      stopPolling();
      setError(null);
      setIsLoading(true);
      setInvestigation(null);
      setGraphData(null);

      try {
        const res = await startInvestigation(query.trim(), queryType);
        const data = res.data;
        setInvestigation(data);

        saveRecent({
          query: query.trim(),
          queryType,
          investigationId: data.investigation_id || data.id,
          status: data.status,
          timestamp: Date.now(),
        });

        if (data.status === 'complete') {
          setIsLoading(false);
          await fetchGraph(data.investigation_id || data.id);
        } else if (data.status === 'error') {
          setIsLoading(false);
          setError(data.error_message || 'Investigation failed immediately.');
        } else {
          pollInvestigation(data.investigation_id || data.id);
        }
      } catch (err) {
        setIsLoading(false);
        const msg =
          err?.response?.data?.detail ||
          err?.response?.data?.message ||
          err?.message ||
          'Failed to start investigation.';
        setError(msg);
        console.error(err);
      }
    },
    [stopPolling, pollInvestigation, fetchGraph]
  );

  const clearInvestigation = useCallback(() => {
    stopPolling();
    setInvestigation(null);
    setGraphData(null);
    setIsLoading(false);
    setError(null);
  }, [stopPolling]);

  // Auto-load latest investigation on mount
  useEffect(() => {
    const recent = getRecentInvestigations();
    if (recent.length > 0) {
      const latest = recent[0];
      const id = latest.investigationId;
      if (id) {
        setIsLoading(true);
        getInvestigation(id)
          .then((res) => {
            setInvestigation(res.data);
            if (res.data.status === 'complete') {
              fetchGraph(id);
            } else if (res.data.status === 'pending' || res.data.status === 'running') {
              pollInvestigation(id);
            }
          })
          .catch((err) => {
            console.error('Failed to auto-load latest investigation:', err);
          })
          .finally(() => {
            setIsLoading(false);
          });
      }
    }
  }, [fetchGraph, pollInvestigation]);

  return {
    investigate,
    investigation,
    graphData,
    isLoading,
    error,
    clearInvestigation,
    fetchGraph,
  };
}
