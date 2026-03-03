import { useState, useEffect } from 'react';
import { CheckCircle2, ShieldCheck, Eye, FileText, Download, ArrowLeft, Loader2, AlertCircle } from 'lucide-react';
import {
  getEditedRedactions,
  getActiveGuideline,
  type RedactionProposalsJson,
  type RedactionItem,
  type GuidelineRule,
} from './apigatewaymanager';

// ─── Props ────────────────────────────────────────────────────────────────────

interface RedactionStats {
  totalRedactions: number;
}

interface RedactionCompleteInlineProps {
  caseId: string;
  fileName: string;
  classificationLevel: string;
  redactionStats: RedactionStats;
  isMarkedComplete: boolean;
  onDownload: () => void;
  onComplete: () => void;
  onGoToDashboard: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Group redaction items by page number, sorted ascending */
function groupByPage(redactions: RedactionItem[]): Map<number, RedactionItem[]> {
  const map = new Map<number, RedactionItem[]>();
  for (const item of redactions) {
    if (!map.has(item.page)) map.set(item.page, []);
    map.get(item.page)!.push(item);
  }
  return new Map([...map.entries()].sort((a, b) => a[0] - b[0]));
}

/**
 * Derive category breakdown counts from the redactions and rules map.
 * Categories come from GuidelineRule.category — we count redaction items per category.
 */
function buildCategoryBreakdown(
  redactions: RedactionItem[],
  rulesMap: Map<string, GuidelineRule>
): { category: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of redactions) {
    const firstRule = item.rules.map(id => rulesMap.get(id)).find(Boolean);
    const category = firstRule?.category ?? 'Other';
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RedactionCompleteInline({
  caseId,
  fileName,
  classificationLevel,
  redactionStats,
  isMarkedComplete,
  onDownload,
  onComplete,
  onGoToDashboard,
}: RedactionCompleteInlineProps) {

  // ── Fetch state ───────────────────────────────────────────────────────────

  const [redactions, setRedactions] = useState<RedactionProposalsJson | null>(null);
  const [rulesMap, setRulesMap]     = useState<Map<string, GuidelineRule>>(new Map());
  const [loading, setLoading]       = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setFetchError(null);

      const [redactionsResult, guidelineResult] = await Promise.all([
        getEditedRedactions(caseId),
        getActiveGuideline(),
      ]);

      if (cancelled) return;

      if (redactionsResult.error || !redactionsResult.data) {
        setFetchError(redactionsResult.error ?? 'Failed to load redaction data.');
        setLoading(false);
        return;
      }

      // Guideline failure is non-fatal — we still show the summary without category labels
      if (guidelineResult.data) {
        const map = new Map<string, GuidelineRule>();
        for (const rule of guidelineResult.data.guidelines_content?.guidelines ?? []) {
          map.set(rule.id, rule);
        }
        setRulesMap(map);
      }

      setRedactions(redactionsResult.data);
      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [caseId]);

  // ── Derived display values ────────────────────────────────────────────────

  const pageGroups        = redactions ? groupByPage(redactions.redactions) : new Map();
  const categoryBreakdown = redactions ? buildCategoryBreakdown(redactions.redactions, rulesMap) : [];
  const totalApplied      = redactions?.redactions.length ?? redactionStats.totalRedactions;

  // ── Loading state ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-slate-900 mb-2">Redaction Complete</h3>
          <p className="text-slate-600">Loading redaction summary...</p>
        </div>
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
          <p className="text-slate-600">Loading redaction data...</p>
        </div>
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────

  if (fetchError) {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-slate-900 mb-2">Redaction Complete</h3>
        </div>
        <div className="p-6 bg-red-50 rounded-lg border border-red-200 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-red-900 mb-1">Failed to load redaction summary</p>
            <p className="text-red-700">{fetchError}</p>
          </div>
        </div>
        <ActionButtons
          isMarkedComplete={isMarkedComplete}
            onComplete={onComplete}
          onGoToDashboard={onGoToDashboard}
          onDownload={onDownload}
        />
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center">
            <CheckCircle2 className="w-6 h-6 text-emerald-600" />
          </div>
          <div>
            <h3 className="text-slate-900">Redaction Complete</h3>
            <p className="text-slate-600">
              All redactions applied based on TPD Redaction Guidelines for {classificationLevel}.
            </p>
          </div>
        </div>
      </div>

      {/* Redaction Summary */}
      <div className="bg-white rounded-lg shadow-md border border-slate-200 p-6">
        <h4 className="text-slate-900 mb-6">Redaction Summary</h4>

        {categoryBreakdown.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {categoryBreakdown.slice(0, 3).map(({ category, count }) => (
              <div key={category} className="p-4 bg-blue-50 rounded-lg border border-blue-200 text-center">
                <div className="mb-2">
                  <span className="text-blue-900 text-2xl font-semibold">{count}</span>
                </div>
                <p className="text-blue-700 text-sm truncate" title={category.replace(/_/g, ' ')}>{category.replace(/_/g, ' ')}</p>
              </div>
            ))}
            <div className="p-4 bg-slate-100 rounded-lg border border-slate-300 text-center">
              <div className="mb-2">
                <span className="text-slate-900 text-2xl font-semibold">{totalApplied}</span>
              </div>
              <p className="text-slate-600 text-sm">Total Redactions</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 max-w-xs">
            <div className="p-4 bg-blue-50 rounded-lg border border-blue-200 text-center">
              <div className="mb-2">
                <span className="text-blue-900 text-2xl font-semibold">{totalApplied}</span>
              </div>
              <p className="text-blue-700 text-sm">Total Redactions Applied</p>
            </div>
          </div>
        )}
      </div>

      {/* Before / After Comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Left Panel — Original (redacted text highlighted in amber) */}
        <div className="bg-white rounded-lg shadow-md border border-slate-200 p-6">
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-200">
            <FileText className="w-5 h-5 text-slate-600" />
            <h4 className="text-slate-900">Original Document</h4>
          </div>

          <div className="space-y-4">
            {Array.from(pageGroups.entries()).map(([pageNum, items]) => (
              <div key={pageNum} className="bg-slate-100 rounded-lg border-2 border-slate-300 p-4">
                <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-400">
                  <span className="text-slate-700 text-sm">Page {pageNum}</span>
                  <Eye className="w-4 h-4 text-slate-600" />
                </div>
                <div className="space-y-2">
                  {items.map((item, i) => (
                    <div key={i} className="bg-white p-2 rounded text-sm">
                      <p className="text-slate-900 truncate">
                        <span className="bg-amber-300 px-1">{item.text}</span>
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Panel — Redacted (text replaced with black bars) */}
        <div className="bg-white rounded-lg shadow-md border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-200">
            <div className="flex items-center gap-3">
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
              <h4 className="text-slate-900">Redacted Document</h4>
            </div>
            <button
              onClick={onDownload}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 text-sm"
            >
              <Download className="w-4 h-4" />
              Download PDF
            </button>
          </div>

          <div className="space-y-4">
            {Array.from(pageGroups.entries()).map(([pageNum, items]) => (
              <div key={pageNum} className="bg-slate-100 rounded-lg border-2 border-emerald-300 p-4">
                <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-400">
                  <span className="text-slate-700 text-sm">Page {pageNum}</span>
                  <Eye className="w-4 h-4 text-slate-600" />
                </div>
                <div className="space-y-2">
                  {items.map((item, i) => (
                    <div key={i} className="bg-white p-2 rounded text-sm overflow-hidden">
                      <p className="truncate">
                        <span
                          className="inline-block bg-slate-900 select-none text-slate-900 text-xs py-0.5"
                          style={{ width: `${Math.min(Math.max(item.text.length * 7, 40), 160)}px` }}
                        >
                          &nbsp;
                        </span>
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <ActionButtons
        isMarkedComplete={isMarkedComplete}
        onComplete={onComplete}
        onGoToDashboard={onGoToDashboard}
        onDownload={onDownload}
      />
    </div>
  );
}

// ─── Action Buttons ───────────────────────────────────────────────────────────

function ActionButtons({
  isMarkedComplete,
  onComplete,
  onGoToDashboard,
  onDownload,
}: {
  isMarkedComplete: boolean;
  onComplete: () => void;
  onGoToDashboard: () => void;
  onDownload: () => void;
}) {
  if (!isMarkedComplete) {
    return (
      <div className="flex items-center justify-center">
        <button
          onClick={onComplete}
          className="px-6 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
        >
          Mark as Complete
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-6">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0" />
          <div>
            <p className="text-emerald-900 mb-1">Redaction Completed</p>
            <p className="text-emerald-800">
              This redaction has been marked as completed and cannot be edited further. You can download the redacted document or return to the dashboard.
            </p>
          </div>
        </div>
      </div>
      <div className="flex justify-center gap-4">
        <button
          onClick={onDownload}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
        >
          <Download className="w-5 h-5" />
          Download Redacted PDF
        </button>
        <button
          onClick={onGoToDashboard}
          className="px-8 py-3 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors flex items-center gap-2"
        >
          <ArrowLeft className="w-5 h-5" />
          Go to Dashboard
        </button>
      </div>
    </div>
  );
}