/* eslint-disable react-hooks/exhaustive-deps */
"use client";

import { useEffect, useState } from "react";
import { INITIAL_MESSAGE } from "@/configuration/chat";
import { WORD_CUTOFF, WORD_BREAK_MESSAGE } from "@/configuration/chat";
import type {
  LoadingIndicator,
  DisplayMessage,
  StreamedDone,
  StreamedLoading,
  StreamedMessage,
  Citation,
  StreamedError,
  UploadedDocument,
} from "@/types";

import { streamedDoneSchema, streamedMessageSchema, streamedLoadingSchema, streamedErrorSchema } from "@/types/streaming";
import { useAuth, type User } from "@/hooks/use-auth";
import { getDocumentsClient, uploadDocumentClient, deleteDocumentClient } from "@/actions/client-actions";

// In hooks/use-app.ts, modify the hook signature
export default function useApp(externalUser?: User) {
  // In the hook, use the external user if provided
  const authHook = useAuth();
  const user = externalUser || authHook.user;
  
  const initialAssistantMessage: DisplayMessage = {
    role: "assistant",
    content: INITIAL_MESSAGE,
    citations: [],
  };

  const [messages, setMessages] = useState<DisplayMessage[]>([
    initialAssistantMessage,
  ]);
  const [wordCount, setWordCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [indicatorState, setIndicatorState] = useState<LoadingIndicator[]>([]);
  const [input, setInput] = useState("");
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false);

  useEffect(() => {
    setWordCount(
      messages.reduce(
        (acc, message) => acc + message.content.split(" ").length,
        0
      )
    );
  }, [messages]);

  // Load documents when user changes
  useEffect(() => {
    if (user) {
      fetchDocuments();
    } else {
      setDocuments([]);
    }
  }, [user?.id]);

  const fetchDocuments = async () => {
    if (!user) return;
    
    try {
      setIsLoadingDocuments(true);
      // Use the client action to fetch documents
      const result = await getDocumentsClient(user.id);
      
      if (result.success) {
        setDocuments(result.documents || []);
      } else {
        console.error("Error fetching documents:", result.error);
      }
    } catch (error) {
      console.error("Error fetching documents:", error);
    } finally {
      setIsLoadingDocuments(false);
    }
  };

  const uploadDocument = async (file: File) => {
    if (!user) throw new Error("User must be logged in to upload documents");
    
    try {
      // Use the client action to upload document
      const result = await uploadDocumentClient(file, user.id);
      
      if (result.success && result.document) {
        // Add the new document to the list
        setDocuments(prev => [result.document, ...prev]);
        return result.document;
      } else {
        throw new Error(result.error || "Upload failed");
      }
    } catch (error) {
      console.error("Upload error:", error);
      throw error;
    }
  };

  const deleteDocument = async (id: string, force = false) => {
    if (!user) return;
    
    try {
      // Use the client action to delete document
      const result = await deleteDocumentClient(id, user.id);
      
      if (result.success) {
        // Remove the document from the list
        setDocuments(prev => prev.filter(doc => doc.id !== id));
      } else {
        throw new Error(result.error || "Delete failed");
      }
    } catch (error) {
      console.error("Delete error:", error);
      throw error;
    }
  };

  const addUserMessage = (content: string): DisplayMessage => {
    const newUserMessage: DisplayMessage = {
      role: "user",
      content,
      citations: [],
    };
    setMessages((prevMessages) => {
      const updatedMessages = [...prevMessages, newUserMessage];
      // Save immediately after adding user message
      if (user) {
        saveMessages(updatedMessages);
      }
      return updatedMessages;
    });
    return newUserMessage;
  };

  const addAssistantMessage = (content: string, citations: Citation[]) => {
    const newAssistantMessage: DisplayMessage = {
      role: "assistant",
      content,
      citations,
    };
    setMessages((prevMessages) => {
      const updatedMessages = [...prevMessages, newAssistantMessage];
      // Save immediately after adding assistant message
      if (user) {
        saveMessages(updatedMessages);
      }
      return updatedMessages;
    });
    return newAssistantMessage;
  };

  const fetchAssistantResponse = async (allMessages: DisplayMessage[]) => {
    try {
      // Get userId from the passed user parameter
      const userId = user?.id;
      
      if (!userId) {
        throw new Error("User not authenticated");
      }
  
      const response = await fetch("/api/chat", {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat: {
            messages: allMessages,
            userId, // Include the userId in the chat object
          },
        }),
      });
  
      if (!response.ok) {
        throw new Error(`Error: ${response.statusText}`);
      }
  
      // Don't parse JSON here - just return the response for streaming
      return response;
    } catch (error) {
      console.error('Error in fetchAssistantResponse:', error);
      throw error;
    }
  };

  const handleStreamedMessage = (streamedMessage: StreamedMessage) => {
    setIndicatorState([]);
    setMessages((prevMessages) => {
      const updatedMessages = [...prevMessages];
      const lastMessage = updatedMessages[updatedMessages.length - 1];

      if (lastMessage && lastMessage.role === "assistant") {
        // Update the existing assistant message
        updatedMessages[updatedMessages.length - 1] = {
          ...lastMessage,
          content: streamedMessage.message.content,
          citations: streamedMessage.message.citations,
        };
      } else {
        // Add a new assistant message
        updatedMessages.push({
          role: "assistant",
          content: streamedMessage.message.content,
          citations: streamedMessage.message.citations,
        });
      }

      return updatedMessages;
    });
  };

  const handleStreamedLoading = (streamedLoading: StreamedLoading) => {
    setIndicatorState((prevIndicatorState) => [
      ...prevIndicatorState,
      streamedLoading.indicator,
    ]);
  };

  const handleStreamedError = (streamedError: StreamedError) => {
    setIndicatorState((prevIndicatorState) => [
      ...prevIndicatorState,
      streamedError.indicator,
    ]);
  };

  const handleStreamedDone = (streamedDone: StreamedDone) => {};

  const routeResponseToProperHandler = (payload: string) => {
    const payloads = payload.split("\n").filter((p) => p.trim() !== "");

    if (payloads.length === 0) {
      return; // No non-empty payloads
    }

    for (const payload of payloads) {
      const parsedPayload = JSON.parse(payload);

      if (streamedMessageSchema.safeParse(parsedPayload).success) {
        handleStreamedMessage(parsedPayload as StreamedMessage);
      } else if (streamedLoadingSchema.safeParse(parsedPayload).success) {
        handleStreamedLoading(parsedPayload as StreamedLoading);
      } else if (streamedErrorSchema.safeParse(parsedPayload).success) {
        handleStreamedError(parsedPayload as StreamedError);
      } else if (streamedDoneSchema.safeParse(parsedPayload).success) {
        handleStreamedDone(parsedPayload as StreamedDone);
      } else {
        throw new Error("Invalid payload type");
      }
    }
  };

  const processStreamedResponse = async (response: Response) => {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No reader available");
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const payload = new TextDecoder().decode(value);
      routeResponseToProperHandler(payload);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIndicatorState([]);
    setIsLoading(true);
    setInput("");
    const newUserMessage = addUserMessage(input);
    if (wordCount > WORD_CUTOFF) {
      addAssistantMessage(WORD_BREAK_MESSAGE, []);
      setIsLoading(false);
    } else {
      setTimeout(() => {
        // NOTE: This is a hacky way to show the indicator state only after the user message is added.
        // TODO: Find a better way to do this.
        setIndicatorState([
          {
            status: "Understanding your message",
            icon: "understanding",
          },
        ]);
      }, 600);

      try {
        const response = await fetchAssistantResponse([
          ...messages,
          newUserMessage,
        ]);
        await processStreamedResponse(response);
      } catch (error) {
        console.error("Error:", error);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
  };

  useEffect(() => {
    if (!user) return;
    
    const storageKey = `chatMessages-${user.id}`;
    if (messages.length > 1) {
      localStorage.setItem(storageKey, JSON.stringify(messages));
    } else {
      localStorage.removeItem(storageKey);
    }
  }, [messages, user]);

  // Update the initial loading effect
  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    if (user) {
      // Always fetch fresh documents from API first
      fetchDocuments();
      
      // Then load any cached messages for this user
      const storageKey = `chatMessages-${user.id}`;
      const storedMessages = localStorage.getItem(storageKey);
      if (storedMessages) {
        setMessages(JSON.parse(storedMessages));
      } else {
        setMessages([initialAssistantMessage]);
      }
    } else {
      // Reset to initial state when logged out
      setMessages([initialAssistantMessage]);
      setDocuments([]);
    }
  }, [user?.id]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    if (user) {
      fetchMessages();
    } else {
      setMessages([initialAssistantMessage]);
    }
  }, [user?.id]);

  // Save messages to server with retry logic
  const saveMessages = async (messagesToSave: DisplayMessage[]) => {
    if (!user) return;
    
    const maxRetries = 3;
    let retryCount = 0;
    
    const attemptSave = async (): Promise<boolean> => {
      try {
        const response = await fetch('/api/chats', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ messages: messagesToSave }),
        });
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        // Also update localStorage as backup
        const storageKey = `chatMessages-${user.id}`;
        localStorage.setItem(storageKey, JSON.stringify(messagesToSave));
        
        return true;
      } catch (error) {
        console.error(`Error saving messages (attempt ${retryCount + 1}):`, error);
        return false;
      }
    };
    
    while (retryCount < maxRetries) {
      const success = await attemptSave();
      if (success) return;
      
      retryCount++;
      if (retryCount < maxRetries) {
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
      }
    }
    
    // If all retries failed, save to localStorage as fallback
    const storageKey = `chatMessages-${user.id}`;
    localStorage.setItem(storageKey, JSON.stringify(messagesToSave));
  };

  // Remove the debounced save effect since we're saving immediately
  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    // Save when component unmounts
    return () => {
      if (user && messages.length > 1) {
        // Use a synchronous localStorage save on unmount as backup
        const storageKey = `chatMessages-${user.id}`;
        localStorage.setItem(storageKey, JSON.stringify(messages));
        
        // Attempt server save, but don't wait for it
        saveMessages(messages);
      }
    };
  }, [messages, user]);

  const clearMessages = async () => {
    setMessages([initialAssistantMessage]);
    
    if (user) {
      try {
        await fetch('/api/chats', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ messages: [initialAssistantMessage] }),
        });
      } catch (error) {
        console.error("Error clearing messages on server:", error);
      }
    }
    
    setWordCount(0);
  };

  // Load messages from server
  const fetchMessages = async () => {
    if (!user) return;
    
    try {
      const response = await fetch('/api/chats');
      if (response.ok) {
        const data = await response.json();
        if (data.messages && data.messages.length > 0) {
          setMessages(data.messages);
        } else {
          setMessages([initialAssistantMessage]);
        }
      } else if (response.status !== 404) {
        throw new Error(`Error: ${response.statusText}`);
      }
    } catch (error) {
      console.error("Error fetching messages:", error);
      // Fallback to localStorage if server request fails
      const storageKey = `chatMessages-${user.id}`;
      const storedMessages = localStorage.getItem(storageKey);
      if (storedMessages) {
        setMessages(JSON.parse(storedMessages));
      }
    }
  };

  return {
    messages,
    handleInputChange,
    handleSubmit,
    indicatorState,
    input,
    isLoading,
    setMessages,
    clearMessages,
    documents,
    uploadDocument,
    deleteDocument,
  };
}
