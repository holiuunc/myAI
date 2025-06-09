# myDucky - Personalized Document-Assisted Learning Tool

## Project Overview
myDucky is a personalized learning assistant that helps users understand and extract insights from their documents. Using AI-powered conversation and document processing, myDucky creates isolated, secure knowledge environments for each user where they can upload resources, ask questions, and receive contextually relevant answers.

The system implements Retrieval Augmented Generation (RAG) to provide accurate, document-grounded responses that reference your personal knowledge base rather than generic information.

## Core Features

### User Authentication & Isolation
- Email-only authentication - Simple login system with just an email (no password required)
- Isolated user sessions - Each user's documents, chat history, and knowledge base are completely separate
- Persistent sessions - User data and conversations persist between logins

### Document Management
- Multiple format support - Upload PDFs, DOCXs, and plain text files
- Document library - View, manage, and delete uploaded documents
- Secure storage - Documents stored securely and only accessible by their owner
- Direct uploads - Large file support with direct-to-storage uploads
- Intelligent filename handling - Clean display of document names without technical prefixes

### AI-Powered Conversations
- Context-aware responses - AI understands and references uploaded documents
- Knowledge retention - Conversations maintain context about previously discussed topics
- History management - Clear chat history without affecting document storage
- Embedding caching - Efficient processing with cached embeddings to reduce API costs

## Technical Architecture

### Frontend
- Next.js 14 - React framework with server components and app router
- TypeScript - Type-safe code
- Tailwind CSS - Utility-first styling with shadcn/ui components
- React Server Components - For optimized rendering and data fetching

### Backend & Data Storage
- Supabase - User profiles, authentication, document metadata, and file storage
- Pinecone - Vector database for storing document embeddings with user namespaces
- OpenAI - Generating embeddings (text-embedding-ada-002) and powering the conversational AI
- Edge Runtime - For optimized serverless functions

## Implementation Details

### Document Processing Pipeline
1. **Upload Phase**:
   - Client-side validation for file type and size
   - Signed URL generation for direct uploads to Supabase Storage
   - Background processing to avoid timeout issues

2. **Text Extraction**:
   - PDF processing with dual-engine approach (pdfjs-serverless with pdf2json fallback)
   - DOCX text extraction
   - Plain text normalization

3. **Chunking Strategy**:
   - Intelligent text chunking (2000 chars with 200 char overlap)
   - Context preservation between chunks
   - Semantic boundary detection for natural splits

4. **Embedding Generation**:
   - MD5 hash-based caching to avoid redundant API calls
   - Batch processing for efficiency
   - OpenAI's text-embedding-ada-002 model

5. **Vector Storage**:
   - User-isolated namespaces in Pinecone
   - Metadata preservation (source, context, document reference)
   - Batched operations to stay within API limits

### Performance Optimizations
- Embedding caching to reduce OpenAI API calls
- Batch processing for Pinecone operations
- Direct storage uploads to bypass serverless function size limits
- Progress tracking for long-running operations
- Asynchronous document processing with status updates

### Security Model
- Complete user isolation through namespaced vector storage
- Server-side validation of user access to documents
- Secure direct uploads with signed URLs
- No cross-user data access possible by design

## Deployment Architecture
- Vercel for hosting the Next.js application
- Supabase for backend database and storage
- Pinecone for vector database
- Optimized for serverless environment with careful timeout management

## Development Principles
- User Isolation - Every aspect of the system maintains strict separation between users
- Simplicity First - Authentication and user experience prioritize simplicity
- Contextual Intelligence - AI responses should effectively leverage user documents
- Privacy & Security - User data and documents are secure and private
- Performance - Optimized for both speed and cost efficiency

## Implementation Challenges Overcome
- Large file uploads in serverless environments
- Accurate text extraction from complex documents
- Memory and timeout constraints in serverless functions
- Efficient embedding generation and storage
- Clean user experience with background processing

## Potential Future Enhancements
- Document sharing capabilities
- Enhanced format support (images, spreadsheets, presentations)
- Fine-tuned AI models for specific document domains
- Collaborative knowledge spaces
- Advanced document search and filtering
- Integration with additional AI models beyond OpenAI
- Offline processing capabilities for very large documents
