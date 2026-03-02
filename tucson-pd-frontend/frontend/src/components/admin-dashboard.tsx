import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, FileText, ArrowUpDown, Plus, X, CheckCircle, Trash2, AlertCircle, Loader2, RefreshCw, Eye } from 'lucide-react';
import {
  getAllGuidelines,
  activateGuideline,
  deleteGuideline,
  fetchGuidelineRules,
  type ApiGuideline,
  type GuidelineDisplayStatus,
  type FrontendRule,
  mapGuidelineProcessingStatus,
} from './adminapimanager';

// =============================================================================
// TYPES
// =============================================================================

type SortKey = 'uploadDate-desc' | 'uploadDate-asc' | 'name-asc' | 'name-desc';

interface AdminDashboardProps {
  onUploadGuideline: () => void;
  onReviewGuideline: (guidelineId: string, rules: FrontendRule[], fileName: string) => void;
}

// =============================================================================
// HELPERS
// =============================================================================

function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatFileSize(s3Path: string): string {
  // File size isn't stored on the DynamoDB record — show the version instead
  // as a useful identifier. Size would require a separate S3 HeadObject call.
  return s3Path ? 'PDF' : '—';
}

// =============================================================================
// PROCESSING STATUS BADGE
// =============================================================================

function ProcessingBadge({ status }: { status: GuidelineDisplayStatus }) {
  const styles: Record<GuidelineDisplayStatus, string> = {
    Pending:           'bg-slate-100 text-slate-600 border-slate-200',
    Processing:        'bg-yellow-100 text-yellow-700 border-yellow-200',
    'Ready for Review': 'bg-blue-100 text-blue-700 border-blue-200',
    Reviewed:          'bg-emerald-100 text-emerald-700 border-emerald-200',
    Failed:            'bg-red-100 text-red-700 border-red-200',
  };

  const icons: Record<GuidelineDisplayStatus, JSX.Element> = {
    Pending:           <Loader2 className="w-3 h-3" />,
    Processing:        <Loader2 className="w-3 h-3 animate-spin" />,
    'Ready for Review': <Eye className="w-3 h-3" />,
    Reviewed:          <CheckCircle className="w-3 h-3" />,
    Failed:            <AlertCircle className="w-3 h-3" />,
  };

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-sm ${styles[status]}`}>
      {icons[status]}
      {status}
    </span>
  );
}

// =============================================================================
// COMPONENT
// =============================================================================

export function AdminDashboard({ onUploadGuideline, onReviewGuideline }: AdminDashboardProps) {
  const [guidelines, setGuidelines] = useState<ApiGuideline[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('uploadDate-desc');
  const [selectedGuideline, setSelectedGuideline] = useState<ApiGuideline | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // LOAD
  // ---------------------------------------------------------------------------

  const loadGuidelines = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    const { data, error } = await getAllGuidelines();

    if (error || !data) {
      setLoadError(error ?? 'Failed to load guidelines');
      setIsLoading(false);
      return;
    }

    setGuidelines(data.guidelines);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadGuidelines();
  }, [loadGuidelines]);

  // Silent background refresh — doesn't show the loading spinner so the
  // table doesn't flash. Used by the auto-refresh interval.
  const silentRefresh = useCallback(async () => {
    const { data } = await getAllGuidelines();
    if (data) setGuidelines(data.guidelines);
  }, []);

  // Auto-refresh every 30 seconds while any guideline is still processing.
  // Stops automatically once all guidelines have left the pending/processing state.
  const autoRefreshRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const hasProcessing = guidelines.some(
      g => g.processing_status === 'pending' || g.processing_status === 'processing'
    );

    if (hasProcessing) {
      // Start interval if not already running
      if (!autoRefreshRef.current) {
        autoRefreshRef.current = setInterval(silentRefresh, 30_000);
      }
    } else {
      // No in-progress guidelines — clear the interval
      if (autoRefreshRef.current) {
        clearInterval(autoRefreshRef.current);
        autoRefreshRef.current = null;
      }
    }

    // Cleanup on unmount
    return () => {
      if (autoRefreshRef.current) {
        clearInterval(autoRefreshRef.current);
        autoRefreshRef.current = null;
      }
    };
  }, [guidelines, silentRefresh]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadGuidelines();
    setIsRefreshing(false);
  };

  // ---------------------------------------------------------------------------
  // ACTIONS
  // ---------------------------------------------------------------------------

  const handleActivate = async (guideline: ApiGuideline) => {
    if (guideline.status === 'active') return;

    // Must be processing_status === 'reviewed' to activate
    if (guideline.processing_status !== 'reviewed') {
      setActionError(
        guideline.processing_status === 'completed'
          ? `"${guideline.description}" must be reviewed before it can be activated.`
          : `"${guideline.description}" cannot be activated — it hasn't finished processing yet.`
      );
      return;
    }

    setActivatingId(guideline.guideline_id);
    setActionError(null);

    const { error } = await activateGuideline(guideline.guideline_id);

    if (error) {
      setActionError(`Failed to activate guideline: ${error}`);
    } else {
      // Optimistically update local state so UI responds immediately
      setGuidelines(prev =>
        prev.map(g => ({ ...g, status: g.guideline_id === guideline.guideline_id ? 'active' : 'inactive' }))
      );
    }

    setActivatingId(null);
  };

  const handleDeleteConfirm = async () => {
    if (!confirmDeleteId) return;

    setDeletingId(confirmDeleteId);
    setConfirmDeleteId(null);
    setActionError(null);

    const { error } = await deleteGuideline(confirmDeleteId);

    if (error) {
      setActionError(`Failed to delete guideline: ${error}`);
    } else {
      setGuidelines(prev => prev.filter(g => g.guideline_id !== confirmDeleteId));
    }

    setDeletingId(null);
  };

  const handleReviewRules = async (guideline: ApiGuideline) => {
    setReviewingId(guideline.guideline_id);
    setActionError(null);

    const { data: rules, error } = await fetchGuidelineRules(guideline.guideline_id);

    setReviewingId(null);

    if (error || !rules) {
      setActionError(`Failed to load rules for "${guideline.description}": ${error}`);
      return;
    }

    onReviewGuideline(guideline.guideline_id, rules, guideline.description);
  };

  // ---------------------------------------------------------------------------
  // FILTER & SORT
  // ---------------------------------------------------------------------------

  const filtered = guidelines.filter(g => {
    const q = searchQuery.toLowerCase();
    return (
      g.description.toLowerCase().includes(q) ||
      g.version.toLowerCase().includes(q) ||
      g.uploaded_by_name.toLowerCase().includes(q)
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    const [field, dir] = sortBy.split('-');
    const mod = dir === 'asc' ? 1 : -1;

    if (field === 'name') {
      return a.description.localeCompare(b.description) * mod;
    }
    // uploadDate
    return (a.created_at - b.created_at) * mod;
  });

  // ---------------------------------------------------------------------------
  // DERIVED METRICS
  // ---------------------------------------------------------------------------

  const activeGuideline = guidelines.find(g => g.status === 'active');

  // ---------------------------------------------------------------------------
  // RENDER STATES
  // ---------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          <p>Loading guidelines...</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-md border border-red-200 p-8 max-w-md text-center">
          <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-4" />
          <p className="text-slate-900 mb-2">Failed to load guidelines</p>
          <p className="text-slate-500 mb-6">{loadError}</p>
          <button
            onClick={loadGuidelines}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // MAIN RENDER
  // ---------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <main className="flex-1 px-8 py-8">
        <div className="max-w-7xl mx-auto">

          {/* Page Title */}
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-slate-900 mb-1">Admin Dashboard</h2>
            <div className="flex items-center gap-3">
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="flex items-center gap-2 px-4 py-3 bg-white border-2 border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 hover:border-slate-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Refresh guidelines"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                {isRefreshing ? 'Refreshing…' : 'Refresh'}
              </button>
              <button
                onClick={onUploadGuideline}
                className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus className="w-5 h-5" />
                Upload New Guideline
              </button>
            </div>
          </div>

          {/* Action Error Banner */}
          {actionError && (
            <div className="mb-6 flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-red-700 flex-1">{actionError}</p>
              <button onClick={() => setActionError(null)} className="text-red-400 hover:text-red-600 flex-shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Metric Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">

            {/* Active Guideline */}
            <div className="bg-white rounded-lg shadow-md border border-slate-200 pt-6 px-6 pb-6">
              <div className="flex items-start justify-between mb-4">
                <h3 className="text-slate-600">Active Guideline</h3>
                <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center">
                  <CheckCircle className="w-6 h-6 text-emerald-600" />
                </div>
              </div>
              {activeGuideline ? (
                <div>
                  <p className="text-slate-900 font-medium">{activeGuideline.description}</p>
                  <p className="text-slate-500 text-sm mt-1">
                    {activeGuideline.version} · Uploaded {formatDate(activeGuideline.created_at)}
                  </p>
                </div>
              ) : (
                <p className="text-slate-500">No active guideline set</p>
              )}
            </div>

            {/* Total Guidelines */}
            <div className="bg-white rounded-lg shadow-md border border-slate-200 p-6">
              <div className="flex items-start justify-between mb-4">
                <h3 className="text-slate-600">Total Guidelines</h3>
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                  <FileText className="w-6 h-6 text-blue-600" />
                </div>
              </div>
              <div className="text-slate-900 text-4xl font-bold">{guidelines.length}</div>
            </div>
          </div>

          {/* Search + Sort */}
          <div className="mb-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-9 relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search by name, version, or uploaded by..."
                  className="w-full pl-12 pr-4 py-3 bg-white border-2 border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600 transition-colors"
                />
              </div>
              <div className="lg:col-span-3 relative">
                <ArrowUpDown className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as SortKey)}
                  className="w-full pl-12 pr-4 py-3 bg-white border-2 border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600 transition-colors appearance-none cursor-pointer"
                >
                  <option value="uploadDate-desc">Newest First</option>
                  <option value="uploadDate-asc">Oldest First</option>
                  <option value="name-asc">Name (A–Z)</option>
                  <option value="name-desc">Name (Z–A)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Guidelines Table */}
          <div className="bg-white rounded-lg shadow-md border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-4 text-left text-slate-900">Guideline Name</th>
                    <th className="px-6 py-4 text-left text-slate-900">Version</th>
                    <th className="px-6 py-4 text-left text-slate-900">Upload Date</th>
                    <th className="px-6 py-4 text-left text-slate-900">Status</th>
                    <th className="px-6 py-4 text-center text-slate-900">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {sorted.map(guideline => {
                    const displayStatus = mapGuidelineProcessingStatus(guideline.processing_status);
                    const isActivating = activatingId === guideline.guideline_id;
                    const isDeleting = deletingId === guideline.guideline_id;
                    const isReviewing = reviewingId === guideline.guideline_id;
                    const canActivate = guideline.processing_status === 'reviewed' && guideline.status !== 'active';
                    const canDelete = guideline.status !== 'active';
                    const canReview = guideline.processing_status === 'completed'; // only before human review

                    return (
                      <tr key={guideline.guideline_id} className="hover:bg-slate-50 transition-colors">

                        {/* Name */}
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => setSelectedGuideline(guideline)}
                              className="text-slate-900 hover:text-blue-600 hover:underline transition-colors text-left"
                            >
                              {guideline.description}
                            </button>
                            {guideline.status === 'active' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 text-sm">
                                <CheckCircle className="w-3 h-3" />
                                Active
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Version */}
                        <td className="px-6 py-4">
                          <span className="text-slate-500 font-mono text-sm">{guideline.version}</span>
                        </td>

                        {/* Upload Date */}
                        <td className="px-6 py-4">
                          <span className="text-slate-600">{formatDate(guideline.created_at)}</span>
                        </td>

                        {/* Processing Status */}
                        <td className="px-6 py-4">
                          <ProcessingBadge status={displayStatus} />
                        </td>

                        {/* Actions */}
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-center gap-2">

                            {/* Review Rules */}
                            <button
                              onClick={() => handleReviewRules(guideline)}
                              disabled={!canReview || isReviewing || isActivating || isDeleting}
                              className="p-2 text-blue-600 hover:bg-blue-50 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                              title={
                                guideline.processing_status === 'reviewed'
                                  ? 'Already reviewed — activate from dashboard'
                                  : guideline.processing_status !== 'completed'
                                  ? 'Rules not ready yet'
                                  : 'Review & edit rules'
                              }
                            >
                              {isReviewing
                                ? <Loader2 className="w-4 h-4 animate-spin" />
                                : <Eye className="w-4 h-4" />
                              }
                            </button>

                            {/* Activate */}
                            <button
                              onClick={() => handleActivate(guideline)}
                              disabled={!canActivate || isActivating}
                              className="p-2 text-emerald-600 hover:bg-emerald-50 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                              title={
                                guideline.status === 'active'
                                  ? 'Already active'
                                  : guideline.processing_status === 'completed'
                                  ? 'Must be reviewed before activating'
                                  : guideline.processing_status !== 'reviewed'
                                  ? 'Must finish processing before activating'
                                  : 'Set as active'
                              }
                            >
                              {isActivating
                                ? <Loader2 className="w-4 h-4 animate-spin" />
                                : <CheckCircle className="w-4 h-4" />
                              }
                            </button>

                            {/* Delete */}
                            <button
                              onClick={() => setConfirmDeleteId(guideline.guideline_id)}
                              disabled={!canDelete || isDeleting}
                              className="p-2 text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                              title={guideline.status === 'active' ? 'Cannot delete active guideline' : 'Delete'}
                            >
                              {isDeleting
                                ? <Loader2 className="w-4 h-4 animate-spin" />
                                : <Trash2 className="w-4 h-4" />
                              }
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Empty State */}
            {sorted.length === 0 && (
              <div className="py-12 text-center">
                <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                {searchQuery
                  ? <><p className="text-slate-600 mb-2">No guidelines match your search</p><p className="text-slate-500">Try adjusting your search criteria</p></>
                  : <><p className="text-slate-600 mb-2">No guidelines uploaded yet</p><p className="text-slate-500">Click "Upload New Guideline" to get started</p></>
                }
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 py-4 px-8 text-center mt-8">
        <p>TPD Records Processing System v1.0 | Secure Document Processing</p>
      </footer>

      {/* ── GUIDELINE DETAIL MODAL ── */}
      {selectedGuideline && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full flex flex-col">

            {/* Header */}
            <div className="flex items-start justify-between p-6 border-b border-slate-200">
              <div>
                <h2 className="text-slate-900 mb-1">{selectedGuideline.description}</h2>
                <div className="flex flex-wrap items-center gap-3 text-slate-500 text-sm">
                  <span>Version: {selectedGuideline.version}</span>
                  <span>·</span>
                  <span>Uploaded: {formatDate(selectedGuideline.created_at)}</span>
                  <span>·</span>
                  <span>By: {selectedGuideline.uploaded_by_name}</span>
                </div>
              </div>
              <button
                onClick={() => setSelectedGuideline(null)}
                className="text-slate-400 hover:text-slate-600 transition-colors ml-4 flex-shrink-0"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Processing Status</span>
                <ProcessingBadge status={mapGuidelineProcessingStatus(selectedGuideline.processing_status)} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Activation Status</span>
                {selectedGuideline.status === 'active' ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 text-sm">
                    <CheckCircle className="w-3 h-3" />
                    Active
                  </span>
                ) : (
                  <span className="text-slate-500 text-sm">Inactive</span>
                )}
              </div>
              {selectedGuideline.activated_at && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Activated</span>
                  <span className="text-slate-500 text-sm">{formatDate(selectedGuideline.activated_at)}</span>
                </div>
              )}
              {selectedGuideline.error_info?.last_error && (
                <div className="mt-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                  <p className="text-red-700 text-sm font-medium mb-1">Last Error</p>
                  <p className="text-red-600 text-sm">{selectedGuideline.error_info.last_error}</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200">
              {selectedGuideline.status !== 'active' && selectedGuideline.processing_status === 'reviewed' && (
                <button
                  onClick={async () => {
                    setSelectedGuideline(null);
                    await handleActivate(selectedGuideline);
                  }}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-sm"
                >
                  Set as Active
                </button>
              )}
              <button
                onClick={() => setSelectedGuideline(null)}
                className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DELETE CONFIRMATION MODAL ── */}
      {confirmDeleteId && (() => {
        const target = guidelines.find(g => g.guideline_id === confirmDeleteId);
        return (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
              <h3 className="text-slate-900 mb-2">Delete Guideline?</h3>
              <p className="text-slate-600 mb-6">
                Are you sure you want to delete <span className="font-medium">"{target?.description}"</span>?
                This cannot be undone. The original PDF will be retained in S3 for audit purposes.
              </p>
              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteConfirm}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}