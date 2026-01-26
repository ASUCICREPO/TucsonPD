import { useState, useEffect } from 'react';
import { Search, FileText, Upload, Eye, CheckCircle, Circle, Trash2, Shield, ArrowUpDown, Plus, X } from 'lucide-react';

interface GuidelineDocument {
  id: string;
  name: string;
  fileName: string;
  uploadDate: string;
  uploadedBy: string;
  isActive: boolean;
  fileSize: string;
  version: string;
}

interface AdminDashboardProps {
  cases: any[];
  onUpdateCases: (cases: any[]) => void;
  onUploadGuideline: () => void;
  newGuideline?: {
    fileName: string;
    fileSize: string;
    uploadDate: string;
  } | null;
  shouldActivateNewGuideline?: boolean;
}

export function AdminDashboard({ cases, onUpdateCases, onUploadGuideline, newGuideline, shouldActivateNewGuideline }: AdminDashboardProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<string>('uploadDate-desc');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [guidelineName, setGuidelineName] = useState('');
  const [selectedGuideline, setSelectedGuideline] = useState<GuidelineDocument | null>(null);

  // Demo guideline documents data
  const [guidelines, setGuidelines] = useState<GuidelineDocument[]>([
    {
      id: '1',
      name: 'Standard Redaction Guidelines 2025',
      fileName: 'TPD_Redaction_Guidelines_2025.pdf',
      uploadDate: 'Dec 1, 2025',
      uploadedBy: 'Admin',
      isActive: true,
      fileSize: '2.4 MB',
      version: 'v2.1'
    },
    {
      id: '2',
      name: 'PII Protection Standards',
      fileName: 'PII_Protection_Standards.pdf',
      uploadDate: 'Nov 15, 2025',
      uploadedBy: 'Admin',
      isActive: false,
      fileSize: '1.8 MB',
      version: 'v1.5'
    },
    {
      id: '3',
      name: 'Body Camera Footage Redaction Rules',
      fileName: 'Body_Camera_Redaction_Rules.pdf',
      uploadDate: 'Oct 28, 2025',
      uploadedBy: 'Admin',
      isActive: false,
      fileSize: '3.1 MB',
      version: 'v1.0'
    },
    {
      id: '4',
      name: 'Juvenile Records Guidelines',
      fileName: 'Juvenile_Records_Guidelines.pdf',
      uploadDate: 'Oct 10, 2025',
      uploadedBy: 'Admin',
      isActive: false,
      fileSize: '1.2 MB',
      version: 'v1.3'
    }
  ]);

  const handleViewGuideline = (guideline: GuidelineDocument) => {
    // Simulate viewing the guideline document
    alert(`Opening guideline: ${guideline.name}`);
  };

  const handleActivateGuideline = (guidelineId: string) => {
    setGuidelines(guidelines.map(g => ({
      ...g,
      isActive: g.id === guidelineId
    })));
  };

  const handleDeleteGuideline = (guidelineId: string, guidelineName: string) => {
    if (confirm(`Are you sure you want to delete "${guidelineName}"?`)) {
      setGuidelines(guidelines.filter(g => g.id !== guidelineId));
    }
  };

  const handleUploadGuideline = () => {
    if (!uploadFile || !guidelineName.trim()) {
      alert('Please provide a guideline name and select a file');
      return;
    }

    const newGuideline: GuidelineDocument = {
      id: `${Date.now()}`,
      name: guidelineName,
      fileName: uploadFile.name,
      uploadDate: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      uploadedBy: 'Admin',
      isActive: false,
      fileSize: `${(uploadFile.size / (1024 * 1024)).toFixed(1)} MB`,
      version: 'v1.0'
    };

    setGuidelines([newGuideline, ...guidelines]);
    setShowUploadModal(false);
    setUploadFile(null);
    setGuidelineName('');
  };

  // Handle new guideline from parent
  useEffect(() => {
    if (newGuideline && shouldActivateNewGuideline) {
      const guideline: GuidelineDocument = {
        id: `new-${Date.now()}`,
        name: newGuideline.fileName.replace(/\.[^/.]+$/, ''), // Remove file extension for name
        fileName: newGuideline.fileName,
        uploadDate: newGuideline.uploadDate,
        uploadedBy: 'Admin',
        isActive: true,
        fileSize: newGuideline.fileSize,
        version: 'v1.0'
      };
      
      // Set all existing guidelines to inactive and add new one as active
      setGuidelines(prevGuidelines => [
        guideline,
        ...prevGuidelines.map(g => ({ ...g, isActive: false }))
      ]);
    }
  }, [newGuideline, shouldActivateNewGuideline]);

  // Filter guidelines
  let filteredGuidelines = guidelines.filter(g => {
    const matchesSearch = g.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      g.fileName.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch;
  });

  // Sort guidelines
  const sortedGuidelines = [...filteredGuidelines].sort((a, b) => {
    const [field, direction] = sortBy.split('-');
    let aVal, bVal;
    
    if (field === 'name') {
      aVal = a.name;
      bVal = b.name;
    } else if (field === 'uploadDate') {
      // Convert date strings to Date objects for proper comparison
      aVal = new Date(a.uploadDate).getTime();
      bVal = new Date(b.uploadDate).getTime();
    } else {
      return 0;
    }
    
    const modifier = direction === 'asc' ? 1 : -1;
    return aVal < bVal ? -modifier : modifier;
  });

  // Calculate metrics
  const totalGuidelines = guidelines.length;
  const activeGuideline = guidelines.find(g => g.isActive);
  const inactiveGuidelines = guidelines.filter(g => !g.isActive).length;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Main Content */}
      <main className="flex-1 px-8 py-8">
        <div className="max-w-7xl mx-auto">
          {/* Page Title and Actions */}
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="text-slate-900 mb-1">Admin Dashboard</h2>
            </div>
            <button
              onClick={onUploadGuideline}
              className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-5 h-5" />
              Upload New Guideline
            </button>
          </div>

          {/* Metrics Summary */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            {/* Active Guideline Info Card */}
            <div className="bg-white rounded-lg shadow-md border border-slate-200 pt-6 px-6">
              <div className="flex items-start justify-between mb-6">
                <h3 className="text-slate-600">Active Guideline</h3>
                <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center">
                  <CheckCircle className="w-6 h-6 text-emerald-600" />
                </div>
              </div>
              {activeGuideline ? (
                <div>
                  <div className="text-slate-900 mb-2">{activeGuideline.name}</div>
                </div>
              ) : (
                <div className="text-slate-500">No active guideline</div>
              )}
            </div>

            {/* Total Guidelines Card */}
            <div className="bg-white rounded-lg shadow-md border border-slate-200 p-6">
              <div className="flex items-start justify-between mb-6">
                <h3 className="text-slate-600">Total Guidelines</h3>
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                  <FileText className="w-6 h-6 text-blue-600" />
                </div>
              </div>
              <div className="text-slate-900 text-4xl font-bold">{guidelines.length}</div>
            </div>
          </div>

          {/* Search Bar with Filter and Sort */}
          <div className="mb-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Search Bar */}
              <div className="lg:col-span-9 relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by guideline name or filename..."
                  className="w-full pl-12 pr-4 py-3 bg-white border-2 border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600 transition-colors"
                />
              </div>

              {/* Sort Dropdown */}
              <div className="lg:col-span-3 relative">
                <ArrowUpDown className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 bg-white border-2 border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600 transition-colors appearance-none cursor-pointer"
                >
                  <option value="uploadDate-desc">Newest First</option>
                  <option value="uploadDate-asc">Oldest First</option>
                  <option value="name-asc">Name (A-Z)</option>
                  <option value="name-desc">Name (Z-A)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Guidelines List Table */}
          <div className="bg-white rounded-lg shadow-md border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-4 text-left text-slate-900">Guideline Name</th>
                    <th className="px-6 py-4 text-left text-slate-900">Upload Date</th>
                    <th className="px-6 py-4 text-center text-slate-900">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {sortedGuidelines.map((guideline) => (
                    <tr key={guideline.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => setSelectedGuideline(guideline)}
                            className="text-slate-900 hover:text-blue-600 hover:underline transition-colors text-left"
                          >
                            {guideline.name}
                          </button>
                          {guideline.isActive && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 text-sm">
                              <CheckCircle className="w-3 h-3" />
                              Active
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-slate-600">{guideline.uploadDate}</span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleActivateGuideline(guideline.id)}
                            className="p-2 text-emerald-600 hover:bg-emerald-50 rounded transition-colors"
                            title="Set as active"
                            disabled={guideline.isActive}
                          >
                            <CheckCircle className={`w-4 h-4 ${guideline.isActive ? 'opacity-30' : ''}`} />
                          </button>
                          <button
                            onClick={() => handleDeleteGuideline(guideline.id, guideline.name)}
                            className="p-2 text-red-600 hover:bg-red-50 rounded transition-colors"
                            title="Delete guideline"
                            disabled={guideline.isActive}
                          >
                            <Trash2 className={`w-4 h-4 ${guideline.isActive ? 'opacity-30' : ''}`} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Empty State */}
            {sortedGuidelines.length === 0 && (
              <div className="py-12 text-center">
                <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <p className="text-slate-600 mb-2">No guidelines found</p>
                <p className="text-slate-500">Try adjusting your search criteria</p>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* View Guideline Modal */}
      {selectedGuideline && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-5xl w-full h-[85vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <div>
                <h2 className="text-slate-900 mb-1">{selectedGuideline.name}</h2>
                <div className="flex items-center gap-4 text-slate-600">
                  <span>{selectedGuideline.fileName}</span>
                  <span>•</span>
                  <span>{selectedGuideline.fileSize}</span>
                  <span>•</span>
                  <span>Uploaded: {selectedGuideline.uploadDate}</span>
                </div>
              </div>
              <button
                onClick={() => setSelectedGuideline(null)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Document Viewer */}
            <div className="flex-1 overflow-auto p-6 bg-slate-50">
              <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-lg p-8">
                {/* Simulated PDF Content */}
                <div className="space-y-6">
                  <div className="text-center border-b border-slate-200 pb-4">
                    <h1 className="text-slate-900 text-3xl mb-2">{selectedGuideline.name}</h1>
                    <p className="text-slate-600">Tampa Police Department</p>
                    <p className="text-slate-600">Records Management Division</p>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <h3 className="text-slate-900 mb-2">1. Purpose and Scope</h3>
                      <p className="text-slate-700 leading-relaxed">
                        This guideline establishes standardized procedures for redacting sensitive information from public records requests. 
                        All personnel handling records must adhere to these guidelines to ensure compliance with state and federal privacy laws.
                      </p>
                    </div>

                    <div>
                      <h3 className="text-slate-900 mb-2">2. Protected Information Categories</h3>
                      <p className="text-slate-700 leading-relaxed mb-2">
                        The following categories of information must be redacted from public records:
                      </p>
                      <ul className="list-disc list-inside space-y-2 text-slate-700 ml-4">
                        <li>Personal Identifiable Information (PII): Social Security numbers, driver's license numbers, bank account information</li>
                        <li>Medical Records: Health conditions, treatment information, prescription details</li>
                        <li>Juvenile Information: Names, addresses, and identifying information of minors</li>
                        <li>Ongoing Investigation Details: Confidential sources, investigative techniques, surveillance locations</li>
                        <li>Security Information: Building layouts, security protocols, access codes</li>
                      </ul>
                    </div>

                    <div>
                      <h3 className="text-slate-900 mb-2">3. Redaction Standards</h3>
                      <p className="text-slate-700 leading-relaxed mb-2">
                        All redactions must be permanent and irreversible. Use the following methods:
                      </p>
                      <ul className="list-disc list-inside space-y-2 text-slate-700 ml-4">
                        <li>Digital redaction using approved software tools</li>
                        <li>Complete removal of metadata from electronic documents</li>
                        <li>Black boxes covering sensitive areas in scanned documents</li>
                        <li>Audio muting or beeping for video/audio recordings</li>
                      </ul>
                    </div>

                    <div>
                      <h3 className="text-slate-900 mb-2">4. Review Process</h3>
                      <p className="text-slate-700 leading-relaxed">
                        All redacted documents must be reviewed by a supervisory officer before release. The reviewing officer must 
                        verify that all sensitive information has been properly redacted and that the remaining content is appropriate 
                        for public disclosure under applicable laws and regulations.
                      </p>
                    </div>

                    <div>
                      <h3 className="text-slate-900 mb-2">5. Documentation and Retention</h3>
                      <p className="text-slate-700 leading-relaxed">
                        Maintain detailed logs of all redaction activities, including the date, officer responsible, document ID, 
                        and categories of information redacted. Original unredacted documents must be retained in secure storage 
                        according to department retention schedules.
                      </p>
                    </div>

                    <div>
                      <h3 className="text-slate-900 mb-2">6. Training Requirements</h3>
                      <p className="text-slate-700 leading-relaxed">
                        All personnel involved in records processing must complete annual training on redaction procedures, 
                        privacy laws, and the use of redaction software. Training records must be maintained in the personnel file.
                      </p>
                    </div>

                    <div className="mt-8 pt-4 border-t border-slate-200 text-slate-600 text-center">
                      <p>Document Version: {selectedGuideline.version}</p>
                      <p>Effective Date: {selectedGuideline.uploadDate}</p>
                      <p>Uploaded By: {selectedGuideline.uploadedBy}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-slate-900">Upload New Guideline</h2>
              <button
                onClick={() => {
                  setShowUploadModal(false);
                  setUploadFile(null);
                  setGuidelineName('');
                }}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Guideline Name Input */}
            <div className="mb-6">
              <label className="block text-slate-900 mb-2">Guideline Name</label>
              <input
                type="text"
                value={guidelineName}
                onChange={(e) => setGuidelineName(e.target.value)}
                placeholder="e.g., Standard Redaction Guidelines 2026"
                className="w-full px-4 py-3 bg-white border-2 border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600 transition-colors"
              />
            </div>

            {/* File Upload Area */}
            <div className="mb-6">
              <label className="block text-slate-900 mb-2">Select Document</label>
              <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:border-blue-600 transition-colors">
                {uploadFile ? (
                  <div className="space-y-4">
                    <FileText className="w-12 h-12 text-blue-600 mx-auto" />
                    <div>
                      <p className="text-slate-900">{uploadFile.name}</p>
                      <p className="text-slate-500">{(uploadFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                    </div>
                    <button
                      onClick={() => setUploadFile(null)}
                      className="text-blue-600 hover:text-blue-700 transition-colors"
                    >
                      Choose different file
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <Upload className="w-12 h-12 text-slate-400 mx-auto" />
                    <div>
                      <label className="cursor-pointer text-blue-600 hover:text-blue-700 transition-colors">
                        Browse files
                        <input
                          type="file"
                          accept=".pdf,.doc,.docx"
                          onChange={(e) => {
                            if (e.target.files && e.target.files[0]) {
                              setUploadFile(e.target.files[0]);
                            }
                          }}
                          className="hidden"
                        />
                      </label>
                      <p className="text-slate-500 mt-1">or drag and drop</p>
                    </div>
                    <p className="text-slate-500">PDF, DOC, DOCX up to 10MB</p>
                  </div>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-4">
              <button
                onClick={() => {
                  setShowUploadModal(false);
                  setUploadFile(null);
                  setGuidelineName('');
                }}
                className="px-6 py-3 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleUploadGuideline}
                disabled={!uploadFile || !guidelineName.trim()}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed"
              >
                Upload Guideline
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 py-4 px-8 text-center mt-8">
        <p>TPD Records Processing System v1.0 | Secure Document Processing</p>
      </footer>
    </div>
  );
}