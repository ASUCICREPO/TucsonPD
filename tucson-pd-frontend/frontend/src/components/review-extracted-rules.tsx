import { CheckCircle2, Shield, Eye, FileText, ChevronDown, ChevronUp, ArrowLeft, Edit2, Save, X } from 'lucide-react';
import { useState } from 'react';
import { PDFPageViewer } from './pdf-page-viewer';

interface ExtractedRule {
  id: string;
  title: string;
  category: string;
  ruleText: string;
}

interface ReviewExtractedRulesProps {
  fileName: string;
  extractedRules: ExtractedRule[];
  onSaveGuideline: (rules: ExtractedRule[]) => void;
  onBackToUpload: () => void;
  fileUrl?: string | null;
}

export function ReviewExtractedRules({ 
  fileName, 
  extractedRules: initialRules,
  onSaveGuideline,
  onBackToUpload,
  fileUrl
}: ReviewExtractedRulesProps) {
  const [rules, setRules] = useState<ExtractedRule[]>(initialRules);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  
  // State for collapsible sections
  const [expandedCategories, setExpandedCategories] = useState<{ [key: string]: boolean }>({
    'PII': true,
    'Addresses': true,
    'Names': true,
    'Sensitive Info': true,
  });

  // Group rules by category
  const rulesByCategory = rules.reduce((acc, rule) => {
    if (!acc[rule.category]) {
      acc[rule.category] = [];
    }
    acc[rule.category].push(rule);
    return acc;
  }, {} as { [key: string]: ExtractedRule[] });

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => ({ ...prev, [category]: !prev[category] }));
  };

  const handleEditRule = (rule: ExtractedRule) => {
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

  const handleSaveGuideline = () => {
    if (isConfirmed) {
      onSaveGuideline(rules);
    }
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
                
                <div className="space-y-4">
                  {Object.entries(rulesByCategory).map(([category, categoryRules]) => (
                    <div key={category} className="border border-slate-200 rounded-lg overflow-hidden">
                      {/* Collapsible Category Header */}
                      <button
                        onClick={() => toggleCategory(category)}
                        className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <Shield className="w-5 h-5 text-blue-600" />
                          <div className="text-left">
                            <p className="text-slate-900">{category}</p>
                            <p className="text-slate-600">
                              {categoryRules.length} {categoryRules.length === 1 ? 'rule' : 'rules'}
                            </p>
                          </div>
                        </div>
                        {expandedCategories[category] ? (
                          <ChevronUp className="w-5 h-5 text-slate-600" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-slate-600" />
                        )}
                      </button>

                      {/* Collapsible Category Content */}
                      {expandedCategories[category] && (
                        <div className="p-4 space-y-4 bg-white">
                          {categoryRules.map((rule) => (
                            <div
                              key={rule.id}
                              className="p-4 rounded-lg border-2 border-slate-200 bg-slate-50"
                            >
                              {/* Rule Title */}
                              <div className="flex items-center justify-between mb-3">
                                <div className="inline-block px-3 py-1 bg-blue-100 text-blue-800 rounded-full">
                                  {rule.title}
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

                              {/* Rule Text - Editable */}
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
                                <p className="text-slate-700 bg-white p-3 rounded border border-slate-200">
                                  {rule.ruleText}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
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

                <div className="flex gap-3">
                  <button
                    onClick={onBackToUpload}
                    className="px-6 py-3 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors flex items-center justify-center gap-2"
                  >
                    <ArrowLeft className="w-5 h-5" />
                    Back to Upload
                  </button>
                  <button
                    onClick={handleSaveGuideline}
                    disabled={!isConfirmed}
                    className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 className="w-5 h-5" />
                    Save Guideline
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