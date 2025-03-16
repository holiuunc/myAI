import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { AlertCircle, FileText, Upload } from 'lucide-react';
import { uploadDocumentClient } from '@/actions/client-actions';
import { MAX_FILE_SIZE_MB, ALLOWED_FILE_TYPES } from '@/configuration/documents';

interface DocumentUploadProps {
  userId: string;
  onUploadComplete?: (document: any) => void;
}

export function DocumentUpload({ userId, onUploadComplete }: DocumentUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Check file type
    if (!ALLOWED_FILE_TYPES.includes(file.type)) {
      setError('File type not supported. Please upload PDF, DOCX, or text files.');
      return;
    }
    
    // Check file size
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setError(`File exceeds maximum size of ${MAX_FILE_SIZE_MB}MB`);
      return;
    }
    
    setIsUploading(true);
    setError(null);
    
    // Upload the file
    try {
      // Simulate progress while uploading
      // This gives immediate feedback to the user
      const progressInterval = setInterval(() => {
        setProgress(prev => {
          const newProgress = prev + 5;
          if (newProgress >= 90) {
            clearInterval(progressInterval);
            return 90; // Cap at 90% until complete
          }
          return newProgress;
        });
      }, 300);
      
      const result = await uploadDocumentClient(file, userId);
      
      clearInterval(progressInterval);
      
      if (result.success && result.document) {
        setProgress(100);
        if (onUploadComplete) {
          onUploadComplete(result.document);
        }
      } else {
        throw new Error(result.error || 'Upload failed');
      }
    } catch (err) {
      console.error('Upload error:', err);
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
      
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };
  
  return (
    <div className="space-y-4">
      <div className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${isUploading ? 'border-primary bg-primary/5' : 'border-gray-300 hover:border-primary/50'}`}>
        <input
          type="file"
          id="document-upload"
          className="hidden"
          onChange={handleFileChange}
          accept=".pdf,.docx,.txt,.md"
          disabled={isUploading}
          ref={fileInputRef}
        />
        <label
          htmlFor="document-upload"
          className={`flex flex-col items-center ${isUploading ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}
        >
          {isUploading ? (
            <FileText className="h-10 w-10 text-primary mb-2" />
          ) : (
            <Upload className="h-10 w-10 text-gray-400 mb-2" />
          )}
          <span className="text-sm font-medium">
            {isUploading ? 'Uploading...' : 'Click to upload PDF, DOCX, or text files'}
          </span>
          <span className="text-xs text-gray-500 mt-1">
            Max file size: {MAX_FILE_SIZE_MB}MB
          </span>
        </label>
      </div>
      
      {isUploading && (
        <div className="space-y-2">
          <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
            <div 
              className="bg-primary h-2.5 rounded-full" 
              style={{ width: `${progress}%` }}
            ></div>
          </div>
          <p className="text-xs text-gray-500 text-center">
            {progress < 100 
              ? `Processing document... ${progress}%` 
              : 'Upload complete!'}
          </p>
          <p className="text-xs text-gray-500 text-center italic">
            Your document will continue processing in the background after the upload is complete.
          </p>
        </div>
      )}
      
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded flex items-center text-red-700 text-sm">
          <AlertCircle className="h-4 w-4 mr-2 flex-shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
} 