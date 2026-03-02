import { CheckCircle2, Shield, FileText, ArrowLeft, Edit2, Save, X, Loader2, AlertCircle } from 'lucide-react';
import { useState } from 'react';
import { PDFPageViewer } from './pdf-page-viewer';
import {
  updateGuidelineRules,
  buildGuidelinesJson,
  type FrontendRule,
} from './adminapimanager';

interface ReviewExtractedRulesProps {
  guidelineId: string;
  fileName: string;
  extractedRules: FrontendRule[];
  onSaveGuideline: (guidelineId: string) => void;
  onBackToUpload: () => void;
  fileUrl?: string | null;
}

export function ReviewExtractedRules({
  guidelineId,
  fileName,
  extractedRules: initialRules,
  onSaveGuideline,
  onBackToUpload,
  fileUrl
}: ReviewExtractedRulesProps) {
  const [rules, setRules] = useState<FrontendRule[]>(initialRules);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleEditRule = (rule: FrontendRule) => {
    setEditingRuleId(rule.id);
    setEditingText(rule.ruleText);
  };

  const handleSaveEdit = (ruleId: string) => {
    setRules(prev => prev.map(rule =>
      rule.id === ruleId ? { ...rule, ruleText: editingText } : rule
    ));
    setEditingRuleId(null);
    setEditingText('');
  };

  const handleCancelEdit = () => {
    setEditingRuleId(null);
    setEditingText('');
  };

  const handleSaveGuideline = async () => {
    if (!isConfirmed || isSaving) return;

    setIsSaving(true);
    setSaveError(null);

    const { error } = await updateGuidelineRules(
      guidelineId,
      buildGuidelinesJson(rules)
    );

    setIsSaving(false);

    if (error) {
      setSaveError(`Failed to save guideline: ${error}`);
      return;
    }

    onSaveGuideline(guidelineId);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Main Content */}
      <main className="flex-1 px-8 py-8">
        <div className="max-w-7xl mx-auto">
          {/* Header Section */}
          <div className="mb-6">
            <h2 className="text-slate-900 mb-2">Review Extracted Rules & Guidelines</h2>
            <p className="text-slate-600">
              Review and edit AI-extracted rules from the uploaded guideline document.
            </p>
          </div>

          {/* Alert Banner */}
          <div className="p-4 bg-blue-50 rounded-lg border border-blue-200 mb-6">
            <div className="flex items-start gap-3">
              <Shield className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-blue-900 mb-1">
                  {rules.length} rules extracted from this document
                </p>
                <p className="text-blue-800">
                  Please review all rules and make any necessary edits before saving.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left Panel - Document Preview */}
            <div className="bg-white rounded-lg shadow-md border border-slate-200 p-6">
              <div className="flex items-center gap-3 mb-4 pb-4 border-b border-slate-200">
                <FileText className="w-5 h-5 text-slate-600" />
                <h4 className="text-slate-900">Document Preview</h4>
              </div>

              {/* Document Viewer - Shows actual uploaded PDF */}
              <div className="max-h-[700px] overflow-y-auto">
                {fileUrl ? (
                  <PDFPageViewer 
                    fileUrl={fileUrl}
                    fileName={fileName}
                  />
                ) : (
                  <div className="bg-slate-100 rounded-lg border-2 border-slate-300 p-12 flex flex-col items-center justify-center">
                    <FileText className="w-16 h-16 text-slate-400 mb-4" />
                    <p className="text-slate-600">No document preview available</p>
                  </div>
                )}
              </div>
            </div>

            {/* Right Panel - Extracted Rules List */}
            <div className="space-y-6">
              {/* Rules Panel */}
              <div className="bg-white rounded-lg shadow-md border border-slate-200 p-6 max-h-[700px] overflow-y-auto">
                <h4 className="text-slate-900 mb-4">Extracted Rules & Guidelines</h4>
                
                <div className="space-y-3">
                  {rules.map((rule, index) => (
                    <div
                      key={rule.id}
                      className="p-4 rounded-lg border-2 border-slate-200 bg-slate-50"
                    >
                      {/* Rule header */}
                      <div className="flex items-center justify-between mb-3">
                        <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm">
                          <Shield className="w-3 h-3" />
                          Rule {index + 1}
                        </div>
                        {editingRuleId !== rule.id && (
                          <button
                            onClick={() => handleEditRule(rule)}
                            className="p-2 text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            title="Edit rule"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>

                      {/* Rule text — editable */}
                      {editingRuleId === rule.id ? (
                        <div className="space-y-3">
                          <textarea
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            className="w-full p-3 border-2 border-blue-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 min-h-[100px]"
                            autoFocus
                          />
                          <div className="flex gap-2 justify-end">
                            <button
                              onClick={handleCancelEdit}
                              className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors flex items-center gap-2"
                            >
                              <X className="w-4 h-4" />
                              Cancel
                            </button>
                            <button
                              onClick={() => handleSaveEdit(rule.id)}
                              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                            >
                              <Save className="w-4 h-4" />
                              Save Changes
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-slate-700 bg-white p-3 rounded border border-slate-200 leading-relaxed">
                          {rule.ruleText}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Confirmation Section */}
              <div className="bg-white rounded-lg shadow-md border border-slate-200 p-6">
                <h4 className="text-slate-900 mb-4">Confirmation Required</h4>
                
                <label className="flex items-start gap-3 cursor-pointer group mb-6">
                  <input
                    type="checkbox"
                    checked={isConfirmed}
                    onChange={(e) => setIsConfirmed(e.target.checked)}
                    className="mt-1 w-5 h-5 text-blue-600 border-2 border-slate-300 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-slate-900 group-hover:text-slate-700">
                    I have reviewed and validated these rules. I understand that these guidelines will be used for automated redaction processing.
                  </span>
                </label>

                {/* Save Error */}
                {saveError && (
                  <div className="mb-4 flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                    <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-red-700">{saveError}</p>
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={onBackToUpload}
                    disabled={isSaving}
                    className="px-6 py-3 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ArrowLeft className="w-5 h-5" />
                    Back to Dashboard
                  </button>
                  <button
                    onClick={handleSaveGuideline}
                    disabled={!isConfirmed || isSaving}
                    className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                  >
                    {isSaving
                      ? <><Loader2 className="w-5 h-5 animate-spin" /> Saving…</>
                      : <><CheckCircle2 className="w-5 h-5" /> Save Guideline</>
                    }
                  </button>
                </div>
              </div>

            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 py-4 px-8 text-center mt-8">
        <p>TPD Records Processing System v1.0 | Secure Document Processing</p>
      </footer>
    </div>
  );
}