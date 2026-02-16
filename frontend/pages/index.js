import { useState, useRef, useEffect } from 'react';
import Head from 'next/head';

export default function Home() {
  const [apiKey, setApiKey] = useState('');
  const [isApiKeySet, setIsApiKeySet] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [skillFile, setSkillFile] = useState(null);
  const [useSkillMode, setUseSkillMode] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [agentThoughts, setAgentThoughts] = useState([]);
  const [commandOutputs, setCommandOutputs] = useState([]);
  const [executionMode, setExecutionMode] = useState('backend'); // 'backend' or 'direct'

  const logsEndRef = useRef(null);
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;

  const [virtualFileSystem, setVirtualFileSystem] = useState({});

  useEffect(() => {
    const savedKey = localStorage.getItem('groq_api_key');
    if (savedKey) {
      setApiKey(savedKey);
      setIsApiKeySet(true);
    }
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, agentThoughts]);

  const addLog = (message, type) => {
    const timestamp = new Date().toLocaleTimeString('id-ID');
    setLogs(prev => [...prev, { timestamp, message, type: type || 'info' }]);
  };

  const addThought = (thought, action) => {
    const timestamp = new Date().toLocaleTimeString('id-ID');
    setAgentThoughts(prev => [...prev, { timestamp, thought, action: action || null }]);
  };

  const handleApiKeySubmit = () => {
    if (!apiKey.trim()) {
      alert('Masukkan API key!');
      return;
    }
    
    if (!apiKey.startsWith('gsk_')) {
      alert('API key harus diawali gsk_');
      return;
    }

    setIsApiKeySet(true);
    localStorage.setItem('groq_api_key', apiKey);
    addLog('API Key tersimpan!', 'success');
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setSkillFile({ name: file.name, content: event.target.result });
        setUseSkillMode(true);
        addLog('File ' + file.name + ' berhasil diupload', 'success');
      };
      reader.readAsText(file);
    }
  };

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  const extractWaitTime = (errorMessage) => {
    const match = errorMessage.match(/try again in ([\d.]+)s/);
    if (match) {
      return parseFloat(match[1]) * 1000;
    }
    return 6000;
  };

  // ✅ Parse curl command menjadi fetch options
  const parseCurlCommand = (curlCommand) => {
    const urlMatch = curlCommand.match(/https?:\/\/[^\s]+/);
    const url = urlMatch ? urlMatch[0] : null;
    
    const methodMatch = curlCommand.match(/-X\s+(\w+)/);
    const method = methodMatch ? methodMatch[1] : 'GET';
    
    const headerMatches = [...curlCommand.matchAll(/-H\s+["']([^"']+)["']/g)];
    const headers = {};
    headerMatches.forEach(match => {
      const [key, value] = match[1].split(':').map(s => s.trim());
      headers[key] = value;
    });
    
    const dataMatch = curlCommand.match(/-d\s+['"](.+)['"]/);
    const body = dataMatch ? dataMatch[1] : null;
    
    return { url, method, headers, body };
  };

  // ✅ Execute curl via direct fetch (fallback jika backend ga ada endpoint)
  const executeCurlDirect = async (curlCommand) => {
    try {
      const { url, method, headers, body } = parseCurlCommand(curlCommand);
      
      if (!url) {
        throw new Error('Invalid curl command: URL not found');
      }
      
      addLog(`📡 Direct fetch to: ${url}`, 'info');
      
      const fetchOptions = {
        method,
        headers,
      };
      
      if (body && method !== 'GET') {
        fetchOptions.body = body;
      }
      
      const response = await fetch(url, fetchOptions);
      const data = await response.json();
      
      return {
        success: response.ok,
        output: data,
        raw_output: JSON.stringify(data, null, 2),
        status: response.status
      };
    } catch (error) {
      throw new Error(`Direct fetch failed: ${error.message}`);
    }
  };

  // ✅ Execute curl via backend
  const executeCurlBackend = async (curlCommand) => {
    const executeResponse = await fetch(backendUrl + '/api/execute-command', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        command: curlCommand
      })
    });
    
    if (!executeResponse.ok) {
      throw new Error(`Backend returned ${executeResponse.status}`);
    }
    
    return await executeResponse.json();
  };

  // ✅ FUNGSI UNTUK EKSEKUSI TOOL (ASYNC)
  const executeToolCall = async (toolName, args, currentFs) => {
    switch(toolName) {
      case 'create_directory':
        const newFs = { ...currentFs };
        newFs[args.path] = { type: 'directory', created_at: new Date().toISOString() };
        addLog(`📁 Direktori dibuat: ${args.path}`, 'success');
        return {
          success: true,
          message: `Direktori ${args.path} berhasil dibuat`,
          filesystem: newFs
        };

      case 'create_file':
        const fsWithFile = { ...currentFs };
        fsWithFile[args.path] = { 
          type: 'file', 
          content: args.content,
          created_at: new Date().toISOString() 
        };
        addLog(`📄 File dibuat: ${args.path}`, 'success');
        return {
          success: true,
          message: `File ${args.path} berhasil dibuat`,
          filesystem: fsWithFile
        };

      case 'write_to_file':
        const fsWritten = { ...currentFs };
        if (fsWritten[args.path]) {
          fsWritten[args.path].content = args.content;
          fsWritten[args.path].updated_at = new Date().toISOString();
        } else {
          fsWritten[args.path] = {
            type: 'file',
            content: args.content,
            created_at: new Date().toISOString()
          };
        }
        addLog(`✏️ Menulis ke file: ${args.path}`, 'success');
        return {
          success: true,
          message: `Konten berhasil ditulis ke ${args.path}`,
          filesystem: fsWritten
        };

      case 'list_directory':
        const dirPath = args.path || '/';
        const items = Object.keys(currentFs).filter(p => p.startsWith(dirPath));
        addLog(`📋 List direktori: ${dirPath} (${items.length} item)`, 'info');
        return {
          success: true,
          items: items,
          message: `Ditemukan ${items.length} item di ${dirPath}`
        };

      case 'download_file':
        addLog(`⬇️ Download: ${args.url} → ${args.destination}`, 'info');
        const fsDownload = { ...currentFs };
        fsDownload[args.destination] = {
          type: 'file',
          content: `[Downloaded from ${args.url}]`,
          url: args.url,
          created_at: new Date().toISOString()
        };
        return {
          success: true,
          message: `File dari ${args.url} di-download ke ${args.destination}`,
          filesystem: fsDownload
        };

      case 'execute_command':
        // Generate random agent name jika ada placeholder
        let processedCommand = args.command;
        if (processedCommand.includes('YourAgentName')) {
          const randomName = 'Agent_' + Math.random().toString(36).substring(2, 10);
          processedCommand = processedCommand.replace(/YourAgentName/g, randomName);
          addLog(`🎲 Random name: ${randomName}`, 'success');
        }
        
        addLog(`⚙️ Executing: ${processedCommand}`, 'info');
        
        let executeResult;
        
        // Try backend first, fallback to direct
        try {
          if (executionMode === 'backend') {
            addLog(`📡 Mode: Backend execution`, 'info');
            executeResult = await executeCurlBackend(processedCommand);
          } else {
            addLog(`📡 Mode: Direct fetch`, 'info');
            executeResult = await executeCurlDirect(processedCommand);
          }
        } catch (backendError) {
          addLog(`⚠️ Backend failed: ${backendError.message}`, 'warning');
          addLog(`🔄 Fallback to direct fetch...`, 'info');
          
          try {
            executeResult = await executeCurlDirect(processedCommand);
            setExecutionMode('direct'); // Switch to direct mode
          } catch (directError) {
            addLog(`❌ Direct fetch also failed: ${directError.message}`, 'error');
            return {
              success: false,
              output: `Both backend and direct execution failed. Error: ${directError.message}`,
              message: 'Execution failed'
            };
          }
        }
        
        if (executeResult.success) {
          let displayOutput = '';
          if (typeof executeResult.output === 'object') {
            displayOutput = JSON.stringify(executeResult.output, null, 2);
          } else {
            displayOutput = executeResult.output || executeResult.raw_output;
          }
          
          addLog(`✅ Command executed successfully!`, 'success');
          
          setCommandOutputs(prev => [...prev, {
            timestamp: new Date().toLocaleTimeString('id-ID'),
            command: processedCommand,
            output: displayOutput
          }]);
          
          return {
            success: true,
            output: displayOutput,
            raw_output: executeResult.raw_output,
            message: 'Command berhasil dijalankan',
            command: processedCommand
          };
        } else {
          addLog(`❌ Command failed: ${executeResult.error}`, 'error');
          return {
            success: false,
            output: executeResult.error,
            message: 'Command gagal dijalankan'
          };
        }

      case 'register_api_key':
        addLog(`🔑 Register API key: ${args.key_name}`, 'success');
        return {
          success: true,
          message: `API key ${args.key_name} berhasil didaftarkan`
        };

      case 'complete_task':
        addLog(`✅ Task selesai: ${args.summary}`, 'success');
        return {
          success: true,
          message: 'Task completed',
          summary: args.summary
        };

      default:
        addLog(`❓ Unknown tool: ${toolName}`, 'warning');
        return {
          success: false,
          message: `Tool ${toolName} tidak dikenali`
        };
    }
  };

  const callBackendAPI = async (messages, tools, retryAttempt = 0) => {
    const MAX_RETRIES = 3;
    
    // ✅ Estimate token usage (rough estimation)
    const estimateTokens = (msgs) => {
      const text = JSON.stringify(msgs);
      return Math.ceil(text.length / 4); // Rough: 1 token ≈ 4 chars
    };
    
    const estimatedTokens = estimateTokens(messages);
    if (estimatedTokens > 10000) {
      addLog(`⚠️ High token usage: ~${estimatedTokens} tokens`, 'warning');
    }
    
    try {
      const response = await fetch(backendUrl + '/api/groq/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: messages,
          temperature: 0.5,
          max_tokens: 1500,
          tools: tools || undefined,
          tool_choice: tools ? 'auto' : undefined
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        
        // Log detailed error untuk debugging
        console.error('Backend Error Details:', errorData);
        addLog(`🔍 Debug: ${JSON.stringify(errorData)}`, 'warning');
        
        if (errorData.error?.code === 'rate_limit_exceeded') {
          if (retryAttempt < MAX_RETRIES) {
            const waitTime = extractWaitTime(errorData.error.message);
            const retryDelay = Math.max(waitTime, (retryAttempt + 1) * 2000);
            
            addLog(`⏳ Rate limit. Retry ${retryAttempt + 1}/${MAX_RETRIES} dalam ${Math.ceil(retryDelay / 1000)}s...`, 'warning');
            
            await sleep(retryDelay);
            return callBackendAPI(messages, tools, retryAttempt + 1);
          } else {
            throw new Error('Rate limit exceeded setelah ' + MAX_RETRIES + ' retry');
          }
        }
        
        // Throw dengan pesan error yang lebih detail
        const errorMsg = errorData.error?.message || errorData.error || JSON.stringify(errorData);
        throw new Error(`Backend Error: ${errorMsg}`);
      }

      return await response.json();
    } catch (error) {
      // Network error - retry jika masih ada kesempatan
      if (error.message.includes('fetch') || error.message.includes('network')) {
        if (retryAttempt < MAX_RETRIES) {
          const retryDelay = (retryAttempt + 1) * 3000; // 3s, 6s, 9s
          addLog(`🔌 Network error. Retry ${retryAttempt + 1}/${MAX_RETRIES} dalam ${retryDelay/1000}s...`, 'warning');
          await sleep(retryDelay);
          return callBackendAPI(messages, tools, retryAttempt + 1);
        }
        throw new Error('Koneksi gagal setelah ' + MAX_RETRIES + ' retry. Cek internet atau backend URL.');
      }
      throw error;
    }
  };

  const executeAgentTask = async () => {
    if (isRunning) return;
    
    if (!useSkillMode && !instruction.trim()) {
      alert('Masukkan instruksi!');
      return;
    }

    if (useSkillMode && !skillFile) {
      alert('Upload SKILL.md dulu!');
      return;
    }

    setIsRunning(true);
    setVirtualFileSystem({});
    addLog('🚀 Agent mulai bekerja...', 'info');
    
    try {
      let systemPrompt = '';
      let userPrompt = '';

      if (useSkillMode && skillFile) {
        const maxSkillLength = 4000;
        const truncatedContent = skillFile.content.length > maxSkillLength 
          ? skillFile.content.substring(0, maxSkillLength) + '...[truncated]'
          : skillFile.content;
          
        systemPrompt = `Anda adalah autonomous agent yang HARUS menjalankan setiap instruksi dari SKILL.md secara detail dan bertahap.

PENTING:
- Baca SKILL.md dengan teliti
- Jalankan SETIAP langkah yang diminta
- Gunakan tools yang tersedia untuk eksekusi
- Jangan hanya merencanakan, tapi LAKUKAN
- Laporkan setiap action yang Anda lakukan

Anda memiliki tools untuk:
- create_directory: buat direktori
- create_file: buat file baru
- write_to_file: tulis konten ke file
- download_file: download dari URL
- execute_command: jalankan command
- register_api_key: daftarkan API key
- complete_task: selesaikan task`;

        userPrompt = `SKILL.md:\n${truncatedContent}\n\nInstruksi: ${instruction || 'Ikuti semua langkah di SKILL.md dengan detail'}`;
        addLog('Mode: Skill-based (Execution)', 'info');
      } else {
        systemPrompt = 'Anda adalah autonomous agent yang pintar dan actionable. Jalankan task dengan tool yang tersedia.';
        userPrompt = instruction;
        addLog('Mode: Autonomous', 'info');
      }

      const tools = [
        {
          type: 'function',
          function: {
            name: 'create_directory',
            description: 'Buat direktori baru',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'Path direktori (misal: /home/user/project)' }
              },
              required: ['path']
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'create_file',
            description: 'Buat file baru dengan konten',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'Path file lengkap' },
                content: { type: 'string', description: 'Isi file' }
              },
              required: ['path', 'content']
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'write_to_file',
            description: 'Tulis atau update konten file',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                content: { type: 'string' }
              },
              required: ['path', 'content']
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'download_file',
            description: 'Download file dari URL',
            parameters: {
              type: 'object',
              properties: {
                url: { type: 'string', description: 'URL sumber' },
                destination: { type: 'string', description: 'Path tujuan' }
              },
              required: ['url', 'destination']
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'execute_command',
            description: 'Jalankan command shell',
            parameters: {
              type: 'object',
              properties: {
                command: { type: 'string', description: 'Command untuk dijalankan' }
              },
              required: ['command']
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'register_api_key',
            description: 'Daftarkan API key',
            parameters: {
              type: 'object',
              properties: {
                key_name: { type: 'string', description: 'Nama API key' },
                key_value: { type: 'string', description: 'Value API key' }
              },
              required: ['key_name']
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'complete_task',
            description: 'Tandai task sebagai selesai dengan summary',
            parameters: {
              type: 'object',
              properties: {
                summary: { type: 'string', description: 'Ringkasan apa yang sudah dilakukan' }
              },
              required: ['summary']
            }
          }
        }
      ];

      addThought('📖 Membaca instruksi dari SKILL.md...', null);
      
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ];

      let currentFileSystem = {};
      let iterationCount = 0;
      const MAX_ITERATIONS = 10;

      while (iterationCount < MAX_ITERATIONS) {
        iterationCount++;
        addLog(`🔄 Iterasi ${iterationCount}...`, 'info');

        // ✅ PRUNE conversation history jika terlalu panjang
        // Keep only: system message, user message, last 3 exchanges
        if (messages.length > 15) {
          const systemMsg = messages[0];
          const userMsg = messages[1];
          const recentMessages = messages.slice(-10); // Last 10 messages
          
          messages.length = 0;
          messages.push(systemMsg);
          messages.push(userMsg);
          messages.push(...recentMessages);
          
          addLog(`🔄 Pruned conversation history (keeping recent context)`, 'info');
        }

        const response = await callBackendAPI(messages, tools);
        const assistantMessage = response.choices[0].message;

        if (assistantMessage.content) {
          addThought(assistantMessage.content, `Step ${iterationCount}`);
        }

        if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
          addLog('✅ Agent selesai (no more actions)', 'success');
          break;
        }

        messages.push(assistantMessage);

        let allToolResults = [];
        for (const toolCall of assistantMessage.tool_calls) {
          const functionName = toolCall.function.name;
          const functionArgs = JSON.parse(toolCall.function.arguments);

          addLog(`🔧 Tool: ${functionName}`, 'info');

          const toolResult = await executeToolCall(functionName, functionArgs, currentFileSystem);
          
          if (toolResult.filesystem) {
            currentFileSystem = toolResult.filesystem;
            setVirtualFileSystem(toolResult.filesystem);
          }

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult)
          });

          allToolResults.push(toolResult);

          if (functionName === 'complete_task') {
            addLog('🎉 Task ditandai selesai oleh agent!', 'success');
            addThought(`Task Summary: ${toolResult.summary}`, 'COMPLETED');
            iterationCount = MAX_ITERATIONS;
            break;
          }
        }

        await sleep(1500);
      }

      if (iterationCount >= MAX_ITERATIONS) {
        addLog('⚠️ Reached max iterations', 'warning');
      }

      const fileCount = Object.keys(currentFileSystem).length;
      if (fileCount > 0) {
        addLog(`📦 Total ${fileCount} file/direktori dibuat`, 'success');
        addThought(`File System:\n${JSON.stringify(currentFileSystem, null, 2)}`, 'File System');
      }

    } catch (error) {
      addLog('❌ Error: ' + error.message, 'error');
      addThought('Error: ' + error.message, 'ERROR');
    } finally {
      setIsRunning(false);
    }
  };

  const clearLogs = () => {
    setLogs([]);
    setAgentThoughts([]);
    setVirtualFileSystem({});
    setCommandOutputs([]);
  };

  const resetApiKey = () => {
    setApiKey('');
    setIsApiKeySet(false);
    localStorage.removeItem('groq_api_key');
    clearLogs();
  };

  if (!isApiKeySet) {
    return (
      <>
        <Head><title>Groq Agent - Executor</title></Head>
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-8 flex items-center justify-center">
          <div className="max-w-md w-full bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 bg-purple-500 rounded-full flex items-center justify-center text-4xl">🤖</div>
            </div>
            <h1 className="text-3xl font-bold text-white text-center mb-2">Groq Agent</h1>
            <p className="text-purple-200 text-center mb-8">Executor Edition</p>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="gsk_..."
              className="w-full px-4 py-3 bg-white/10 border border-white/30 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 mb-4"
              onKeyPress={(e) => e.key === 'Enter' && handleApiKeySubmit()}
            />
            <button onClick={handleApiKeySubmit} disabled={!apiKey.trim()} className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white py-3 rounded-lg font-semibold hover:from-purple-600 hover:to-pink-600 transition-all disabled:opacity-50">
              Mulai
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Head><title>Groq Agent - Executor</title></Head>
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 mb-6 border border-white/20">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-3">
                <div className="text-4xl">🤖</div>
                <div>
                  <h1 className="text-2xl font-bold text-white">Groq Agent Executor</h1>
                  <p className="text-purple-200 text-sm">
                    Llama 3.3 70B • Mode: {executionMode === 'backend' ? '🔧 Backend' : '📡 Direct'}
                  </p>
                </div>
              </div>
              <button onClick={resetApiKey} className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg">
                Reset
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
              <h2 className="text-xl font-bold text-white mb-4">Control Panel</h2>
              
              <div className="flex gap-2 mb-4">
                <button onClick={() => setUseSkillMode(false)} className={'flex-1 py-2 px-4 rounded-lg font-medium ' + (!useSkillMode ? 'bg-purple-500 text-white' : 'bg-white/10 text-purple-200')}>
                  Autonomous
                </button>
                <button onClick={() => setUseSkillMode(true)} className={'flex-1 py-2 px-4 rounded-lg font-medium ' + (useSkillMode ? 'bg-purple-500 text-white' : 'bg-white/10 text-purple-200')}>
                  Skill-based
                </button>
              </div>

              {useSkillMode && (
                <div className="mb-4">
                  <input type="file" accept=".md,.txt" onChange={handleFileUpload} className="hidden" id="file-upload" />
                  <label htmlFor="file-upload" className="flex items-center justify-center gap-2 px-4 py-3 bg-white/10 border-2 border-dashed border-white/30 rounded-lg text-purple-200 hover:bg-white/20 cursor-pointer">
                    📄 {skillFile ? skillFile.name : 'Upload SKILL.md'}
                  </label>
                </div>
              )}

              <div className="mb-4">
                <label className="block text-purple-200 text-sm mb-2">Instruksi Tambahan (Opsional)</label>
                <textarea
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="Instruksi tambahan atau biarkan kosong untuk ikuti SKILL.md..."
                  className="w-full px-4 py-3 bg-white/10 border border-white/30 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 h-32 resize-none"
                />
              </div>

              <div className="flex gap-2">
                <button onClick={executeAgentTask} disabled={isRunning || (useSkillMode && !skillFile)} className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 text-white py-3 rounded-lg font-semibold hover:from-purple-600 hover:to-pink-600 disabled:opacity-50">
                  {isRunning ? '⚙️ Executing...' : '▶️ Jalankan'}
                </button>
                <button onClick={clearLogs} className="px-4 py-3 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg">Clear</button>
              </div>
            </div>

            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
              <h2 className="text-xl font-bold text-white mb-4">📋 Execution Logs</h2>
              <div className="bg-black/30 rounded-lg p-4 h-96 overflow-y-auto font-mono text-sm">
                {logs.length === 0 ? <p className="text-gray-400 text-center mt-10">Waiting for execution...</p> : logs.map((log, idx) => (
                  <div key={idx} className={'mb-2 ' + (log.type === 'error' ? 'text-red-400' : log.type === 'success' ? 'text-green-400' : log.type === 'warning' ? 'text-yellow-400' : 'text-blue-300')}>
                    <span className="text-gray-500">[{log.timestamp}]</span> {log.message}
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
              <h2 className="text-xl font-bold text-white mb-4">🧠 Agent Reasoning</h2>
              <div className="bg-black/30 rounded-lg p-4 max-h-96 overflow-y-auto">
                {agentThoughts.length === 0 ? <p className="text-gray-400 text-center">Waiting...</p> : agentThoughts.map((thought, idx) => (
                  <div key={idx} className="mb-4 p-4 bg-white/5 rounded-lg border border-purple-500/30">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-purple-400 font-semibold">[{thought.timestamp}]</span>
                      {thought.action && <span className="px-2 py-1 bg-purple-500/30 text-purple-200 text-xs rounded">{thought.action}</span>}
                    </div>
                    <p className="text-white whitespace-pre-wrap text-sm">{thought.thought}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
              <h2 className="text-xl font-bold text-white mb-4">⚙️ Command Outputs</h2>
              <div className="bg-black/30 rounded-lg p-4 max-h-96 overflow-y-auto">
                {commandOutputs.length === 0 ? (
                  <p className="text-gray-400 text-center">No commands executed...</p>
                ) : (
                  <div className="space-y-3">
                    {commandOutputs.map((item, idx) => (
                      <div key={idx} className="p-3 bg-white/5 rounded border border-cyan-500/30">
                        <div className="text-cyan-400 text-xs mb-2">[{item.timestamp}]</div>
                        <div className="text-gray-300 text-xs font-mono mb-2 bg-black/30 p-2 rounded overflow-x-auto">
                          $ {item.command}
                        </div>
                        <div className="text-green-400 text-xs font-mono bg-black/30 p-2 rounded overflow-x-auto whitespace-pre-wrap">
                          {item.output}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
              <h2 className="text-xl font-bold text-white mb-4">📦 Virtual File System</h2>
              <div className="bg-black/30 rounded-lg p-4 max-h-96 overflow-y-auto">
                {Object.keys(virtualFileSystem).length === 0 ? (
                  <p className="text-gray-400 text-center">No files created yet...</p>
                ) : (
                  <div className="space-y-2">
                    {Object.entries(virtualFileSystem).map(([path, data], idx) => (
                      <div key={idx} className="p-3 bg-white/5 rounded border border-green-500/30">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xl">{data.type === 'directory' ? '📁' : '📄'}</span>
                          <span className="text-green-400 font-mono text-sm">{path}</span>
                        </div>
                        {data.content && (
                          <div className="ml-7 text-xs text-gray-400 mt-1 font-mono overflow-x-auto">
                            {data.content.substring(0, 100)}{data.content.length > 100 ? '...' : ''}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
