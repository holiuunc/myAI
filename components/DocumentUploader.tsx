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
      
      // Prevent the event from bubbling up to prevent Next.js hot reload
      const result = await uploadDocumentClient(file, userId);
      
      if (result.success && result.document) {
        console.log('Upload successful:', result.document);
        setFileName(null);
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
      onUploadError?.(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className={cn("flex flex-col space-y-4", className)}>
      <div className="flex gap-2">
        <Input
          ref={fileInputRef}
          type="file"
          onChange={handleFileChange}
          className="flex-1"
          accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          disabled={isUploading}
        />
        <Button 
          onClick={handleUpload} 
          disabled={!fileName || isUploading}
          className="whitespace-nowrap"
        >
          {isUploading ? 'Uploading...' : 'Upload Document'}
        </Button>
      </div>
      
      {fileName && (
        <div className="text-sm text-gray-500">
          Selected file: {fileName}
        </div>
      )}
    </div>
  );
} 