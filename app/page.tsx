"use client";

import { useState, useEffect } from "react";
import ChatInput from "@/components/chat/input";
import ChatMessages from "@/components/chat/messages";
import useApp from "@/hooks/use-app";
import ChatHeader from "@/components/chat/header";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { DocumentsSection } from "@/components/DocumentsSection";
import { useAuth } from "@/hooks/use-auth";
import { LoginModal } from "@/components/auth/login-modal";
import { Button } from "@/components/ui/button";

export default function Chat() {
  const { user, logout } = useAuth();
  const {
    messages,
    handleInputChange,
    handleSubmit,
    input,
    isLoading,
    indicatorState,
    clearMessages,
  } = useApp(user || undefined); // We don't need documents, uploadDocument, deleteDocument anymore

  const [loginModalOpen, setLoginModalOpen] = useState(false);

  // Add this console log
  // console.log("Rendering Chat component, user state:", user);

  return (
    <>
      <ChatHeader 
        clearMessages={clearMessages} 
        user={user as any}
        onLoginClick={() => setLoginModalOpen(true)}
        onLogoutClick={logout}
      />
      <div className="flex justify-center items-center h-screen pt-16 pb-24">
        <div className="flex flex-col max-w-screen-xl w-full h-full">
          <ResizablePanelGroup direction="horizontal" className="h-full">
            <ResizablePanel defaultSize={75} minSize={50}>
              <div className="p-5 h-full overflow-auto relative">
                <div className={`h-full ${!user ? 'blur-sm pointer-events-none' : ''}`}>
                  <ChatMessages messages={messages} indicatorState={indicatorState} />
                </div>
                
                {!user && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="bg-background/90 p-6 rounded-lg shadow-lg text-center">
                      <h2 className="text-xl font-semibold mb-3">Sign in to Chat</h2>
                      <p className="text-muted-foreground mb-4">
                        Please sign in or create an account to use the chat.
                      </p>
                      <Button onClick={() => setLoginModalOpen(true)}>
                        Sign in
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={25} minSize={20}>
              {user ? (
                <div className="h-full overflow-auto p-4">
                  <DocumentsSection userId={user.id} />
                </div>
              ) : (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center p-8">
                    <h2 className="text-xl font-medium mb-4">Sign in to manage documents</h2>
                    <p className="text-gray-500 mb-6">
                      Sign in to upload and interact with your documents
                    </p>
                    <Button onClick={() => setLoginModalOpen(true)}>
                      Sign in with Email
                    </Button>
                  </div>
                </div>
              )}
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </div>
      <ChatInput
        handleInputChange={handleInputChange}
        handleSubmit={handleSubmit}
        input={input}
        isLoading={isLoading}
        disabled={!user}
      />
      <LoginModal isOpen={loginModalOpen} onClose={() => setLoginModalOpen(false)} />
    </>
  );
}
