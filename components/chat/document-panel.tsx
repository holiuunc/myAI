"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileIcon, Upload, Trash2, FileText } from "lucide-react";
import type { UploadedDocument } from "@/types";
import { FileUploader } from "./file-uploader";

interface DocumentPanelProps {
  documents: UploadedDocument[];
  onUpload: (file: File) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function DocumentPanel({ documents, onUpload, onDelete }: DocumentPanelProps) {
  const [isUploading, setIsUploading] = useState(false);
  
  const handleUpload = async (file: File) => {
    setIsUploading(true);
    try {
      await onUpload(file);
    } catch (error) {
      console.error("Upload failed:", error);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-gray-50 border-l">
      <div className="h-4" />
      <div className="p-4 border-b bg-white">
        <h2 className="text-lg font-semibold">Learning Materials</h2>
        <p className="text-sm text-gray-500">Upload documents to enhance my teaching</p>
      </div>

      <div className="p-4">
        <FileUploader onUpload={handleUpload} isUploading={isUploading} />
      </div>

      {isUploading && (
        <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-10">
          <div className="flex flex-col items-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-700" />
            <p className="mt-2 text-sm text-blue-700">Processing document...</p>
          </div>
        </div>
      )}

      <ScrollArea className="flex-1 p-4">
        {documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-gray-500">
            <FileText className="w-12 h-12 mb-2 opacity-20" />
            <p>No documents uploaded yet</p>
            <p className="text-xs">Upload documents to help me provide better answers</p>
          </div>
        ) : (
          <div className="space-y-2">
            {documents.map((doc) => (
              <Card key={doc.id} className="overflow-hidden">
                <CardContent className="p-3 flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <FileIcon className="w-5 h-5 text-blue-500" />
                    <div className="truncate">
                      <p className="font-medium truncate">{doc.title}</p>
                      <p className="text-xs text-gray-500">
                        {new Date(doc.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => onDelete(doc.id)}
                    className="text-red-500 hover:text-red-700"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}