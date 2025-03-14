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
import { useAuth } from "@/hooks/use-auth";

export default function useApp() {
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
  const { user } = useAuth();

  useEffect(() => {
    setWordCount(
      messages.reduce(
        (acc, message) => acc + message.content.split(" ").length,
        0
      )
    );
  }, [messages]);

  useEffect(() => {
    // Load messages from local storage when component mounts
    const storedMessages = localStorage.getItem("chatMessages");
    if (storedMessages) {
      setMessages(JSON.parse(storedMessages));
    }
    
    // Load documents from local storage
    const storedDocuments = localStorage.getItem("uploadedDocuments");
    if (storedDocuments) {
      setDocuments(JSON.parse(storedDocuments));
    } else {
      // Fetch documents from API
      fetchDocuments();
    }
  }, []);

  useEffect(() => {
    // Save messages to local storage whenever they change
    if (messages.length > 1) {
      localStorage.setItem("chatMessages", JSON.stringify(messages));
    } else {
      localStorage.removeItem("chatMessages");
    }
  }, [messages]);

  useEffect(() => {
    // Save documents to local storage whenever they change
    if (documents.length > 0) {
      localStorage.setItem("uploadedDocuments", JSON.stringify(documents));
    } else {
      localStorage.removeItem("uploadedDocuments");
    }
  }, [documents]);

  const fetchDocuments = async () => {
    if (!user) {
      setDocuments([]);
      return;
    }
    
    try {
      const response = await fetch("/api/documents");
      if (response.ok) {
        const data = await response.json();
        setDocuments(data.documents);
      }
    } catch (error) {
      console.error("Failed to fetch documents:", error);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    fetchDocuments();
  }, [user]);

  // Inside useApp hook
  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
    useEffect(() => {
    // Refetch documents when auth state changes
    if (user) {
      fetchDocuments();
    } else {
      // Clear documents when logged out
      setDocuments([]);
    }
  }, [user?.id]); // Depend on user.id instead of the whole user object

  const uploadDocument = async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    
    try {
      const response = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData,
      });
      
      if (response.ok) {
        const data = await response.json();
        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
        setDocuments((prev: any) => [...prev, data.document]);
        return data.document;
      // biome-ignore lint/style/noUselessElse: <explanation>
      } else {
        throw new Error("Upload failed");
      }
    } catch (error) {
      console.error("Upload error:", error);
      throw error;
    }
  };

  // In your useApp hook
  const deleteDocument = async (id: string, force = false) => {
    try {
      const response = await fetch(`/api/documents/${id}${force ? '?force=true' : ''}`, {
        method: 'DELETE',
      });
      
      if (response.status === 401) {
        // User not authenticated, trigger login modal or redirect
        return false;
      }
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete document');
      }
      
      // Refresh document list after successful deletion
      await fetchDocuments();
      return true;
    } catch (error) {
      console.error("Failed to delete document:", error);
      throw error;
    }
  };

  const addUserMessage = (input: string) => {
    const newUserMessage: DisplayMessage = {
      role: "user",
      content: input,
      citations: [],
    };
    setMessages((prevMessages) => [...prevMessages, newUserMessage]);
    return newUserMessage;
  };

  const addAssistantMessage = (content: string, citations: Citation[]) => {
    const newAssistantMessage: DisplayMessage = {
      role: "assistant",
      content,
      citations,
    };
    setMessages((prevMessages) => [...prevMessages, newAssistantMessage]);
    return newAssistantMessage;
  };

  const fetchAssistantResponse = async (allMessages: DisplayMessage[]) => {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ chat: { messages: allMessages } }),
    });

    if (!response.ok) {
      throw new Error("Failed to send message");
    }

    return response;
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
    // Load messages from local storage when component mounts
    const storedMessages = localStorage.getItem("chatMessages");
    if (storedMessages) {
      setMessages(JSON.parse(storedMessages));
    }
  }, []);

  // useEffect(() => {
  //   // Save messages to local storage whenever they change
  //   if (messages.length > 1) {
  //     localStorage.setItem("chatMessages", JSON.stringify(messages));
  //   } else {
  //     localStorage.removeItem("chatMessages");
  //   }
  // }, [messages]);

  const clearMessages = () => {
    setMessages([]);
    setWordCount(0);
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
