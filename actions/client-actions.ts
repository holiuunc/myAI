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
    // Fetch documents from API with better URL construction
    console.log(`Fetching documents for user ${userId}`);
    const response = await fetch(`/api/documents?userId=${encodeURIComponent(userId)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Error response (${response.status}):`, errorText);
      throw new Error(errorText || `Failed to fetch documents (${response.status})`);
    }
    
    const data = await response.json();
    console.log(`Successfully fetched ${data.documents?.length || 0} documents`);
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
    console.log(`Deleting document ${documentId} for user ${userId}`);
    const response = await fetch(`/api/documents/${documentId}?userId=${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers: {
        'Cache-Control': 'no-cache'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Error response (${response.status}):`, errorText);
      try {
        const errorJson = JSON.parse(errorText);
        throw new Error(errorJson.error || `Failed to delete document (${response.status})`);
      } catch (e) {
        throw new Error(errorText || `Failed to delete document (${response.status})`);
      }
    }
    
    const data = await response.json();
    console.log('Deletion successful:', data);
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
      body: formData,
      // Don't set Content-Type for FormData
      headers: {
        'Accept': 'application/json',
        'Cache-Control': 'no-cache',
      },
    });
    
    if (!response.ok) {
      // First clone the response before reading it to avoid the stream already read error
      const errorText = await response.text().catch(() => `Failed to upload document (${response.status})`);
      console.error(`Error response (${response.status}):`, errorText);
      try {
        // Try to parse as JSON if possible
        const errorData = JSON.parse(errorText);
        throw new Error(errorData.error || `Failed to upload document (${response.status})`);
      } catch (e) {
        // If parsing fails, just use the text
        throw new Error(errorText || `Failed to upload document (${response.status})`);
      }
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