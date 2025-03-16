/**
 * Client-side function to fetch documents for a user
 */
export async function getDocumentsClient(userId: string): Promise<{
  success: boolean;
  documents?: any[];
  error?: string;
}> {
  if (!userId) {
    return {
      success: false,
      error: 'User ID is required',
      documents: []
    };
  }
  
  try {
    // Fetch documents from API
    const response = await fetch(`/api/documents?userId=${userId}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `Failed to fetch documents (${response.status})`);
    }
    
    const data = await response.json();
    return {
      success: true,
      documents: data.documents || []
    };
  } catch (error) {
    console.error('Error fetching documents:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch documents',
      documents: []
    };
  }
}

/**
 * Client-side function to delete a document
 */
export async function deleteDocumentClient(documentId: string, userId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  if (!documentId || !userId) {
    return {
      success: false,
      error: 'Document ID and User ID are required'
    };
  }
  
  try {
    const response = await fetch(`/api/documents/${documentId}?userId=${userId}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `Failed to delete document (${response.status})`);
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error deleting document:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete document'
    };
  }
}

/**
 * Client-side function to upload a document
 */
export async function uploadDocumentClient(file: File, userId: string): Promise<{
  success: boolean;
  document?: any;
  error?: string;
}> {
  if (!file || !userId) {
    return {
      success: false,
      error: 'File and User ID are required'
    };
  }
  
  try {
    // Create form data
    const formData = new FormData();
    formData.append('file', file);
    formData.append('userId', userId);
    
    // Upload to API
    console.log(`Uploading document ${file.name} for user ${userId}...`);
    const response = await fetch('/api/documents/upload', {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const errorText = errorData?.error || await response.text();
      throw new Error(errorText || `Failed to upload document (${response.status})`);
    }
    
    const data = await response.json();
    
    // Ensure we have a valid document object
    if (!data.document || !data.document.id) {
      console.warn('Upload response is missing document data:', data);
      throw new Error('Invalid response from server: missing document data');
    }
    
    console.log(`Document uploaded successfully, id: ${data.document.id}`);
    return {
      success: true,
      document: data.document
    };
  } catch (error) {
    console.error('Error uploading document:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upload document'
    };
  }
}

/**
 * Client-side function to check document status
 */
export async function checkDocumentStatusClient(documentId: string): Promise<{
  success: boolean;
  status?: string;
  progress?: number;
  error?: string;
}> {
  if (!documentId) {
    return {
      success: false,
      error: 'Document ID is required'
    };
  }
  
  try {
    const response = await fetch(`/api/documents/status?id=${documentId}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `Failed to check document status (${response.status})`);
    }
    
    const data = await response.json();
    return {
      success: true,
      status: data.status,
      progress: data.progress,
      error: data.error
    };
  } catch (error) {
    console.error('Error checking document status:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to check document status'
    };
  }
} 