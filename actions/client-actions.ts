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
    console.log(`Preparing to upload ${file.name} (${Math.round(file.size / 1024 / 1024)}MB) for user ${userId}`);
    
    // Step 1: Get a signed URL from our server
    const formData = new FormData();
    formData.append('fileName', file.name);
    formData.append('fileType', file.type);
    formData.append('userId', userId);
    
    const signedUrlResponse = await fetch('/api/documents/signed-url', {
      method: 'POST',
      body: formData,
    });
    
    if (!signedUrlResponse.ok) {
      const errorText = await signedUrlResponse.text().catch(() => `Failed to get signed URL (${signedUrlResponse.status})`);
      console.error(`Error getting signed URL (${signedUrlResponse.status}):`, errorText);
      throw new Error(errorText || `Failed to get signed URL (${signedUrlResponse.status})`);
    }
    
    const { signedUrl, filePath } = await signedUrlResponse.json();
    
    if (!signedUrl) {
      throw new Error('Failed to get signed URL for upload');
    }
    
    // Step 2: Upload directly to Supabase Storage using the signed URL
    console.log(`Uploading file directly to storage at path: ${filePath}`);
    const uploadResponse = await fetch(signedUrl, {
      method: 'PUT',
      body: file,
      headers: {
        'Content-Type': file.type,
        'Cache-Control': 'max-age=31536000'
      }
    });
    
    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text().catch(() => `Failed to upload to storage (${uploadResponse.status})`);
      throw new Error(errorText || `Failed to upload to storage (${uploadResponse.status})`);
    }
    
    // Step 3: Notify our server to process the uploaded file
    console.log(`File uploaded successfully, notifying server to process file at: ${filePath}`);
    const processResponse = await fetch('/api/documents/process-uploaded', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filePath,
        userId
      }),
    });
    
    if (!processResponse.ok) {
      const errorText = await processResponse.text().catch(() => `Failed to process document (${processResponse.status})`);
      console.error(`Error processing document (${processResponse.status}):`, errorText);
      throw new Error(errorText || `Failed to process document (${processResponse.status})`);
    }
    
    const data = await processResponse.json();
    
    // Ensure we have a valid document object
    if (!data.success || !data.document || !data.document.id) {
      console.warn('Processing response is missing document data:', data);
      throw new Error('Invalid response from server: missing document data');
    }
    
    console.log(`Document uploaded and processing started, id: ${data.document.id}`);
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