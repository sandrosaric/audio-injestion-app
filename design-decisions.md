Please build a modular Node.js/TypeScript audio transcription service based on the following specifications and prepare it for GitHub. Follow these steps exactly:

Step 1: Project Setup & Dependencies
- Initialize a new Node.js project using TypeScript.
- Install these runtime dependencies: express, multer, @google/genai, dotenv
- Install these development dependencies: typescript, @types/node, @types/express, @types/multer, tsx
- Create a 'tsconfig.json' configured for Node 18+.
- Create a '.gitignore' file that excludes: node_modules/, dist/, .env, and uploads/

Step 2: Environment Configuration
- Create a '.env.example' file containing placeholders for:
  PORT=3000
  GEMINI_API_KEY=your_api_key_here
- Create a local '.env' file using those same keys.

Step 3: Core Implementation
Create an Express server with the following architecture:
1. Middleware Layer: 
   - Set up 'multer' to accept a single audio file via form-data (field name: 'audio').
   - Save files temporarily to an './uploads' directory.
   - Implement a mime-type filter restricting uploads to standard audio formats (WAV, MP3, OGG, M4A).
   - Enforce a 25MB file size limit.

2. Service Layer:
   - Use the official '@google/genai' SDK.
   - Initialize the client using GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }).
   - Create a transcription function utilizing the 'gemini-2.5-flash' model.
   - Pass the local file buffer as inlineData base64.
   - Set config.responseMimeType to 'application/json'.
   - Define a strict config.responseSchema containing:
     - transcript (Type.STRING)
     - segments (Type.ARRAY of objects containing start_time, end_time, text)

3. API Endpoint Layer:
   - Create a POST route at '/api/v1/transcribe'.
   - Parse the incoming audio, send it to the service layer, and return the structured JSON response.
   - Ensure the temporary file in './uploads' is synchronously deleted using fs.unlinkSync inside both the success block and the catch block to prevent memory/disk leaks.

Step 4: Verification & Git Initialization
- Ensure the app can run locally using a script like 'tsx watch src/index.ts'.
- Initialize a local git repository ('git init').
- Stage all files, create an initial commit, and provide clear terminal instructions on how to link this to a remote GitHub repository.