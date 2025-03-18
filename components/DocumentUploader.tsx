import { useState, useRef } from 'react';
import { uploadDocumentClient } from '@/actions/client-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface DocumentUploaderProps {
  userId: string;
  onUploadSuccess?: (document: any) => void;
  onUploadError?: (error: string) => void;
  className?: string;
}

export function DocumentUploader({ 
  userId, 
  onUploadSuccess, 
  onUploadError,
  className 
}: DocumentUploaderProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFileName(file.name);
    } else {
      setFileName(null);
    }
  };

  const handleUpload = async () => {
    const file = fileInputRef.current?.files?.[0];
    
    if (!file) {
      onUploadError?.('Please select a file to upload');
      return;
    }

    if (!userId) {
      onUploadError?.('User ID is required');
      return;
    }

    try {
      setIsUploading(true);
      setStatusMessage(null);
      
      // Show message for large files using direct upload
      if (file.size > 4 * 1024 * 1024) {
        setStatusMessage(`Using direct upload for large file (${Math.round(file.size/1024/1024)}MB)`);
      }
      
      // Prevent the event from bubbling up to prevent Next.js hot reload
      const result = await uploadDocumentClient(file, userId);
      
      if (result.success && result.document) {
        console.log('Upload successful:', result.document);
        setFileName(null);
        setStatusMessage(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        onUploadSuccess?.(result.document);
      } else {
        console.error('Upload failed:', result.error);
        onUploadError?.(result.error || 'Upload failed');
      }
    } catch (error) {
      console.error('Upload error:', error);
      
      // Handle payload too large errors
      if (error instanceof Error && 
          (error.message.includes('413') || 
           error.message.toLowerCase().includes('payload too large'))) {
        setStatusMessage('File is too large for standard upload. Retrying with direct upload...');
        
        // Wait a moment and retry
        setTimeout(() => {
          setStatusMessage(null);
          handleUpload();
        }, 2000);
        return;
      }
      
      onUploadError?.(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className={cn("flex flex-col space-y-4", className)}>
      <div className="flex gap-2 max-w-full">
        <Input
          ref={fileInputRef}
          type="file"
          onChange={handleFileChange}
          className="flex-1 min-w-0"
          accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          disabled={isUploading}
        />
        <Button 
          onClick={handleUpload} 
          disabled={!fileName || isUploading}
          className="whitespace-nowrap flex-shrink-0"
        >
          {isUploading ? 'Uploading...' : 'Upload Document'}
        </Button>
      </div>
      
      {fileName && (
        <div className="text-sm text-muted-foreground truncate">
          Selected file: {fileName}
        </div>
      )}
      
      {statusMessage && (
        <div className="text-sm text-primary">
          {statusMessage}
        </div>
      )}
    </div>
  );
} 