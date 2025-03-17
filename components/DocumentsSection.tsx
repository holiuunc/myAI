/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect, useRef } from 'react';
import { getDocumentsClient, deleteDocumentClient } from '../actions/client-actions';
import { DocumentUpload } from './DocumentUpload';
import { Button } from '../components/ui/button';
import { Trash2, FileText, RefreshCw, AlertCircle } from 'lucide-react';
import { Progress } from '../components/ui/progress';

interface DocumentsSectionProps {
  userId: string;
}

// Document statuses for display
const STATUS_LABELS = {
  pending: 'Queued',
  processing: 'Processing',
  complete: 'Complete',
  error: 'Error'
};

export function DocumentsSection({ userId }: DocumentsSectionProps) {
  const [documents, setDocuments] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollingInterval = useRef<NodeJS.Timeout | null>(null);
  
  const loadDocuments = async () => {
    try {
      setIsLoading(true);
      setError(null);
      console.log('Loading documents for user:', userId);
      const result = await getDocumentsClient(userId);
      
      if (result.success) {
        setDocuments(result.documents || []);
      } else {
        throw new Error(result.error || 'Failed to load documents');
      }
    } catch (err) {
      console.error('Error loading documents:', err);
      setError(err instanceof Error ? err.message : 'Failed to load documents');
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleDeleteDocument = async (documentId: string) => {
    if (!confirm('Are you sure you want to delete this document?')) {
      return;
    }
    
    try {
      console.log('Deleting document:', documentId);
      const result = await deleteDocumentClient(documentId, userId);
      
      if (result.success) {
        // Refresh the documents list
        loadDocuments();
      } else {
        throw new Error(result.error || 'Failed to delete document');
      }
    } catch (err) {
      console.error('Error deleting document:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete document');
    }
  };
  
  const handleUploadComplete = (document: any) => {
    // Add the new document to the list without reloading
    if (document && document.id) {
      console.log("Adding new document to list:", document);
      // Update with the newly uploaded document at the beginning of the list
      setDocuments(prevDocs => {
        // Check if document already exists to avoid duplicates
        if (prevDocs.some(doc => doc.id === document.id)) {
          return prevDocs;
        }
        return [document, ...prevDocs];
      });
    } else {
      console.warn("Received invalid document data:", document);
      // Fall back to loading all documents
      loadDocuments();
    }
  };
  
  // Setup polling to refresh documents with pending status
  useEffect(() => {
    // Check if we need to poll (any documents with pending/processing status)
    const needPolling = documents.some(doc => 
      doc.status === 'pending' || doc.status === 'processing');
    
    // Clear existing interval if it exists
    if (pollingInterval.current) {
      clearInterval(pollingInterval.current);
      pollingInterval.current = null;
    }
    
    // Set up new polling if needed
    if (needPolling) {
      pollingInterval.current = setInterval(() => {
        loadDocuments();
      }, 5000); // Poll every 5 seconds
    }
    
    // Clean up on unmount
    return () => {
      if (pollingInterval.current) {
        clearInterval(pollingInterval.current);
      }
    };
  }, [documents]);
  
  // Initial load
  useEffect(() => {
    if (userId) {
      loadDocuments();
    }
    
    // Clean up on unmount
    return () => {
      if (pollingInterval.current) {
        clearInterval(pollingInterval.current);
      }
    };
  }, [userId]);
  
  function getStatusColor(status: string): string {
    switch (status) {
      case 'pending':
        return 'text-blue-500 bg-blue-50 border-blue-200';
      case 'processing':
        return 'text-yellow-500 bg-yellow-50 border-yellow-200';
      case 'complete':
        return 'text-green-500 bg-green-50 border-green-200';
      case 'error':
        return 'text-red-500 bg-red-50 border-red-200';
      default:
        return 'text-gray-500 bg-gray-50 border-gray-200';
    }
  }
  
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <h2 className="text-xl font-semibold">Your Documents</h2>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={loadDocuments}
          disabled={isLoading}
          className="self-start sm:ml-auto"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>
      
      <DocumentUpload userId={userId} onUploadComplete={handleUploadComplete} />
      
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {error}
        </div>
      )}
      
      <div className="space-y-2">
        {documents.length === 0 && !isLoading ? (
          <p className="text-gray-500 text-sm">No documents uploaded yet.</p>
        ) : (
          <ul className="divide-y">
            {documents.map((doc) => (
              <li key={doc.id} className="py-3 flex items-center">
                <div className="flex items-center flex-grow min-w-0 mr-4">
                  <FileText className="h-5 w-5 text-gray-400 mr-3 flex-shrink-0" />
                  <div className="flex-grow min-w-0">
                    <p className="font-medium truncate" title={doc.title}>
                      {doc.title}
                    </p>
                    <div className="flex items-center text-xs text-gray-500">
                      <span className="truncate">{new Date(doc.created_at).toLocaleString()}</span>
                      
                      {doc.status && (
                        <span className={`ml-2 px-2 py-0.5 rounded-full text-xs flex-shrink-0 ${getStatusColor(doc.status)}`}>
                          {STATUS_LABELS[doc.status as keyof typeof STATUS_LABELS] || doc.status}
                        </span>
                      )}
                    </div>
                    
                    {(doc.status === 'pending' || doc.status === 'processing') && typeof doc.progress === 'number' && (
                      <div className="mt-2">
                        <Progress value={doc.progress} className="h-1 w-full" />
                        <p className="mt-1 text-xs text-gray-500">
                          {doc.progress}% complete
                        </p>
                      </div>
                    )}
                    
                    {doc.status === 'error' && (
                      <div className="mt-1 flex items-center text-xs text-red-500">
                        <AlertCircle className="h-3 w-3 mr-1" />
                        {doc.error_message || 'Processing failed'}
                      </div>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDeleteDocument(doc.id)}
                  title="Delete document"
                  className="flex-shrink-0"
                >
                  <Trash2 className="h-4 w-4 text-gray-500 hover:text-red-500" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
} 