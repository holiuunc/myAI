**pw for supabase: NaFvi9frhOiMFeN0**
# myDucky - Personalized Document-Assisted Learning Tool

## Project Overview
myDucky is a personalized learning assistant that helps users understand and extract insights from their documents. Using AI-powered conversation and document processing, myDucky creates isolated, secure knowledge environments for each user where they can upload resources, ask questions, and receive contextually relevant answers.

## Core Features

### User Authentication & Isolation
- Email-only authentication - Simple login system with just an email (no password required)
- Isolated user sessions - Each user's documents, chat history, and knowledge base are completely separate
- Persistent sessions - User data and conversations persist between logins

### Document Management
- Multiple format support - Upload PDFs, DOCXs, and plain text files
- Document library - View, manage, and delete uploaded documents
- Secure storage - Documents stored securely and only accessible by their owner

### AI-Powered Conversations
- Context-aware responses - AI understands and references uploaded documents
- Knowledge retention - Conversations maintain context about previously discussed topics
- History management - Clear chat history without affecting document storage

## Technical Architecture

### Frontend
- Next.js - React framework for the UI
- TypeScript - Type-safe code

### Backend & Data Storage
- Supabase - User profiles, authentication, and document metadata
- Pinecone - Vector database for storing document embeddings with user namespaces
- OpenAI - Generating embeddings and powering the conversational AI

## Key Components
- Authentication System - Simple email-based login with session persistence
- Document Processor - Extracts text, chunks content, and generates embeddings
- Knowledge Base - Stores document vectors in user-specific namespaces
- Chat Interface - Handles conversation flow and document references

## Data Flow

### User Authentication
1. User logs in with email
2. System creates or retrieves existing user profile
3. User-specific session established

### Document Upload
1. User uploads document
2. System extracts text content
3. Content is chunked and vectorized with OpenAI embeddings
4. Vectors stored in Pinecone under user's namespace
5. Document metadata stored in Supabase

### Conversation Flow
1. User asks a question
2. System generates embedding for the question
3. Relevant document chunks retrieved from user's namespace in Pinecone
4. OpenAI generates response incorporating document context
5. Response displayed to user and saved in chat history

## Development Principles
- User Isolation - Every aspect of the system maintains strict separation between users
- Simplicity First - Authentication and user experience prioritize simplicity
- Contextual Intelligence - AI responses should effectively leverage user documents
- Privacy & Security - User data and documents are secure and private

## Implementation Notes
When working on this project, remember these key points:
- Each user's documents must remain completely isolated
- Authentication should remain simple with email-only flow
- Document processing should handle various formats effectively
- AI responses should meaningfully incorporate document knowledge
- Session persistence is essential for good user experience

## Potential Future Enhancements (not prioritized)
- Document sharing capabilities
- Enhanced format support (images, spreadsheets, presentations)
- Fine-tuned AI models for specific document domains
- Collaborative knowledge spaces
- Advanced document search and filtering