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
 * Client-side function to upload a document using direct-to-storage upload
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
    // Step 1: Get a signed URL from the server
    console.log(`Getting signed URL for ${file.name}...`);
    const signedUrlResponse = await fetch('/api/documents/signed-url', {
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
    
    const { signedUrl, filePath } = await signedUrlResponse.json();
    
    // Step 2: Upload directly to Supabase Storage
    console.log(`Uploading file directly to storage: ${filePath}`);
    const uploadResponse = await fetch(signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file
    });
    
    if (!uploadResponse.ok) {
      throw new Error(`Storage upload failed: ${uploadResponse.status}`);
    }
    
    // Step 3: Trigger server-side processing of the uploaded file
    console.log(`Triggering processing for ${filePath}`);
    const processResponse = await fetch('/api/documents/process-uploaded', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath })
    });
    
    if (!processResponse.ok) {
      const errorText = await processResponse.text();
      throw new Error(`Processing failed: ${errorText}`);
    }
    
    const result = await processResponse.json();
    console.log(`Document processed successfully, id: ${result.document?.id}`);
    
    return {
      success: true,
      document: result.document
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