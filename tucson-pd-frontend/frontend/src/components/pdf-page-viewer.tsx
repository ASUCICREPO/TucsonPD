import { useState, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { FileText, Loader2 } from 'lucide-react';


// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

interface PDFPageViewerProps {
  fileUrl: string | null;
  fileName?: string;
}

export function PDFPageViewer({ fileUrl, fileName }: PDFPageViewerProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  if (!fileUrl) {
    return (
      <div className="bg-slate-100 rounded-lg border-2 border-slate-300 p-12 flex flex-col items-center justify-center">
        <FileText className="w-16 h-16 text-slate-400 mb-4" />
        <p className="text-slate-600">No document to preview</p>
      </div>
    );
  }

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages);
    setLoading(false);
  }

  function onDocumentLoadError(error: Error) {
    console.error('Error loading PDF:', error);
    setLoading(false);
  }

  return (
    <div className="space-y-4">
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          <span className="ml-3 text-slate-600">Loading document...</span>
        </div>
      )}
      
      <Document
        file={fileUrl}
        onLoadSuccess={onDocumentLoadSuccess}
        onLoadError={onDocumentLoadError}
        loading={null}
      >
        {numPages && Array.from(new Array(numPages), (el, index) => (
          <div key={`page_${index + 1}`} className="mb-4">
            <div className="bg-slate-100 rounded-lg border-2 border-slate-300 overflow-hidden">
              {/* Page number indicator */}
              <div className="bg-slate-200 px-4 py-2 flex items-center justify-between border-b border-slate-300">
                <span className="text-slate-700">Page {index + 1} of {numPages}</span>
                <FileText className="w-4 h-4 text-slate-600" />
              </div>
              
              {/* PDF Page */}
              <div className="flex justify-center bg-white p-4">
                <Page
                  pageNumber={index + 1}
                  width={500}
                  renderTextLayer={true}
                  renderAnnotationLayer={true}
                />
              </div>
            </div>
          </div>
        ))}
      </Document>

      {/* File info footer */}
      {numPages && (
        <div className="pt-2 flex items-center justify-between text-slate-600">
          <span>{fileName || 'Document'}</span>
          <span>{numPages} {numPages === 1 ? 'page' : 'pages'} total</span>
        </div>
      )}
    </div>
  );
}