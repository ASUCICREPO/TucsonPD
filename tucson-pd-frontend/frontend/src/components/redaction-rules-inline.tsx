import { CheckCircle2, Shield, Eye, FileText, ChevronDown, ChevronUp, ArrowLeft } from 'lucide-react';
import { useState } from 'react';

interface RedactionRule {
  category: string;
  matchCount: number;
  matches: {
    page: number;
    location: string;
    text: string;
  }[];
}

interface RedactionRulesInlineProps {
  fileName: string;
  classificationLevel: string;
  redactionRules: RedactionRule[];
  isConfirmed: boolean;
  onConfirmChange: (confirmed: boolean) => void;
  onApprove: () => void;
  onBackToUpload?: () => void;
}

export function RedactionRulesInline({ 
  fileName, 
  classificationLevel, 
  redactionRules, 
  isConfirmed, 
  onConfirmChange, 
  onApprove,
  onBackToUpload
}: RedactionRulesInlineProps) {
  const totalMatches = redactionRules.reduce((sum, rule) => sum + rule.matchCount, 0);

  // State for managing applied suggestions
  const [appliedSuggestions, setAppliedSuggestions] = useState<{ [key: string]: boolean }>({
    'officer-name': true,
    'witness-name': true,
    'witness-phone': true,
    'suspect-name': true,
    'suspect-address': true,
    'suspect-dob': true,
  });

  // State for collapsible sections
  const [expandedSections, setExpandedSections] = useState<{ [key: string]: boolean }>({
    'PII - Names': true,
    'PII - Contact Information': true,
    'PII - Personal Details': true,
  });

  // State for pulsing highlight
  const [pulsingElement, setPulsingElement] = useState<string | null>(null);

  const toggleSuggestion = (key: string) => {
    setAppliedSuggestions(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const handleSuggestionClick = (key: string) => {
    // Scroll to the element and pulse it
    setPulsingElement(key);
    setTimeout(() => setPulsingElement(null), 1500);
  };

  // AI Suggestions data structure
  const aiSuggestions = [
    {
      category: 'PII - Names',
      ruleLabel: 'PII → Name Rule #1',
      ruleText: 'TPD Redaction Rule 1.2: Redact all personally identifiable names unless authorized.',
      suggestions: [
        {
          id: 'officer-name',
          text: 'Detective Sarah Martinez',
          page: 1,
          location: 'Line 3',
        },
        {
          id: 'witness-name',
          text: 'John Anderson',
          page: 1,
          location: 'Line 6',
        },
        {
          id: 'suspect-name',
          text: 'Michael Roberts',
          page: 2,
          location: 'Line 3',
        },
      ],
    },
    {
      category: 'PII - Contact Information',
      ruleLabel: 'PII → Contact Rule #2',
      ruleText: 'TPD Redaction Rule 2.1: Redact all phone numbers, email addresses, and contact information of private citizens.',
      suggestions: [
        {
          id: 'witness-phone',
          text: '(555) 123-4567',
          page: 1,
          location: 'Line 7',
        },
      ],
    },
    {
      category: 'PII - Personal Details',
      ruleLabel: 'PII → Personal Data Rule #3',
      ruleText: 'TPD Redaction Rule 3.4: Redact addresses, dates of birth, and other sensitive personal information.',
      suggestions: [
        {
          id: 'suspect-address',
          text: '123 W. Grant Road, Apt 4B',
          page: 2,
          location: 'Line 4',
        },
        {
          id: 'suspect-dob',
          text: '07/22/1985',
          page: 2,
          location: 'Line 5',
        },
      ],
    },
  ];

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
              {totalMatches} items identified for redaction in this document
            </p>
            <p className="text-blue-800">
              Please review all highlighted areas and redaction rules before approving.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left Panel - Document Preview with Highlights */}
        <div className="bg-white rounded-lg shadow-md border border-slate-200 p-6">
          <div className="flex items-center gap-3 mb-4 pb-4 border-b border-slate-200">
            <FileText className="w-5 h-5 text-slate-600" />
            <h4 className="text-slate-900">Document Preview</h4>
          </div>

          {/* Multi-page PDF Viewer Simulation */}
          <div className="space-y-4">
            {/* Page 1 */}
            <div className="bg-slate-100 rounded-lg border-2 border-slate-300 p-6">
              <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-400">
                <span className="text-slate-700">Page 1</span>
                <Eye className="w-4 h-4 text-slate-600" />
              </div>
              <div className="space-y-3 text-slate-700">
                <div className="bg-white p-3 rounded">
                  <p className="mb-2">Police Report - Incident #2024-1156</p>
                  <p>Date: March 15, 2024</p>
                </div>
                <div className="bg-white p-2 rounded">
                  <p className="text-slate-900">
                    Reporting Officer:{' '}
                    <span 
                      className={`transition-all ${
                        appliedSuggestions['officer-name'] ? 'bg-amber-300 px-1' : ''
                      } ${
                        pulsingElement === 'officer-name' ? 'animate-pulse ring-4 ring-blue-400' : ''
                      }`}
                    >
                      Detective Sarah Martinez
                    </span>
                  </p>
                </div>
                <div className="bg-white p-3 rounded">
                  <p>Location: Downtown District</p>
                </div>
                <div className="bg-white p-2 rounded">
                  <p className="text-slate-900">
                    Witness:{' '}
                    <span 
                      className={`transition-all ${
                        appliedSuggestions['witness-name'] ? 'bg-amber-300 px-1' : ''
                      } ${
                        pulsingElement === 'witness-name' ? 'animate-pulse ring-4 ring-blue-400' : ''
                      }`}
                    >
                      John Anderson
                    </span>
                  </p>
                  <p className="text-slate-900">
                    Contact:{' '}
                    <span 
                      className={`transition-all ${
                        appliedSuggestions['witness-phone'] ? 'bg-amber-300 px-1' : ''
                      } ${
                        pulsingElement === 'witness-phone' ? 'animate-pulse ring-4 ring-blue-400' : ''
                      }`}
                    >
                      (555) 123-4567
                    </span>
                  </p>
                </div>
              </div>
            </div>

            {/* Page 2 */}
            <div className="bg-slate-100 rounded-lg border-2 border-slate-300 p-6">
              <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-400">
                <span className="text-slate-700">Page 2</span>
                <Eye className="w-4 h-4 text-slate-600" />
              </div>
              <div className="space-y-3 text-slate-700">
                <div className="bg-white p-3 rounded">
                  <p className="mb-2">Incident Details (continued)</p>
                </div>
                <div className="bg-white p-2 rounded">
                  <p className="text-slate-900">
                    Suspect:{' '}
                    <span 
                      className={`transition-all ${
                        appliedSuggestions['suspect-name'] ? 'bg-amber-300 px-1' : ''
                      } ${
                        pulsingElement === 'suspect-name' ? 'animate-pulse ring-4 ring-blue-400' : ''
                      }`}
                    >
                      Michael Roberts
                    </span>
                  </p>
                  <p className="text-slate-900">
                    Address:{' '}
                    <span 
                      className={`transition-all ${
                        appliedSuggestions['suspect-address'] ? 'bg-amber-300 px-1' : ''
                      } ${
                        pulsingElement === 'suspect-address' ? 'animate-pulse ring-4 ring-blue-400' : ''
                      }`}
                    >
                      123 W. Grant Road, Apt 4B
                    </span>
                  </p>
                  <p className="text-slate-900">
                    DOB:{' '}
                    <span 
                      className={`transition-all ${
                        appliedSuggestions['suspect-dob'] ? 'bg-amber-300 px-1' : ''
                      } ${
                        pulsingElement === 'suspect-dob' ? 'animate-pulse ring-4 ring-blue-400' : ''
                      }`}
                    >
                      07/22/1985
                    </span>
                  </p>
                </div>
                <div className="bg-white p-3 rounded">
                  <p>Evidence collected at scene</p>
                </div>
              </div>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between pt-2">
              <p className="text-slate-600">{fileName}</p>
              <p className="text-slate-500">2 pages total</p>
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

        {/* Right Panel - AI Suggested Redactions */}
        <div className="space-y-6">
          {/* AI Suggested Redactions Panel */}
          <div className="bg-white rounded-lg shadow-md border border-slate-200 p-6 max-h-[800px] overflow-y-auto">
            <h4 className="text-slate-900 mb-4">AI Suggested Redactions</h4>
            
            <div className="space-y-4">
              {aiSuggestions.map((section, sectionIndex) => (
                <div key={sectionIndex} className="border border-slate-200 rounded-lg overflow-hidden">
                  {/* Collapsible Section Header */}
                  <button
                    onClick={() => toggleSection(section.category)}
                    className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Shield className="w-5 h-5 text-blue-600" />
                      <div className="text-left">
                        <p className="text-slate-900">{section.category}</p>
                        <p className="text-slate-600">
                          {section.suggestions.filter(s => appliedSuggestions[s.id]).length} of {section.suggestions.length} applied
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
                        <div className="inline-block px-3 py-1 bg-blue-100 text-blue-800 rounded-full mb-2">
                          {section.ruleLabel}
                        </div>
                        <p className="text-slate-700">{section.ruleText}</p>
                      </div>

                      {/* Individual Suggestions */}
                      <div className="space-y-3">
                        {section.suggestions.map((suggestion, suggestionIndex) => {
                          const isApplied = appliedSuggestions[suggestion.id];
                          return (
                            <div
                              key={suggestionIndex}
                              className={`p-4 rounded-lg border-2 transition-all ${
                                isApplied
                                  ? 'bg-white border-blue-200'
                                  : 'bg-slate-50 border-slate-200 opacity-60'
                              }`}
                            >
                              {/* Top Row: Checkbox + "Redact" on left, Page/Line on right */}
                              <div className="flex items-center justify-between mb-3">
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={isApplied}
                                    onChange={(e) => {
                                      toggleSuggestion(suggestion.id);
                                    }}
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
                                  <span>Page {suggestion.page}, {suggestion.location}</span>
                                </div>
                              </div>

                              {/* Redacted Value Text Box - Clickable */}
                              <div
                                onClick={() => handleSuggestionClick(suggestion.id)}
                                className={`p-3 rounded border cursor-pointer transition-all ${
                                  isApplied 
                                    ? 'bg-amber-50 border-amber-300 hover:border-amber-400' 
                                    : 'bg-slate-100 border-slate-300'
                                }`}
                              >
                                <p className={`break-words ${
                                  isApplied ? 'text-slate-900' : 'text-slate-500'
                                }`}>
                                  &quot;{suggestion.text}&quot;
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
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
                onChange={(e) => onConfirmChange(e.target.checked)}
                className="mt-1 w-5 h-5 text-blue-600 border-2 border-slate-300 rounded focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-slate-900 group-hover:text-slate-700">
                I have reviewed and approve the redaction rules. I understand that these redactions will be permanently applied to the document according to TPD guidelines.
              </span>
            </label>

            <div className="flex gap-3">
              <button
                onClick={onApprove}
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

      {/* Back to Upload Button */}
      {onBackToUpload && (
        <div className="mt-6">
          <button
            onClick={onBackToUpload}
            className="px-6 py-3 bg-slate-200 text-slate-900 rounded-lg hover:bg-slate-300 transition-colors flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-5 h-5" />
            Back to Document Upload
          </button>
        </div>
      )}
    </div>
  );
}