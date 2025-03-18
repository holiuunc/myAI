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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setError(null);
    
    if (!file) {
      setSelectedFile(null);
      return;
    }
    
    // Check file type
    if (!ALLOWED_FILE_TYPES.includes(file.type)) {
      setError('File type not supported. Please upload PDF, DOCX, or text files.');
      setSelectedFile(null);
      return;
    }
    
    // Check file size
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setError(`File exceeds maximum size of ${MAX_FILE_SIZE_MB}MB`);
      setSelectedFile(null);
      return;
    }
    
    // Store the file for later upload
    setSelectedFile(file);
  };
  
  const handleUpload = async () => {
    if (!selectedFile) {
      setError('Please select a file to upload');
      return;
    }
    
    if (!userId) {
      setError('User ID is required');
      return;
    }
    
    setIsUploading(true);
    setError(null);
    
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
    
    try {
      // Determine if we should use direct upload based on file size
      // Files larger than 4MB will use direct upload to avoid Vercel limits
      const useDirectUpload = selectedFile.size > 4 * 1024 * 1024;
      
      if (useDirectUpload) {
        console.log(`Using direct upload for large file (${Math.round(selectedFile.size/1024/1024)}MB)`);
      }
      
      const result = await uploadDocumentClient(selectedFile, userId);
      
      clearInterval(progressInterval);
      
      if (result.success && result.document) {
        setProgress(100);
        setTimeout(() => {
          // Add a small delay before calling onUploadComplete to ensure state updates
          if (onUploadComplete) {
            console.log("Upload complete, document data:", result.document);
            onUploadComplete(result.document);
          }
        }, 300);
      } else {
        throw new Error(result.error || 'Upload failed');
      }
    } catch (err) {
      console.error('Upload error:', err);
      clearInterval(progressInterval);
      
      // Handle specific error for payload too large
      if (err instanceof Error && 
          (err.message.includes('413') || 
           err.message.toLowerCase().includes('payload too large'))) {
        setError('File is too large for standard upload. The system will automatically use direct upload.');
        
        // Wait a moment and retry with direct upload
        setTimeout(() => {
          setError(null);
          setProgress(0);
          handleUpload();
        }, 3000);
        return;
      }
      
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
      
      // Reset selected file
      setSelectedFile(null);
      
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      
      // Reset progress after a delay
      setTimeout(() => {
        setProgress(0);
      }, 2000);
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
            {isUploading ? 'Uploading...' : 'Click to select PDF, DOCX, or text files'}
          </span>
          <span className="text-xs text-gray-500 mt-1">
            Max file size: {MAX_FILE_SIZE_MB}MB
          </span>
        </label>
      </div>
      
      {selectedFile && !isUploading && (
        <div className="flex items-center justify-between bg-muted p-3 rounded-md max-w-full overflow-hidden">
          <div className="flex items-center overflow-hidden">
            <FileText className="h-5 w-5 text-muted-foreground flex-shrink-0 mr-2" />
            <span className="text-sm truncate text-foreground">{selectedFile.name}</span>
          </div>
          <Button onClick={handleUpload} size="sm" className="flex-shrink-0 ml-2">
            Upload File
          </Button>
        </div>
      )}
      
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