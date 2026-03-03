import { CheckCircle2, Shield, Eye, FileText, ChevronDown, ChevronUp, Loader2, AlertCircle } from 'lucide-react';
import { useState, useEffect } from 'react';
import {
  getRedactionProposals,
  getActiveGuideline,
  type RedactionProposalsJson,
  type RedactionItem,
  type GuidelineRule,
} from './apigatewaymanager';

// ─── Props ────────────────────────────────────────────────────────────────────

interface RedactionRulesInlineProps {
  caseId: string;
  isConfirmed: boolean;
  onConfirmChange: (confirmed: boolean) => void;
  /** Called with the edited RedactionProposalsJson when the officer approves */
  onApprove: (editedJson: RedactionProposalsJson) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Group a flat redactions array into sections by the first matching rule's
 * category. Each section holds all redaction items that share that category.
 * Items whose rule IDs don't resolve to a known guideline rule are grouped
 * under a generic "Other" section.
 */
function groupByCategory(
  redactions: RedactionItem[],
  rulesMap: Map<string, GuidelineRule>
): {
  category: string;
  ruleLabel: string;
  ruleText: string;
  items: RedactionItem[];
}[] {
  const sections = new Map<
    string,
    { category: string; ruleLabel: string; ruleText: string; items: RedactionItem[] }
  >();

  for (const item of redactions) {
    // Use the first rule ID that resolves; fall back to raw ID or "Other"
    const firstResolved = item.rules
      .map(id => rulesMap.get(id))
      .find(Boolean);

    const category  = firstResolved?.category ?? 'Other';
    const ruleLabel = firstResolved
      ? `${firstResolved.category} → Rule #${firstResolved.id}`
      : `Rule #${item.rules[0] ?? '?'}`;
    const ruleText  = firstResolved?.rule_text ?? 'No rule description available.';

    if (!sections.has(category)) {
      sections.set(category, { category, ruleLabel, ruleText, items: [] });
    }
    sections.get(category)!.items.push(item);
  }

  return Array.from(sections.values());
}

/** Stable unique key for a redaction item used as a toggle map key */
function itemKey(item: RedactionItem): string {
  return `${item.page}-${item.text}-${item.instance}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RedactionRulesInline({
  caseId,
  isConfirmed,
  onConfirmChange,
  onApprove,
}: RedactionRulesInlineProps) {

  // ── Fetch state ──────────────────────────────────────────────────────────────

  const [proposals, setProposals]   = useState<RedactionProposalsJson | null>(null);
  const [rulesMap, setRulesMap]     = useState<Map<string, GuidelineRule>>(new Map());
  const [loading, setLoading]       = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setFetchError(null);

      // Fetch proposals and active guideline in parallel
      const [proposalsResult, guidelineResult] = await Promise.all([
        getRedactionProposals(caseId),
        getActiveGuideline(),
      ]);

      if (cancelled) return;

      if (proposalsResult.error || !proposalsResult.data) {
        setFetchError(proposalsResult.error ?? 'Failed to load redaction proposals.');
        setLoading(false);
        return;
      }

      if (guidelineResult.error || !guidelineResult.data) {
        setFetchError(guidelineResult.error ?? 'Failed to load active guidelines.');
        setLoading(false);
        return;
      }

      // Build rule ID → GuidelineRule lookup map
      const map = new Map<string, GuidelineRule>();
      for (const rule of guidelineResult.data.guidelines_content?.guidelines ?? []) {
        map.set(rule.id, rule);
      }

      setProposals(proposalsResult.data);
      setRulesMap(map);

      // Default all redactions to approved (checked)
      const initialApproved: Record<string, boolean> = {};
      for (const item of proposalsResult.data.redactions) {
        initialApproved[itemKey(item)] = true;
      }
      setApprovedMap(initialApproved);

      // Default all categories to expanded
      const sections = groupByCategory(proposalsResult.data.redactions, map);
      const initialExpanded: Record<string, boolean> = {};
      for (const s of sections) {
        initialExpanded[s.category] = true;
      }
      setExpandedSections(initialExpanded);

      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [caseId]);

  // ── Review interaction state ──────────────────────────────────────────────────

  /** Map of itemKey → whether the officer wants this redaction applied */
  const [approvedMap, setApprovedMap]           = useState<Record<string, boolean>>({});
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [pulsingKey, setPulsingKey]             = useState<string | null>(null);

  const toggleApproval = (key: string) => {
    setApprovedMap(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleSection = (category: string) => {
    setExpandedSections(prev => ({ ...prev, [category]: !prev[category] }));
  };

  const handleItemClick = (key: string) => {
    setPulsingKey(key);
    setTimeout(() => setPulsingKey(null), 1500);
  };

  // ── Approve handler ───────────────────────────────────────────────────────────

  const handleApprove = () => {
    if (!proposals) return;

    // Pass up only the redactions the officer left checked
    const editedJson: RedactionProposalsJson = {
      ...proposals,
      redactions: proposals.redactions.filter(item => approvedMap[itemKey(item)] !== false),
    };

    onApprove(editedJson);
  };

  // ── Derived display values ────────────────────────────────────────────────────

  const sections      = proposals ? groupByCategory(proposals.redactions, rulesMap) : [];
  const totalProposed = proposals?.redactions.length ?? 0;
  const totalApproved = Object.values(approvedMap).filter(Boolean).length;

  // ── Loading state ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-slate-900 mb-2">Review Redaction Rules</h3>
          <p className="text-slate-600">Review highlighted areas and confirm redaction rules before processing.</p>
        </div>
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
          <p className="text-slate-600">Loading redaction proposals...</p>
        </div>
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────────

  if (fetchError) {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-slate-900 mb-2">Review Redaction Rules</h3>
          <p className="text-slate-600">Review highlighted areas and confirm redaction rules before processing.</p>
        </div>
        <div className="p-6 bg-red-50 rounded-lg border border-red-200 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-red-900 mb-1">Failed to load redaction data</p>
            <p className="text-red-700">{fetchError}</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div>
        <h3 className="text-slate-900 mb-2">Review Redaction Rules</h3>
        <p className="text-slate-600">
          Review highlighted areas and confirm redaction rules before processing.
        </p>
      </div>

      {/* Alert Banner */}
      <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-blue-900 mb-1">
              {totalProposed} item{totalProposed !== 1 ? 's' : ''} identified for redaction in this document
            </p>
            <p className="text-blue-800">
              Please review all highlighted areas and redaction rules before approving.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left Panel — Document Preview */}
        <div className="bg-white rounded-lg shadow-md border border-slate-200 p-6">
          <div className="flex items-center gap-3 mb-4 pb-4 border-b border-slate-200">
            <FileText className="w-5 h-5 text-slate-600" />
            <h4 className="text-slate-900">Document Preview</h4>
          </div>

          {/* Pages grouped view — one card per page, redaction items highlighted inside */}
          <div className="space-y-4">
            {Array.from(new Set(proposals?.redactions.map(r => r.page) ?? []))
              .sort((a, b) => a - b)
              .map(pageNum => {
                const pageItems = proposals!.redactions.filter(r => r.page === pageNum);
                return (
                  <div key={pageNum} className="bg-slate-100 rounded-lg border-2 border-slate-300 p-6">
                    <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-400">
                      <span className="text-slate-700">Page {pageNum}</span>
                      <Eye className="w-4 h-4 text-slate-600" />
                    </div>
                    <div className="space-y-2">
                      {pageItems.map(item => {
                        const key      = itemKey(item);
                        const isActive = approvedMap[key] !== false;
                        return (
                          <div key={key} className="bg-white p-2 rounded">
                            <p className="text-slate-900">
                              <span
                                className={`transition-all ${
                                  isActive ? 'bg-amber-300 px-1' : ''
                                } ${
                                  pulsingKey === key ? 'animate-pulse ring-4 ring-blue-400' : ''
                                }`}
                              >
                                {item.text}
                              </span>
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

            {/* Footer row */}
            <div className="flex items-center justify-between pt-2">
              <p className="text-slate-600">{totalApproved} of {totalProposed} redactions applied</p>
              <p className="text-slate-500">{proposals?.total_pages ?? 0} pages total</p>
            </div>
          </div>

          {/* Legend */}
          <div className="mt-6 pt-6 border-t border-slate-200">
            <h4 className="text-slate-900 mb-3">Highlight Legend</h4>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-amber-300 rounded" />
              <span className="text-slate-600">Areas to be redacted</span>
            </div>
          </div>
        </div>

        {/* Right Panel — AI Suggested Redactions */}
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-md border border-slate-200 p-6 max-h-[800px] overflow-y-auto">
            <h4 className="text-slate-900 mb-4">AI Suggested Redactions</h4>

            <div className="space-y-4">
              {sections.map((section, sectionIndex) => {
                const sectionApplied = section.items.filter(
                  item => approvedMap[itemKey(item)] !== false
                ).length;

                return (
                  <div key={sectionIndex} className="border border-slate-200 rounded-lg overflow-hidden">
                    {/* Collapsible Section Header */}
                    <button
                      onClick={() => toggleSection(section.category)}
                      className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <Shield className="w-5 h-5 text-blue-600" />
                        <div className="text-left">
                          <p className="text-slate-900">{section.ruleText}</p>
                          <p className="text-slate-600">
                            {sectionApplied} of {section.items.length} applied
                          </p>
                        </div>
                      </div>
                      {expandedSections[section.category] ? (
                        <ChevronUp className="w-5 h-5 text-slate-600" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-slate-600" />
                      )}
                    </button>

                    {/* Collapsible Section Content */}
                    {expandedSections[section.category] && (
                      <div className="p-4 space-y-4 bg-white">
                        {/* Rule Label and Text */}
                        <div className="pb-3 border-b border-slate-200">
                          <p className="text-slate-900 font-medium mb-1">{section.ruleText}</p>
                        </div>
                        {/* Individual Suggestions */}
                        <div className="space-y-3">
                          {section.items.map((item, itemIndex) => {
                            const key       = itemKey(item);
                            const isApplied = approvedMap[key] !== false;
                            return (
                              <div
                                key={itemIndex}
                                className={`p-4 rounded-lg border-2 transition-all ${
                                  isApplied
                                    ? 'bg-white border-blue-200'
                                    : 'bg-slate-50 border-slate-200 opacity-60'
                                }`}
                              >
                                {/* Top Row */}
                                <div className="flex items-center justify-between mb-3">
                                  <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={isApplied}
                                      onChange={() => toggleApproval(key)}
                                      className="w-5 h-5 text-blue-600 border-2 border-slate-300 rounded focus:ring-2 focus:ring-blue-500"
                                    />
                                    <span className={`${isApplied ? 'text-slate-900' : 'text-slate-500'}`}>
                                      Redact
                                    </span>
                                    {!isApplied && (
                                      <span className="px-2 py-0.5 bg-slate-200 text-slate-600 rounded text-xs">
                                        Ignored
                                      </span>
                                    )}
                                  </label>

                                  <div className="text-slate-600">
                                    <span>Page {item.page}, instance {item.instance}</span>
                                  </div>
                                </div>

                                {/* Redacted Value — click to pulse in preview */}
                                <div
                                  onClick={() => handleItemClick(key)}
                                  className={`p-3 rounded border cursor-pointer transition-all ${
                                    isApplied
                                      ? 'bg-amber-50 border-amber-300 hover:border-amber-400'
                                      : 'bg-slate-100 border-slate-300'
                                  }`}
                                >
                                  <p className={`break-words ${isApplied ? 'text-slate-900' : 'text-slate-500'}`}>
                                    &quot;{item.text}&quot;
                                  </p>
                                </div>

                                {/* Rule badges — show human-readable rule text */}
                                {item.rules.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-2">
                                    {item.rules.map(ruleId => {
                                      const rule = rulesMap.get(ruleId);
                                      const label = rule
                                        ? rule.rule_text
                                        : `Rule #${ruleId}`;
                                      return (
                                        <span
                                          key={ruleId}
                                          className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs"
                                        >
                                          {label.replace(/_/g, ' ')}
                                        </span>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Confirmation Section */}
          <div className="bg-white rounded-lg shadow-md border border-slate-200 p-6">
            <h4 className="text-slate-900 mb-4">Confirmation Required</h4>

            <label className="flex items-start gap-3 cursor-pointer group mb-6">
              <input
                type="checkbox"
                checked={isConfirmed}
                onChange={(e) => onConfirmChange(e.target.checked)}
                className="mt-1 w-5 h-5 text-blue-600 border-2 border-slate-300 rounded focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-slate-900 group-hover:text-slate-700">
                I have reviewed and approve the redaction rules. I understand that these redactions will be permanently applied to the document according to TPD guidelines.
              </span>
            </label>

            <div className="flex gap-3">
              <button
                onClick={handleApprove}
                disabled={!isConfirmed}
                className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-5 h-5" />
                Approve Redaction Rules
              </button>
            </div>
          </div>

          {/* Information Notice */}
          <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
            <p className="text-slate-600">
              Once approved, the system will automatically apply redactions based on the rules above. This process is irreversible.
            </p>
          </div>
        </div>
      </div>

    </div>
  );
}