export default function StatusBadge({ status }) {
  const configs = {
    pending: { label: 'Pending', className: 'pending' },
    running: { label: 'Scanning...', className: 'running' },
    complete: { label: 'Complete', className: 'complete' },
    error: { label: 'Error', className: 'error' },
  };

  const config = configs[status] || configs.pending;

  return (
    <span
      className={`status-badge ${config.className}`}
      role="status"
      aria-label={`Status: ${config.label}`}
    >
      <span className="status-badge-dot" aria-hidden="true" />
      {config.label}
    </span>
  );
}
