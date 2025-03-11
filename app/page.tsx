"use client";

import ChatInput from "@/components/chat/input";
import ChatMessages from "@/components/chat/messages";
import useApp from "@/hooks/use-app";
import ChatHeader from "@/components/chat/header";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { DocumentPanel } from "@/components/chat/document-panel";

export default function Chat() {
  const {
    messages,
    handleInputChange,
    handleSubmit,
    input,
    isLoading,
    indicatorState,
    clearMessages,
    documents,
    uploadDocument,
    deleteDocument,
  } = useApp();

  return (
    <>
      <ChatHeader clearMessages={clearMessages} />
      <div className="flex justify-center items-center h-screen pt-16 pb-24">
        <div className="flex flex-col max-w-screen-xl w-full h-full">
          <ResizablePanelGroup direction="horizontal" className="h-full">
            <ResizablePanel defaultSize={75} minSize={50}>
              <div className="p-5 h-full overflow-auto">
                <ChatMessages messages={messages} indicatorState={indicatorState} />
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={25} minSize={20}>
              <DocumentPanel 
                documents={documents} 
                onUpload={uploadDocument} 
                onDelete={deleteDocument}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </div>
      <ChatInput
        handleInputChange={handleInputChange}
        handleSubmit={handleSubmit}
        input={input}
        isLoading={isLoading}
      />
    </>
  );
}
