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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        fileName: file.name,
        contentType: file.type 
      })
    });
    
    if (!signedUrlResponse.ok) {
      const errorText = await signedUrlResponse.text();
      throw new Error(`Failed to get upload URL: ${errorText}`);
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