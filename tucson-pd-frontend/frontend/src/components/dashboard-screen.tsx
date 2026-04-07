import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, User, FileText, Clock, CheckCircle, AlertTriangle, PlusCircle, Edit2, Trash2, Shield, Upload, ExternalLink, Download, Eye, Filter, ArrowUpDown, Loader2, ChevronDown, Check, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import {
  getCasesByOfficer,
  getOtherCases,
  deleteCase,
  getDownloadPresignedUrl,
  mapBackendStatus,
  type ApiCase,
} from './apigatewaymanager';

// Internal display shape — maps from ApiCase to what the UI expects
interface CaseData {
  id: string;             // maps to ApiCase.case_id
  caseId: string;         // maps to ApiCase.case_id (display label)
  requesterName: string;
  redactionStatus: 'Not Started' | 'In Progress' | 'Review Now' | 'Completed';
  dateCreated: string;    // formatted from ApiCase.created_at
  intakeFormData?: {
    fileName?: string;
    s3Key?: string;
  } | null;
  isMarkedComplete?: boolean;
  fileName?: string;
  s3OriginalKey?: string;
  s3RedactedKey?: string;
  isProcessing?: boolean;
  redactedBy?: string;
  redactedByEmail?: string;
}

// Map an ApiCase from the backend into the internal CaseData shape
function mapApiCase(c: ApiCase): CaseData {
  return {
    id: c.case_id,
    caseId: c.case_id,
    requesterName: c.requester_name,
    redactionStatus: mapBackendStatus(c.status),
    dateCreated: new Date(c.created_at * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }),
    intakeFormData: c.s3_paths?.intake_form
      ? { fileName: 'Intake Form', s3Key: c.s3_paths.intake_form }
      : null,
    isMarkedComplete: c.status === 'COMPLETED' || c.status === 'CLOSED',
    fileName: c.s3_paths?.unredacted_doc?.split('/').pop(),
    s3OriginalKey: c.s3_paths?.unredacted_doc ?? undefined,
    s3RedactedKey: c.s3_paths?.redacted_doc
      ?? (c.metadata as any)?.redacted_doc_path
      ?? (c.status === 'COMPLETED' || c.status === 'CLOSED' ? 'completed' : undefined),
    isProcessing: c.status === 'PROCESSING' || c.status === 'APPLYING_REDACTIONS',
    redactedBy: c.officer_name,
    redactedByEmail: c.officer_id,
  };
}

interface DashboardScreenProps {
  onStartNewCase: () => void;
  onViewCase: (caseId: string) => void;
  currentUserEmail: string;
  currentOfficerId: string;
}

