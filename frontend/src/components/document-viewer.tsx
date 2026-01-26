import { FileText, Image as ImageIcon, AlertCircle } from 'lucide-react';

interface DocumentViewerProps {
  fileUrl: string | null;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
}

export function DocumentViewer({ fileUrl, fileName, fileType, fileSize }: DocumentViewerProps) {
  // Determine if the file is a PDF or an image
  const isPDF = fileType?.includes('pdf') || fileName?.endsWith('.pdf');
  const isImage = fileType?.includes('image') || /\.(jpg|jpeg|png|tiff)$/i.test(fileName || '');

  if (!fileUrl) {
    // Placeholder when no file is available
    return (
      <div className="bg-slate-100 rounded-lg border-2 border-slate-300 aspect-[8.5/11] flex flex-col items-center justify-center p-8">
        <div className="w-20 h-20 bg-white rounded-lg shadow-sm flex items-center justify-center mb-4">
          <FileText className="w-10 h-10 text-slate-400" />
        </div>
        <p className="text-slate-600 text-center mb-2">Document Preview</p>
        {fileName && (
          <>
            <p className="text-slate-500 text-center">{fileName}</p>
            {fileSize && (
              <p className="text-slate-400 mt-4">
                {(fileSize / 1024 / 1024).toFixed(2)} MB
              </p>
            )}
          </>
        )}
        <p className="text-slate-500 text-center mt-4">
          Preview not available (mock data)
        </p>
      </div>
    );
  }

  return (
    <div className="bg-slate-100 rounded-lg border-2 border-slate-300 overflow-hidden aspect-[8.5/11] relative">
      {isPDF ? (
        <iframe
          src={fileUrl}
          className="w-full h-full"
          title="PDF Preview"
        />
      ) : isImage ? (
        <img
          src={fileUrl}
          alt="Document Preview"
          className="w-full h-full object-contain"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center p-8">
          <AlertCircle className="w-10 h-10 text-amber-500 mb-4" />
          <p className="text-slate-600 text-center">
            Preview not available for this file type
          </p>
          {fileName && (
            <p className="text-slate-500 text-center mt-2">{fileName}</p>
          )}
        </div>
      )}
    </div>
  );
}
