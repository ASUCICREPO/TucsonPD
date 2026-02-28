import { useState, useEffect, useRef } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SignInScreen } from './components/sign-in-screen';
import { DashboardScreen } from './components/dashboard-screen';
import { CaseDetailScreen } from './components/case-detail-screen';
import { IntakeFormScreen, IntakeFormData } from './components/intake-form-screen';
import { AdminDashboard } from './components/admin-dashboard';
import { UploadGuidelineScreen } from './components/upload-guideline-screen';
import { ReviewExtractedRules } from './components/review-extracted-rules';
import { GuidelineSavedConfirmation } from './components/guideline-saved-confirmation';
import { User, LogOut, ChevronDown } from 'lucide-react';
import { Toaster } from "sonner";
import { setOfficerIdentity, getCaseById, mapBackendStatus } from './components/apigatewaymanager';

type FlowStep = 'sign-in' | 'dashboard' | 'intake-form' | 'case-detail' | 'admin-dashboard' | 'upload-guideline' | 'review-rules' | 'guideline-saved';

type RedactionStage = 'upload' | 'analyzing' | 'rules-review' | 'processing' | 'complete';

// ─── Inner app — has access to AuthContext ─────────────────────────────────────

function AppInner() {
  const { isLoading, isAuthenticated, userRole, currentUser, logout } = useAuth();

  const [currentStep, setCurrentStep] = useState<FlowStep>('sign-in');
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [selectedCaseData, setSelectedCaseData] = useState<any | null>(null);
  const [isNewCase, setIsNewCase] = useState(false);
  const [intakeFormData, setIntakeFormData] = useState<IntakeFormData | null>(null);
  const [uploadedGuidelineFile, setUploadedGuidelineFile] = useState<File | null>(null);
  const [uploadedGuidelineFileUrl, setUploadedGuidelineFileUrl] = useState<string | null>(null);
  const [savedGuidelineData, setSavedGuidelineData] = useState<{
    fileName: string;
    fileSize: string;
    uploadDate: string;
  } | null>(null);
  const [shouldActivateGuideline, setShouldActivateGuideline] = useState(false);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);

  // Populate API identity whenever Cognito auth resolves
  useEffect(() => {
    if (currentUser?.sub) {
      setOfficerIdentity({
        officer_id: currentUser.sub,
        officer_name: currentUser.name,
      });
    }
  }, [currentUser]);

  // Track active processing timers to avoid creating duplicate timers
  const activeTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  // Track which cases are currently processing to detect NEW processing cases
  const previousProcessingCasesRef = useRef<Set<string>>(new Set());

  // ── Route to the correct screen once Cognito auth resolves ──────────────────
  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) {
      setCurrentStep('sign-in');
      return;
    }

    // Only redirect if we're currently on the sign-in screen, so we don't
    // override any deeper navigation the user has already done.
    if (currentStep === 'sign-in') {
      if (userRole === 'admin') {
        setCurrentStep('admin-dashboard');
      } else {
        setCurrentStep('dashboard');
      }
    }
  }, [isLoading, isAuthenticated, userRole]);

  // Start with some default cases in the table
  const [cases, setCases] = useState<Array<{
    id: string;
    caseId: string;
    requesterName: string;
    redactionStatus: 'Not Started' | 'In Progress' | 'Review Now' | 'Completed';
    dateCreated: string;
    // Redaction state
    redactionStage?: RedactionStage;
    fileName?: string;
    fileData?: string; // Base64 encoded file data
    fileType?: string;
    fileSize?: number;
    caseNumber?: string;
    redactionCategory?: string;
    isConfirmed?: boolean;
    isMarkedComplete?: boolean;
    isProcessing?: boolean;
    // Intake form data
    intakeFormData?: IntakeFormData | null;
    // User who redacted this case
    redactedBy?: string;
    redactedByEmail?: string;
  }>>([
    {
      id: '1',
      caseId: 'TPD-45821',
      requesterName: 'Michael Johnson',
      redactionStatus: 'Completed',
      dateCreated: 'Dec 5, 2025',
      isMarkedComplete: true,
      fileName: 'Police_Report_45821_Unredacted.pdf',
      fileData: 'data:application/pdf;base64,JVBERi0xLjQKJeLjz9MNCjEgMCBvYmoKPDwvVHlwZS9DYXRhbG9nL1BhZ2VzIDIgMCBSPj4KZW5kb2JqCjIgMCBvYmoKPDwvVHlwZS9QYWdlcy9LaWRzWzMgMCBSXS9Db3VudCAxPj4KZW5kb2JqCjMgMCBvYmoKPDwvVHlwZS9QYWdlL01lZGlhQm94WzAgMCA2MTIgNzkyXS9QYXJlbnQgMiAwIFI+PgplbmRvYmoKeHJlZgowIDQKMDAwMDAwMDAwMCA2NTUzNSBmDQowMDAwMDAwMDEwIDAwMDAwIG4NCjAwMDAwMDAwNTMgMDAwMDAgbg0KMDAwMDAwMDEwMiAwMDAwMCBuDQp0cmFpbGVyCjw8L1NpemUgNC9Sb290IDEgMCBSPj4Kc3RhcnR4cmVmCjE2OAolJUVPRg==',
      fileType: 'application/pdf',
      redactedBy: 'John Davis',
      redactedByEmail: 'john.davis@tpd.gov',
      intakeFormData: {
        fileName: 'Public_Records_Request_Form.pdf',
        fileData: 'data:application/pdf;base64,demo',
        fileType: 'application/pdf'
      }
    },
    {
      id: '2',
      caseId: 'TPD-45822',
      requesterName: 'Sarah Williams',
      redactionStatus: 'Review Now',
      redactionStage: 'rules-review',
      dateCreated: 'Dec 6, 2025',
      fileName: 'Incident_Report_45822.pdf',
      fileData: 'data:application/pdf;base64,JVBERi0xLjQKJeLjz9MNCjEgMCBvYmoKPDwvVHlwZS9DYXRhbG9nL1BhZ2VzIDIgMCBSPj4KZW5kb2JqCjIgMCBvYmoKPDwvVHlwZS9QYWdlcy9LaWRzWzMgMCBSXS9Db3VudCAxPj4KZW5kb2JqCjMgMCBvYmoKPDwvVHlwZS9QYWdlL01lZGlhQm94WzAgMCA2MTIgNzkyXS9QYXJlbnQgMiAwIFI+PgplbmRvYmoKeHJlZgowIDQKMDAwMDAwMDAwMCA2NTUzNSBmDQowMDAwMDAwMDEwIDAwMDAwIG4NCjAwMDAwMDAwNTMgMDAwMDAgbg0KMDAwMDAwMDEwMiAwMDAwMCBuDQp0cmFpbGVyCjw8L1NpemUgNC9Sb290IDEgMCBSPj4Kc3RhcnR4cmVmCjE2OAolJUVPRg==',
      fileType: 'application/pdf',
      redactedBy: 'Records Officer',
      redactedByEmail: 'officer@gmail.com',
      intakeFormData: {
        fileName: 'Records_Request_12062025.pdf',
        fileData: 'data:application/pdf;base64,demo',
        fileType: 'application/pdf'
      }
    },
    {
      id: '3',
      caseId: 'TPD-45823',
      requesterName: 'David Martinez',
      redactionStatus: 'Completed',
      dateCreated: 'Dec 7, 2025',
      isMarkedComplete: true,
      fileName: 'Investigation_Report_45823.pdf',
      fileData: 'data:application/pdf;base64,JVBERi0xLjQKJeLjz9MNCjEgMCBvYmoKPDwvVHlwZS9DYXRhbG9nL1BhZ2VzIDIgMCBSPj4KZW5kb2JqCjIgMCBvYmoKPDwvVHlwZS9QYWdlcy9LaWRzWzMgMCBSXS9Db3VudCAxPj4KZW5kb2JqCjMgMCBvYmoKPDwvVHlwZS9QYWdlL01lZGlhQm94WzAgMCA2MTIgNzkyXS9QYXJlbnQgMiAwIFI+PgplbmRvYmoKeHJlZgowIDQKMDAwMDAwMDAwMCA2NTUzNSBmDQowMDAwMDAwMDEwIDAwMDAwIG4NCjAwMDAwMDAwNTMgMDAwMDAgbg0KMDAwMDAwMDEwMiAwMDAwMCBuDQp0cmFpbGVyCjw8L1NpemUgNC9Sb290IDEgMCBSPj4Kc3RhcnR4cmVmCjE2OAolJUVPRg==',
      fileType: 'application/pdf',
      redactedBy: 'Records Officer',
      redactedByEmail: 'officer@gmail.com',
      intakeFormData: {
        fileName: 'Intake_Form_Martinez.pdf',
        fileData: 'data:application/pdf;base64,demo',
        fileType: 'application/pdf'
      }
    },
    {
      id: '4',
      caseId: 'TPD-45824',
      requesterName: 'Jessica Brown',
      redactionStatus: 'Review Now',
      redactionStage: 'rules-review',
      dateCreated: 'Dec 8, 2025',
      redactedBy: 'Emily Rodriguez',
      redactedByEmail: 'emily.rodriguez@tpd.gov',
      intakeFormData: {
        fileName: 'TPD_Request_Form.pdf',
        fileData: 'data:application/pdf;base64,demo',
        fileType: 'application/pdf'
      }
    },
    {
      id: '5',
      caseId: 'TPD-45825',
      requesterName: 'Robert Taylor',
      redactionStatus: 'Review Now',
      redactionStage: 'rules-review',
      dateCreated: 'Dec 9, 2025',
      redactedBy: 'Records Officer',
      redactedByEmail: 'officer@gmail.com',
      intakeFormData: {
        fileName: 'Records_Request_Taylor.pdf',
        fileData: 'data:application/pdf;base64,demo',
        fileType: 'application/pdf'
      }
    },
    {
      id: '6',
      caseId: 'TPD-45826',
      requesterName: 'Amanda Garcia',
      redactionStatus: 'Completed',
      dateCreated: 'Nov 28, 2025',
      isMarkedComplete: true,
      fileName: 'Traffic_Incident_45826.pdf',
      fileData: 'data:application/pdf;base64,JVBERi0xLjQKJeLjz9MNCjEgMCBvYmoKPDwvVHlwZS9DYXRhbG9nL1BhZ2VzIDIgMCBSPj4KZW5kb2JqCjIgMCBvYmoKPDwvVHlwZS9QYWdlcy9LaWRzWzMgMCBSXS9Db3VudCAxPj4KZW5kb2JqCjMgMCBvYmoKPDwvVHlwZS9QYWdlL01lZGlhQm94WzAgMCA2MTIgNzkyXS9QYXJlbnQgMiAwIFI+PgplbmRvYmoKeHJlZgowIDQKMDAwMDAwMDAwMCA2NTUzNSBmDQowMDAwMDAwMDEwIDAwMDAwIG4NCjAwMDAwMDAwNTMgMDAwMDAgbg0KMDAwMDAwMDEwMiAwMDAwMCBuDQp0cmFpbGVyCjw8L1NpemUgNC9Sb290IDEgMCBSPj4Kc3RhcnR4cmVmCjE2OAolJUVPRg==',
      fileType: 'application/pdf',
      redactedBy: 'Sarah Mitchell',
      redactedByEmail: 'sarah.mitchell@tpd.gov',
      intakeFormData: {
        fileName: 'Records_Request_Garcia.pdf',
        fileData: 'data:application/pdf;base64,demo',
        fileType: 'application/pdf'
      }
    },
    {
      id: '7',
      caseId: 'TPD-45827',
      requesterName: 'Christopher Lee',
      redactionStatus: 'Review Now',
      redactionStage: 'rules-review',
      dateCreated: 'Dec 2, 2025',
      redactedBy: 'Michael Chen',
      redactedByEmail: 'michael.chen@tpd.gov',
      intakeFormData: {
        fileName: 'Public_Records_Request.pdf',
        fileData: 'data:application/pdf;base64,demo',
        fileType: 'application/pdf'
      }
    },
    {
      id: '8',
      caseId: 'TPD-45828',
      requesterName: 'Linda Thompson',
      redactionStatus: 'Completed',
      dateCreated: 'Nov 30, 2025',
      isMarkedComplete: true,
      fileName: 'Case_File_45828.pdf',
      fileData: 'data:application/pdf;base64,JVBERi0xLjQKJeLjz9MNCjEgMCBvYmoKPDwvVHlwZS9DYXRhbG9nL1BhZ2VzIDIgMCBSPj4KZW5kb2JqCjIgMCBvYmoKPDwvVHlwZS9QYWdlcy9LaWRzWzMgMCBSXS9Db3VudCAxPj4KZW5kb2JqCjMgMCBvYmoKPDwvVHlwZS9QYWdlL01lZGlhQm94WzAgMCA2MTIgNzkyXS9QYXJlbnQgMiAwIFI+PgplbmRvYmoKeHJlZgowIDQKMDAwMDAwMDAwMCA2NTUzNSBmDQowMDAwMDAwMDEwIDAwMDAwIG4NCjAwMDAwMDAwNTMgMDAwMDAgbg0KMDAwMDAwMDEwMiAwMDAwMCBuDQp0cmFpbGVyCjw8L1NpemUgNC9Sb290IDEgMCBSPj4Kc3RhcnR4cmVmCjE2OAolJUVPRg==',
      fileType: 'application/pdf',
      redactedBy: 'Emily Rodriguez',
      redactedByEmail: 'emily.rodriguez@tpd.gov',
      intakeFormData: {
        fileName: 'Request_Form_Thompson.pdf',
        fileData: 'data:application/pdf;base64,demo',
        fileType: 'application/pdf'
      }
    },
    {
      id: '9',
      caseId: 'TPD-45829',
      requesterName: 'Kevin Anderson',
      redactionStatus: 'Completed',
      dateCreated: 'Nov 25, 2025',
      isMarkedComplete: true,
      fileName: 'Police_Report_45829.pdf',
      fileData: 'data:application/pdf;base64,JVBERi0xLjQKJeLjz9MNCjEgMCBvYmoKPDwvVHlwZS9DYXRhbG9nL1BhZ2VzIDIgMCBSPj4KZW5kb2JqCjIgMCBvYmoKPDwvVHlwZS9QYWdlcy9LaWRzWzMgMCBSXS9Db3VudCAxPj4KZW5kb2JqCjMgMCBvYmoKPDwvVHlwZS9QYWdlL01lZGlhQm94WzAgMCA2MTIgNzkyXS9QYXJlbnQgMiAwIFI+PgplbmRvYmoKeHJlZgowIDQKMDAwMDAwMDAwMCA2NTUzNSBmDQowMDAwMDAwMDEwIDAwMDAwIG4NCjAwMDAwMDAwNTMgMDAwMDAgbg0KMDAwMDAwMDEwMiAwMDAwMCBuDQp0cmFpbGVyCjw8L1NpemUgNC9Sb290IDEgMCBSPj4Kc3RhcnR4cmVmCjE2OAolJUVPRg==',
      fileType: 'application/pdf',
      redactedBy: 'John Davis',
      redactedByEmail: 'john.davis@tpd.gov',
      intakeFormData: {
        fileName: 'Intake_Anderson.pdf',
        fileData: 'data:application/pdf;base64,demo',
        fileType: 'application/pdf'
      }
    },
    {
      id: '10',
      caseId: 'TPD-45830',
      requesterName: 'Patricia Wilson',
      redactionStatus: 'Review Now',
      redactionStage: 'rules-review',
      dateCreated: 'Dec 4, 2025',
      redactedBy: 'Sarah Mitchell',
      redactedByEmail: 'sarah.mitchell@tpd.gov',
      intakeFormData: {
        fileName: 'Records_Request_Wilson.pdf',
        fileData: 'data:application/pdf;base64,demo',
        fileType: 'application/pdf'
      }
    }
  ]);

  const handleViewCase = async (caseId: string) => {
    const { data, error } = await getCaseById(caseId);
    if (error || !data) {
      console.error('Failed to load case:', error);
      return;
    }
    setSelectedCaseId(data.case_id);
    setSelectedCaseData(data);
    setIsNewCase(false);
    setCurrentStep('case-detail');
  };

  const handleUpdateCase = (updatedCase: any) => {
    setCases(cases.map(c => c.id === updatedCase.id ? updatedCase : c));
    setSelectedCaseId(updatedCase.id);
  };

  const handleAddCase = (newCase: any) => {
    setCases(prevCases => [...prevCases, newCase]);
  };

  const handleStartNewCase = () => {
    setIsNewCase(true);
    setSelectedCaseId(null);
    setIntakeFormData(null);
    setCurrentStep('intake-form');
  };

  const handleIntakeFormSubmit = (formData: IntakeFormData) => {
    setIntakeFormData(formData);
    setCurrentStep('case-detail');
  };

  const handleSignOut = async () => {
    setShowProfileDropdown(false);
    await logout();
    setCurrentStep('sign-in');
  };

  // Background processing for cases that are processing
  useEffect(() => {
    const currentProcessingCases = new Set(cases.filter(c => c.isProcessing === true).map(c => c.id));
    const previousProcessingCases = previousProcessingCasesRef.current;
    const activeTimers = activeTimersRef.current;

    const newlyProcessingCases = cases.filter(c =>
      c.isProcessing &&
      !previousProcessingCases.has(c.id)
    );

    newlyProcessingCases.forEach(caseData => {
      console.log(`Starting 30-second timer for case ${caseData.caseId}`);
      const timeout = setTimeout(() => {
        console.log(`Timer completed for case ${caseData.caseId}`);
        setCases(prevCases =>
          prevCases.map(c => {
            if (c.id === caseData.id && c.isProcessing) {
              const redactedFileData = c.fileData;
              return {
                ...c,
                isProcessing: false,
                redactionStatus: 'Review Now' as const,
                redactionStage: 'rules-review' as const,
                redactedFileData: redactedFileData,
                redactedFileName: c.fileName ? c.fileName.replace('_Unredacted', '_Redacted') : 'redacted_document.pdf'
              };
            }
            return c;
          })
        );
        activeTimers.delete(caseData.id);
      }, 30000);

      activeTimers.set(caseData.id, timeout);
    });

    previousProcessingCases.forEach(caseId => {
      if (!currentProcessingCases.has(caseId) && activeTimers.has(caseId)) {
        clearTimeout(activeTimers.get(caseId)!);
        activeTimers.delete(caseId);
      }
    });

    previousProcessingCasesRef.current = currentProcessingCases;
  }, [cases]);

  // Show a blank screen while Cognito session check is in progress to
  // avoid flashing the sign-in screen at already-authenticated users.
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Map a real ApiCase into the shape CaseDetailScreen expects
  const apiCaseToDetailShape = (apiCase: any) => {
    const statusMap: Record<string, 'upload' | 'analyzing' | 'rules-review' | 'processing' | 'complete'> = {
      CASE_CREATED:        'upload',
      INTAKE_UPLOADED:     'upload',
      UNREDACTED_UPLOADED: 'analyzing',
      PROCESSING:          'analyzing',
      REVIEW_READY:        'rules-review',
      REVIEWING:           'rules-review',
      APPLYING_REDACTIONS: 'processing',
      COMPLETED:           'complete',
      CLOSED:              'complete',
      FAILED:              'upload',
    };
    return {
      id:              apiCase.case_id,
      caseId:          apiCase.case_id,
      requesterName:   apiCase.requester_name ?? '',
      redactionStatus: mapBackendStatus(apiCase.status),
      dateCreated:     new Date(apiCase.created_at * 1000).toLocaleDateString('en-US', {
                         month: 'short', day: 'numeric', year: 'numeric'
                       }),
      redactionStage:  statusMap[apiCase.status] ?? 'upload',
      fileName:        apiCase.s3_paths?.unredacted_doc?.split('/').pop() ?? undefined,
      isMarkedComplete: apiCase.status === 'COMPLETED' || apiCase.status === 'CLOSED',
      intakeFormData:  apiCase.s3_paths?.intake_form
                         ? { fileName: 'Intake Form', s3Key: apiCase.s3_paths.intake_form }
                         : null,
    };
  };

  const renderStep = () => {
    switch (currentStep) {
      case 'sign-in':
        return <SignInScreen />;
      case 'dashboard':
        return (
          <DashboardScreen
            onStartNewCase={handleStartNewCase}
            onViewCase={handleViewCase}
            currentUserEmail={currentUser?.email ?? ''}
            currentOfficerId={currentUser?.sub ?? ''}
          />
        );
      case 'intake-form':
        return (
          <IntakeFormScreen
            onBack={() => {
              setCurrentStep('dashboard');
              setIsNewCase(false);
            }}
            onSubmit={handleIntakeFormSubmit}
          />
        );
      case 'case-detail':
        if (isNewCase) {
          const newCaseNumber = 45820 + cases.length + 1;
          const tempCase = {
            id: `temp-${Date.now()}`,
            caseId: intakeFormData?.caseNumber || `TPD-${newCaseNumber}`,
            requesterName: intakeFormData?.requesterName || 'New Requester',
            redactionStatus: 'Not Started' as const,
            dateCreated: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
            intakeFormData: intakeFormData
          };
          return (
            <CaseDetailScreen
              caseData={tempCase}
              onBack={() => {
                setCurrentStep('dashboard');
                setIsNewCase(false);
              }}
              onBackToIntakeForm={() => {
                setCurrentStep('intake-form');
              }}
              onUpdateCase={handleUpdateCase}
              onAddCase={handleAddCase}
              isNewCase={true}
            />
          );
        }

        const selectedCase = selectedCaseData ? apiCaseToDetailShape(selectedCaseData) : null;
        if (!selectedCase) {
          setCurrentStep('dashboard');
          return null;
        }
        return (
          <CaseDetailScreen
            caseData={selectedCase}
            onBack={() => setCurrentStep('dashboard')}
            onUpdateCase={handleUpdateCase}
            onAddCase={handleAddCase}
            isNewCase={false}
          />
        );
      case 'admin-dashboard':
        return (
          <AdminDashboard
            cases={cases}
            onUpdateCases={setCases}
            onUploadGuideline={() => setCurrentStep('upload-guideline')}
            newGuideline={savedGuidelineData}
            shouldActivateNewGuideline={shouldActivateGuideline}
          />
        );
      case 'upload-guideline':
        return (
          <UploadGuidelineScreen
            onBack={() => setCurrentStep('admin-dashboard')}
            onScanDocument={(file) => {
              setUploadedGuidelineFile(file);
              setUploadedGuidelineFileUrl(URL.createObjectURL(file));
              setCurrentStep('review-rules');
            }}
          />
        );
      case 'review-rules':
        const mockExtractedRules = [
          {
            id: '1',
            title: 'PII Rule #1',
            category: 'PII',
            ruleText: 'TPD Redaction Rule 1.1: All names of private citizens, witnesses, and victims must be redacted unless specifically authorized for public release.'
          },
          {
            id: '2',
            title: 'PII Rule #2',
            category: 'PII',
            ruleText: 'TPD Redaction Rule 1.2: Social security numbers, driver\'s license numbers, and other government-issued identification numbers must be completely redacted.'
          },
          {
            id: '3',
            title: 'Contact Rule #1',
            category: 'Addresses',
            ruleText: 'TPD Redaction Rule 2.1: Phone numbers, email addresses, and physical addresses of private citizens must be redacted unless part of public record.'
          },
          {
            id: '4',
            title: 'Address Rule #1',
            category: 'Addresses',
            ruleText: 'TPD Redaction Rule 4.1: Residential addresses of suspects, victims, and witnesses must be redacted unless part of public record.'
          },
          {
            id: '5',
            title: 'Address Rule #2',
            category: 'Addresses',
            ruleText: 'TPD Redaction Rule 4.2: Safe house locations and protected witness addresses must always be redacted.'
          },
          {
            id: '6',
            title: 'Name Rule #1',
            category: 'Names',
            ruleText: 'TPD Redaction Rule 1.3: Names of minors involved in any capacity must be redacted in all documents.'
          },
          {
            id: '7',
            title: 'Sensitive Info Rule #1',
            category: 'Sensitive Info',
            ruleText: 'TPD Redaction Rule 3.1: Medical information, financial records, and details of ongoing investigations must be protected.'
          },
          {
            id: '8',
            title: 'Sensitive Info Rule #2',
            category: 'Sensitive Info',
            ruleText: 'TPD Redaction Rule 3.2: Confidential informant information and undercover officer identities must be completely redacted.'
          }
        ];

        return (
          <ReviewExtractedRules
            fileName={uploadedGuidelineFile?.name || 'guideline-document.pdf'}
            extractedRules={mockExtractedRules}
            fileUrl={uploadedGuidelineFileUrl}
            onSaveGuideline={() => {
              setCurrentStep('guideline-saved');
              setUploadedGuidelineFile(null);
              setUploadedGuidelineFileUrl(null);
              setSavedGuidelineData({
                fileName: uploadedGuidelineFile?.name || 'guideline-document.pdf',
                fileSize: uploadedGuidelineFile ? `${uploadedGuidelineFile.size} bytes` : '0 bytes',
                uploadDate: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              });
            }}
            onBackToUpload={() => setCurrentStep('upload-guideline')}
          />
        );
      case 'guideline-saved':
        return (
          <GuidelineSavedConfirmation
            onSetAsActive={() => {
              setShouldActivateGuideline(true);
              setCurrentStep('admin-dashboard');
            }}
            onGoToDashboard={() => {
              setShouldActivateGuideline(false);
              setCurrentStep('admin-dashboard');
            }}
          />
        );
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <Toaster position="bottom-right" richColors />
      {currentStep !== 'sign-in' && (
        <header className="bg-slate-900 text-white py-4 px-8">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <h1 className="text-white">TPD Records Processing System</h1>

            {/* User Profile */}
            <div
              className="relative flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-700/50 transition-colors cursor-pointer"
              onMouseEnter={() => setShowProfileDropdown(true)}
              onMouseLeave={() => setShowProfileDropdown(false)}
            >
              <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center hover:bg-blue-700 transition-colors">
                <User className="w-5 h-5 text-white" />
              </div>
              <span className="text-slate-300">{currentUser?.name}</span>
              <ChevronDown className="w-4 h-4 text-slate-400" />
              {showProfileDropdown && (
                <div className="absolute right-0 top-[calc(100%+4px)] w-56 bg-white rounded-md shadow-lg z-10 py-1">
                  <div className="px-4 py-2 border-b border-slate-200">
                    <p className="text-slate-900 font-medium">{currentUser?.name}</p>
                    <p className="text-slate-500 text-sm">{currentUser?.email}</p>
                  </div>
                  <button
                    className="flex items-center px-4 py-2 text-red-600 hover:bg-slate-100 w-full text-left transition-colors"
                    onClick={handleSignOut}
                  >
                    <LogOut className="w-4 h-4 mr-2 text-red-600" />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
      )}
      {renderStep()}
    </div>
  );
}

// ─── Root export — wraps everything in AuthProvider ───────────────────────────

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}