export function DashboardScreen({ onStartNewCase, onViewCase, currentUserEmail, currentOfficerId }: DashboardScreenProps) {
  // ── API-driven case state ──────────────────────────────────────────────────
  const [myCases, setMyCases] = useState<CaseData[]>([]);
  const [otherCases, setOtherCases] = useState<CaseData[]>([]);
  const [isLoadingMy, setIsLoadingMy] = useState(true);
  const [isLoadingOther, setIsLoadingOther] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // ── UI state ───────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [sortColumn, setSortColumn] = useState<keyof CaseData | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('dateCreated-desc');
  const [newlyReadyForReview, setNewlyReadyForReview] = useState<Set<string>>(new Set());
  const previousProcessingRef = useRef<Set<string>>(new Set());
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const [showRedactedByDropdown, setShowRedactedByDropdown] = useState(false);
  const [redactedByFilter, setRedactedByFilter] = useState<string>('all');
  const filterDropdownRef = useRef<HTMLDivElement>(null);
  const sortDropdownRef = useRef<HTMLDivElement>(null);
  const redactedByDropdownRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<'my' | 'other'>('my');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchMyCases = useCallback(async () => {
    setIsLoadingMy(true);
    const { data, error } = await getCasesByOfficer(currentOfficerId);
    if (error) {
      setFetchError(error);
      toast.error('Failed to load your cases', { description: error });
    } else {
      setMyCases((data ?? []).map(mapApiCase));
      setFetchError(null);
    }
    setIsLoadingMy(false);
  }, [currentOfficerId]);

  const fetchOtherCases = useCallback(async () => {
    setIsLoadingOther(true);
    const { data, error } = await getOtherCases(currentOfficerId);
    if (error) {
      toast.error('Failed to load other cases', { description: error });
    } else {
      setOtherCases((data ?? []).map(mapApiCase));
    }
    setIsLoadingOther(false);
  }, [currentOfficerId]);

  // Fetch both tabs on mount
  useEffect(() => {
    fetchMyCases();
    fetchOtherCases();
  }, [fetchMyCases, fetchOtherCases]);

  // Auto-refresh every 60s when any case is still processing
  useEffect(() => {
    const hasProcessing = [...myCases, ...otherCases].some(c => c.isProcessing);
    if (!hasProcessing) return;

    const interval = setInterval(() => {
      fetchMyCases();
      fetchOtherCases();
    }, 60000);

    return () => clearInterval(interval);
  }, [myCases, otherCases, fetchMyCases, fetchOtherCases]);

  // Derive the combined list for metric cards (all cases this user can see)
  const allCases = [...myCases, ...otherCases];

  // The active set shown in the table depends on which tab is selected
  const cases = activeTab === 'my' ? myCases : otherCases;

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(event.target as Node)) {
        setShowFilterDropdown(false);
      }
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(event.target as Node)) {
        setShowSortDropdown(false);
      }
      if (redactedByDropdownRef.current && !redactedByDropdownRef.current.contains(event.target as Node)) {
        setShowRedactedByDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Get display label for filter
  const getFilterLabel = () => {
    switch (statusFilter) {
      case 'all': return 'All Statuses';
      case 'Review Now': return 'Review Now';
      case 'Completed': return 'Completed';
      default: return 'All Statuses';
    }
  };

  // Get display label for sort
  const getSortLabel = () => {
    switch (sortBy) {
      case 'dateCreated-desc': return 'Newest First';
      case 'dateCreated-asc': return 'Oldest First';
      case 'caseId-asc': return 'Case Number (A-Z)';
      case 'caseId-desc': return 'Case Number (Z-A)';
      default: return 'Newest First';
    }
  };

  // Get unique list of officers from the other-cases tab for the filter dropdown
  const getUniqueOfficers = () => {
    const officers = new Map<string, string>();
    otherCases.forEach(c => {
      if (c.redactedBy && c.redactedByEmail) {
        officers.set(c.redactedByEmail, c.redactedBy);
      }
    });
    return Array.from(officers.entries()).map(([email, name]) => ({ email, name }));
  };

  // Get display label for redacted by filter
  const getRedactedByLabel = () => {
    if (redactedByFilter === 'all') return 'All Officers';
    if (redactedByFilter === currentUserEmail) return 'My Cases';
    const officer = getUniqueOfficers().find(o => o.email === redactedByFilter);
    return officer ? officer.name : 'All Officers';
  };

  // Track when processing completes on MY cases and show toast notification
  useEffect(() => {
    const currentProcessing = new Set(myCases.filter(c => c.isProcessing).map(c => c.id));
    const previousProcessing = previousProcessingRef.current;

    // Find cases that were processing but now are not (just completed)
    const completedCases = myCases.filter(c => 
      previousProcessing.has(c.id) && 
      !currentProcessing.has(c.id) &&
      c.redactionStatus === 'Review Now'
    );

    completedCases.forEach(caseData => {
      // Show toast notification with shadcn styling
      toast.success(`${caseData.caseId} is ready for review!`, {
        description: 'Click to review the redacted document',
        action: {
          label: 'Review Now',
          onClick: () => onViewCase(caseData.caseId)
        },
        duration: 8000,
        className: 'bg-white border-slate-200',
        style: {
          backgroundColor: 'white',
          border: '1px solid rgb(226, 232, 240)',
        },
        actionButtonStyle: {
          backgroundColor: 'rgb(37, 99, 235)',
          color: 'white',
        }
      });

      // Mark this case as newly ready for review (for highlighting)
      setNewlyReadyForReview(prev => new Set(prev).add(caseData.id));
    });

    previousProcessingRef.current = currentProcessing;
  }, [myCases, onViewCase]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Completed':
        return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'Review Now':
        return 'bg-amber-100 text-amber-700 border-amber-200';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const handleSort = (column: keyof CaseData) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const handleDelete = async (caseId: string, displayId: string) => {
    if (!confirm(`Are you sure you want to delete case ${displayId}?`)) return;
    const { error } = await deleteCase(caseId);
    if (error) {
      toast.error(`Failed to delete case ${displayId}`, { description: error });
    } else {
      // Optimistically remove from local state
      setMyCases(prev => prev.filter(c => c.id !== caseId));
      setOtherCases(prev => prev.filter(c => c.id !== caseId));
      toast.success(`Case ${displayId} deleted`);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([fetchMyCases(), fetchOtherCases()]);
    setIsRefreshing(false);
  };

  const handleViewIntakeForm = async (caseData: CaseData) => {
    const { data, error } = await getDownloadPresignedUrl(
      caseData.id,
      'intake_form',
    );
    if (error || !data) {
      toast.error('Could not retrieve intake form', { description: error ?? 'Unknown error' });
      return;
    }
    window.open(data, '_blank');
  };

  const handleDownloadRedactedDocument = async (caseData: CaseData) => {
    const { data, error } = await getDownloadPresignedUrl(
      caseData.id,
      'redacted_doc',
    );
    if (error || !data) {
      toast.error('Could not retrieve redacted document', { description: error ?? 'Unknown error' });
      return;
    }
    window.open(data, '_blank', 'noopener,noreferrer');
  };

  const handleDownloadUnredactedDocument = async (caseData: CaseData) => {
    const { data, error } = await getDownloadPresignedUrl(
      caseData.id,
      'unredacted_doc',
    );
    if (error || !data) {
      toast.error('Could not retrieve original document', { description: error ?? 'Unknown error' });
      return;
    }
    window.open(data, '_blank', 'noopener,noreferrer');
  };

  // Filter the active tab's cases by search query, status, and officer
  let filteredCases = cases.filter(c => {
    const matchesSearch = (c.caseId ?? '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.requesterName ?? '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || c.redactionStatus === statusFilter;
    const matchesRedactedBy = activeTab === 'my' || redactedByFilter === 'all' || c.redactedByEmail === redactedByFilter;
    return matchesSearch && matchesStatus && matchesRedactedBy;
  });

  // Sort cases based on sortBy dropdown
  const sortedCases = [...filteredCases].sort((a, b) => {
    const [field, direction] = sortBy.split('-');
    let aVal, bVal;
    
    if (field === 'caseId') {
      aVal = a.caseId;
      bVal = b.caseId;
    } else if (field === 'requesterName') {
      aVal = a.requesterName;
      bVal = b.requesterName;
    } else if (field === 'redactionStatus') {
      aVal = a.redactionStatus;
      bVal = b.redactionStatus;
    } else if (field === 'dateCreated') {
      aVal = a.dateCreated;
      bVal = b.dateCreated;
    } else {
      return 0;
    }
    
    const modifier = direction === 'asc' ? 1 : -1;
    return aVal < bVal ? -modifier : modifier;
  });

  // Calculate metrics across all visible cases
  const totalCases = allCases.length;
  const processingCases = allCases.filter(c => c.isProcessing).length;
  const completedRedaction = allCases.filter(c => c.redactionStatus === 'Completed').length;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Main Content */}
      <main className="flex-1 px-8 py-8">
        <div className="max-w-7xl mx-auto">
          {/* Page Title and Actions */}
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="text-slate-900 mb-1">Dashboard</h2>
              <p className="text-slate-600">Manage and monitor records processing requests</p>
            </div>
            <button
              onClick={onStartNewCase}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
            >
              <PlusCircle className="w-5 h-5" />
              New Case
            </button>
          </div>

          {/* Metrics Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            {/* Total Cases */}
            <div className="bg-white rounded-lg shadow-md border border-slate-200 p-6">
              <div className="flex items-start justify-between mb-6">
                <h3 className="text-slate-600">Total Cases</h3>
                <div className="w-12 h-12 bg-slate-100 rounded-lg flex items-center justify-center">
                  <FileText className="w-6 h-6 text-slate-600" />
                </div>
              </div>
              <div className="text-slate-900 text-4xl font-bold">{totalCases}</div>
            </div>

            {/* In Progress */}
            <div className="bg-white rounded-lg shadow-md border border-slate-200 p-6">
              <div className="flex items-start justify-between mb-6">
                <h3 className="text-slate-600">Processing</h3>
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Clock className="w-6 h-6 text-blue-600" />
                </div>
              </div>
              <div className="text-slate-900 text-4xl font-bold">{processingCases}</div>
            </div>

            {/* Completed Redaction */}
            <div className="bg-white rounded-lg shadow-md border border-slate-200 p-6">
              <div className="flex items-start justify-between mb-6">
                <h3 className="text-slate-600">Completed</h3>
                <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center">
                  <CheckCircle className="w-6 h-6 text-emerald-600" />
                </div>
              </div>
              <div className="text-slate-900 text-4xl font-bold">{completedRedaction}</div>
            </div>
          </div>

          {/* Conditional Content: loading, error, empty, or table */}
          {(isLoadingMy && activeTab === 'my') || (isLoadingOther && activeTab === 'other') ? (
            <div className="bg-white rounded-lg shadow-md border border-slate-200 p-16 text-center">
              <Loader2 className="w-10 h-10 text-blue-600 animate-spin mx-auto mb-4" />
              <p className="text-slate-600">Loading cases...</p>
            </div>
          ) : fetchError ? (
            <div className="bg-white rounded-lg shadow-md border border-slate-200 p-16 text-center">
              <AlertTriangle className="w-10 h-10 text-red-500 mx-auto mb-4" />
              <p className="text-slate-900 font-medium mb-2">Failed to load cases</p>
              <p className="text-slate-500 mb-6">{fetchError}</p>
              <button
                onClick={() => { fetchMyCases(); fetchOtherCases(); }}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Retry
              </button>
            </div>
          ) : myCases.length === 0 && otherCases.length === 0 ? (
            // Empty State Placeholder
            <div className="bg-white rounded-lg shadow-md border border-slate-200 p-16">
              <div className="max-w-md mx-auto text-center">
                {/* Vector Illustration */}
                <div className="mb-8 relative">
                  <div className="w-48 h-48 mx-auto relative">
                    {/* Background circle */}
                    <div className="absolute inset-0 bg-blue-50 rounded-full"></div>
                    
                    {/* Main document icon */}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="relative">
                        <Shield className="w-24 h-24 text-blue-600" strokeWidth={1.5} />
                        <div className="absolute -bottom-2 -right-2 w-10 h-10 bg-emerald-500 rounded-full flex items-center justify-center">
                          <Upload className="w-5 h-5 text-white" />
                        </div>
                      </div>
                    </div>
                    
                    {/* Decorative elements */}
                    <div className="absolute top-8 right-4 w-3 h-3 bg-blue-300 rounded-full opacity-60"></div>
                    <div className="absolute bottom-12 left-6 w-2 h-2 bg-blue-400 rounded-full opacity-60"></div>
                    <div className="absolute top-16 left-2 w-2.5 h-2.5 bg-blue-300 rounded-full opacity-60"></div>
                  </div>
                </div>

                {/* Text Content */}
                <h3 className="text-slate-900 mb-3">No Cases Yet</h3>
                <p className="text-slate-600 mb-6">
                  Upload a document to start the redaction process
                </p>
                
                {/* Call to Action */}
                <button
                  onClick={onStartNewCase}
                  className="px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors inline-flex items-center gap-2"
                >
                  <PlusCircle className="w-5 h-5" />
                  Upload Document
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Tabs */}
              <div className="mb-6">
                <div className="border-b border-slate-200">
                  <div className="flex gap-1">
                    <button
                      onClick={() => {
                        setActiveTab('my');
                        setRedactedByFilter('all');
                      }}
                      className={`px-6 py-3 transition-all ${
                        activeTab === 'my'
                          ? 'border-b-2 border-blue-600 text-blue-600 font-medium'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      My Redactions
                    </button>
                    <button
                      onClick={() => {
                        setActiveTab('other');
                        setRedactedByFilter('all');
                      }}
                      className={`px-6 py-3 transition-all ${
                        activeTab === 'other'
                          ? 'border-b-2 border-blue-600 text-blue-600 font-medium'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      Other Redactions
                    </button>
                  </div>
                </div>
              </div>

              {/* Search Bar with Filter and Sort */}
              <div className="mb-6">
                <div className="flex items-center gap-4">
                  {/* Search Bar - Fixed Width */}
                  <div className="relative" style={{ width: '500px' }}>
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search by Case Number, Keywords..."
                      className="w-full pl-12 pr-4 py-3 bg-white border-2 border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600 transition-colors"
                    />
                  </div>

                  {/* Spacer to push buttons to the right */}
                  <div className="flex-1"></div>

                  {/* Filter and Sort Buttons - Right Aligned */}
                  <div className="flex items-center gap-4">
                    {/* Refresh Button */}
                    <button
                      onClick={handleRefresh}
                      disabled={isRefreshing}
                      title="Refresh cases"
                      className="p-3 bg-white border-2 border-slate-300 rounded-lg text-slate-600 hover:border-slate-400 hover:text-slate-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin text-blue-600' : ''}`} />
                    </button>
                    {/* Filter Dropdown */}
                    <div className="relative" style={{ width: '200px' }} ref={filterDropdownRef}>
                      <button
                        onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                        className="w-full pl-12 pr-10 py-3 bg-white border-2 border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600 transition-colors text-left relative hover:border-slate-400"
                      >
                        <Filter className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <span>{getFilterLabel()}</span>
                        <ChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 transition-transform ${showFilterDropdown ? 'rotate-180' : ''}`} />
                      </button>
                      {showFilterDropdown && (
                        <div className="absolute left-0 right-0 top-full mt-1 bg-white border-2 border-slate-300 rounded-lg shadow-lg z-20 overflow-hidden">
                          <button
                            className={`block w-full text-left px-4 py-3 text-slate-900 hover:bg-blue-50 transition-colors ${statusFilter === 'all' ? 'bg-blue-50 font-medium' : ''}`}
                            onClick={() => {
                              setStatusFilter('all');
                              setShowFilterDropdown(false);
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <span>All Statuses</span>
                              {statusFilter === 'all' && <Check className="w-4 h-4 text-blue-600" />}
                            </div>
                          </button>
                          <button
                            className={`block w-full text-left px-4 py-3 text-slate-900 hover:bg-blue-50 transition-colors border-t border-slate-200 ${statusFilter === 'Review Now' ? 'bg-blue-50 font-medium' : ''}`}
                            onClick={() => {
                              setStatusFilter('Review Now');
                              setShowFilterDropdown(false);
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <span>Review Now</span>
                              {statusFilter === 'Review Now' && <Check className="w-4 h-4 text-blue-600" />}
                            </div>
                          </button>
                          <button
                            className={`block w-full text-left px-4 py-3 text-slate-900 hover:bg-blue-50 transition-colors border-t border-slate-200 ${statusFilter === 'Completed' ? 'bg-blue-50 font-medium' : ''}`}
                            onClick={() => {
                              setStatusFilter('Completed');
                              setShowFilterDropdown(false);
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <span>Completed</span>
                              {statusFilter === 'Completed' && <Check className="w-4 h-4 text-blue-600" />}
                            </div>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Sort Dropdown */}
                    <div className="relative" style={{ width: '200px' }} ref={sortDropdownRef}>
                      <button
                        onClick={() => setShowSortDropdown(!showSortDropdown)}
                        className="w-full pl-12 pr-10 py-3 bg-white border-2 border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600 transition-colors text-left relative hover:border-slate-400"
                      >
                        <ArrowUpDown className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <span>{getSortLabel()}</span>
                        <ChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 transition-transform ${showSortDropdown ? 'rotate-180' : ''}`} />
                      </button>
                      {showSortDropdown && (
                        <div className="absolute left-0 right-0 top-full mt-1 bg-white border-2 border-slate-300 rounded-lg shadow-lg z-20 overflow-hidden">
                          <button
                            className={`block w-full text-left px-4 py-3 text-slate-900 hover:bg-blue-50 transition-colors ${sortBy === 'dateCreated-desc' ? 'bg-blue-50 font-medium' : ''}`}
                            onClick={() => {
                              setSortBy('dateCreated-desc');
                              setShowSortDropdown(false);
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <span>Newest First</span>
                              {sortBy === 'dateCreated-desc' && <Check className="w-4 h-4 text-blue-600" />}
                            </div>
                          </button>
                          <button
                            className={`block w-full text-left px-4 py-3 text-slate-900 hover:bg-blue-50 transition-colors border-t border-slate-200 ${sortBy === 'dateCreated-asc' ? 'bg-blue-50 font-medium' : ''}`}
                            onClick={() => {
                              setSortBy('dateCreated-asc');
                              setShowSortDropdown(false);
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <span>Oldest First</span>
                              {sortBy === 'dateCreated-asc' && <Check className="w-4 h-4 text-blue-600" />}
                            </div>
                          </button>
                          <button
                            className={`block w-full text-left px-4 py-3 text-slate-900 hover:bg-blue-50 transition-colors border-t border-slate-200 ${sortBy === 'caseId-asc' ? 'bg-blue-50 font-medium' : ''}`}
                            onClick={() => {
                              setSortBy('caseId-asc');
                              setShowSortDropdown(false);
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <span>Case Number (A-Z)</span>
                              {sortBy === 'caseId-asc' && <Check className="w-4 h-4 text-blue-600" />}
                            </div>
                          </button>
                          <button
                            className={`block w-full text-left px-4 py-3 text-slate-900 hover:bg-blue-50 transition-colors border-t border-slate-200 ${sortBy === 'caseId-desc' ? 'bg-blue-50 font-medium' : ''}`}
                            onClick={() => {
                              setSortBy('caseId-desc');
                              setShowSortDropdown(false);
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <span>Case Number (Z-A)</span>
                              {sortBy === 'caseId-desc' && <Check className="w-4 h-4 text-blue-600" />}
                            </div>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Redacted By Dropdown - Only show for 'other' tab */}
                    {activeTab === 'other' && (
                      <div className="relative" style={{ width: '200px' }} ref={redactedByDropdownRef}>
                        <button
                          onClick={() => setShowRedactedByDropdown(!showRedactedByDropdown)}
                          className="w-full pl-12 pr-10 py-3 bg-white border-2 border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600 transition-colors text-left relative hover:border-slate-400"
                        >
                          <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                          <span className="truncate">{getRedactedByLabel()}</span>
                          <ChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 transition-transform ${showRedactedByDropdown ? 'rotate-180' : ''}`} />
                        </button>
                        {showRedactedByDropdown && (
                          <div className="absolute left-0 right-0 top-full mt-1 bg-white border-2 border-slate-300 rounded-lg shadow-lg z-20 overflow-hidden max-h-64 overflow-y-auto">
                            <button
                              className={`block w-full text-left px-4 py-3 text-slate-900 hover:bg-blue-50 transition-colors ${redactedByFilter === 'all' ? 'bg-blue-50 font-medium' : ''}`}
                              onClick={() => {
                                setRedactedByFilter('all');
                                setShowRedactedByDropdown(false);
                              }}
                            >
                              <div className="flex items-center justify-between">
                                <span>All Officers</span>
                                {redactedByFilter === 'all' && <Check className="w-4 h-4 text-blue-600" />}
                              </div>
                            </button>
                            {getUniqueOfficers()
                              .filter(officer => officer.email !== currentUserEmail)
                              .map(officer => (
                                <button
                                  key={officer.email}
                                  className={`block w-full text-left px-4 py-3 text-slate-900 hover:bg-blue-50 transition-colors border-t border-slate-200 ${redactedByFilter === officer.email ? 'bg-blue-50 font-medium' : ''}`}
                                  onClick={() => {
                                    setRedactedByFilter(officer.email);
                                    setShowRedactedByDropdown(false);
                                  }}
                                >
                                  <div className="flex items-center justify-between">
                                    <span>{officer.name}</span>
                                    {redactedByFilter === officer.email && <Check className="w-4 h-4 text-blue-600" />}
                                  </div>
                                </button>
                              ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Case List Table */}
              <div className="bg-white rounded-lg shadow-md border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th 
                          onClick={() => handleSort('caseId')}
                          className="px-6 py-4 text-left text-slate-900 cursor-pointer hover:bg-slate-100 transition-colors"
                        >
                          Case Number
                          {sortColumn === 'caseId' && (
                            <span className="ml-2">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                          )}
                        </th>
                        <th className="px-6 py-4 text-left text-slate-900">
                          Intake Form
                        </th>
                        <th 
                          onClick={() => handleSort('redactionStatus')}
                          className="px-6 py-4 text-left text-slate-900 cursor-pointer hover:bg-slate-100 transition-colors"
                        >
                          Redaction Status
                          {sortColumn === 'redactionStatus' && (
                            <span className="ml-2">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                          )}
                        </th>
                        <th className="px-6 py-4 text-left text-slate-900">
                          Redacted Document
                        </th>
                        {activeTab === 'other' && (
                          <th className="px-6 py-4 text-left text-slate-900">
                            Redacted By
                          </th>
                        )}
                        <th 
                          onClick={() => handleSort('dateCreated')}
                          className="px-6 py-4 text-left text-slate-900 cursor-pointer hover:bg-slate-100 transition-colors"
                        >
                          Date Created
                          {sortColumn === 'dateCreated' && (
                            <span className="ml-2">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                          )}
                        </th>
                        <th className="px-6 py-4 text-center text-slate-900">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {sortedCases.map((caseData) => {
                        const isNewlyReady = newlyReadyForReview.has(caseData.id) && caseData.redactionStatus === 'Review Now' && !caseData.isProcessing;
                        const isReviewNow = caseData.redactionStatus === 'Review Now' && !caseData.isProcessing;
                        const isCurrentUserCase = caseData.redactedByEmail === currentOfficerId;
                        return (
                          <tr 
                            key={caseData.id} 
                            className={`transition-all duration-500 ${
                              isReviewNow
                                ? 'border-l-4 border-l-[#fbbf24]'
                                : 'hover:bg-slate-50'
                            }`}
                          >
                            <td className="px-6 py-4">
                              {caseData.fileName && caseData.s3OriginalKey ? (
                                <button
                                  onClick={() => handleDownloadUnredactedDocument(caseData)}
                                  className="text-blue-600 hover:text-blue-800 hover:underline transition-colors flex items-center gap-1"
                                >
                                  {caseData.caseId}
                                  <Download className="w-4 h-4" />
                                </button>
                              ) : (
                                <span className="text-slate-900">{caseData.caseId}</span>
                              )}
                            </td>
                            <td className="px-6 py-4">
                              {caseData.intakeFormData?.fileName ? (
                                <button
                                  onClick={() => handleViewIntakeForm(caseData)}
                                  className="text-blue-600 hover:text-blue-800 hover:underline transition-colors flex items-center gap-1"
                                >
                                  Intake Form
                                  <Download className="w-4 h-4" />
                                </button>
                              ) : (
                                <span className="text-slate-400">No form uploaded</span>
                              )}
                            </td>
                            <td className="px-6 py-4">
                              {caseData.isProcessing ? (
                                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border bg-blue-100 text-blue-700 border-blue-200">
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  <span>Processing...</span>
                                </div>
                              ) : caseData.redactionStatus === 'Review Now' ? (
                                activeTab === 'my' ? (
                                  <button
                                    onClick={() => onViewCase(caseData.caseId)}
                                    className="text-[#f59e0b] hover:text-[#d97706] hover:underline transition-colors cursor-pointer font-medium"
                                  >
                                    Review Now
                                  </button>
                                ) : (
                                  <span className="inline-block px-3 py-1 rounded-full border bg-amber-100 text-amber-700 border-amber-200">
                                    Under Review
                                  </span>
                                )
                              ) : (
                                <span className={`inline-block px-3 py-1 rounded-full border ${getStatusColor(caseData.redactionStatus)}`}>
                                  {caseData.redactionStatus}
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-4">
                              {caseData.s3RedactedKey ? (
                                <button
                                  onClick={() => handleDownloadRedactedDocument(caseData)}
                                  className="text-blue-600 hover:text-blue-800 hover:underline transition-colors flex items-center gap-1"
                                >
                                  Redacted PDF
                                  <Download className="w-4 h-4" />
                                </button>
                              ) : caseData.isProcessing ? (
                                <span className="text-slate-400">Processing...</span>
                              ) : (
                                <span className="text-slate-400">Not available</span>
                              )}
                            </td>
                            {activeTab === 'other' && (
                              <td className="px-6 py-4">
                                {caseData.redactedBy ? (
                                  <div className="flex items-center gap-2">
                                    <span className="text-slate-900">{caseData.redactedBy}</span>
                                    {isCurrentUserCase && (
                                      <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700 border border-blue-200">
                                        You
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-slate-400">Not available</span>
                                )}
                              </td>
                            )}
                            <td className="px-6 py-4">
                              <span className="text-slate-600">{caseData.dateCreated}</span>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center justify-center gap-2">
                                <button
                                  onClick={() => onViewCase(caseData.caseId)}
                                  className="p-2 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                  title="Open case"
                                >
                                  <Eye className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleDelete(caseData.id, caseData.caseId)}
                                  className="p-2 text-red-600 hover:bg-red-50 rounded transition-colors"
                                  title="Delete case"
                                >
                                  <Trash2 className="w-4 h-4" />
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
                {sortedCases.length === 0 && (
                  <div className="py-12 text-center">
                    <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                    {activeTab === 'my' && myCases.length === 0 ? (
                      <>
                        <p className="text-slate-600 mb-2">You haven't created any cases yet</p>
                        <p className="text-slate-500">Click "New Case" above to get started</p>
                      </>
                    ) : (
                      <>
                        <p className="text-slate-600 mb-2">No cases found</p>
                        <p className="text-slate-500">Try adjusting your search criteria</p>
                      </>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 py-4 px-8 text-center mt-8">
        <p>TPD Records Processing System v1.0 | Secure Document Processing</p>
      </footer>
    </div>
  );
}