import { useState, useRef, useEffect } from 'react';
import Head from 'next/head';

export default function Home() {
  const [apiKeys, setApiKeys] = useState({
    groq: '',
    gemini: '',
    openrouter: '',
    together: ''
  });
  const [showSettings, setShowSettings] = useState(false);
  const [isApiKeySet, setIsApiKeySet] = useState(false);
  const [activeProviders, setActiveProviders] = useState([]);
  
  const [instruction, setInstruction] = useState('');
  const [skillFile, setSkillFile] = useState(null);
  const [useSkillMode, setUseSkillMode] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [agentThoughts, setAgentThoughts] = useState([]);
  const [commandOutputs, setCommandOutputs] = useState([]);
  const [virtualFileSystem, setVirtualFileSystem] = useState({});
  const [currentProvider, setCurrentProvider] = useState(null);

  const logsEndRef = useRef(null);
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;

  useEffect(() => {
    const saved = localStorage.getItem('ai_api_keys');
    if (saved) {
      const keys = JSON.parse(saved);
      setApiKeys(keys);
      const active = Object.keys(keys).filter(k => keys[k]);
      if (active.length > 0) {
        setIsApiKeySet(true);
        setActiveProviders(active);
      }
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

  const handleSaveApiKeys = () => {
    const active = Object.keys(apiKeys).filter(k => apiKeys[k] && apiKeys[k].trim());
    
    if (active.length === 0) {
      alert('Masukkan minimal 1 API key!');
      return;
    }

    setIsApiKeySet(true);
    setActiveProviders(active);
    localStorage.setItem('ai_api_keys', JSON.stringify(apiKeys));
    setShowSettings(false);
    addLog(`✅ ${active.length} provider tersimpan: ${active.join(', ')}`, 'success');
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setSkillFile({ name: file.name, content: event.target.result });
        setUseSkillMode(true);
        addLog('File ' + file.name + ' uploaded', 'success');
      };
      reader.readAsText(file);
    }
  };

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

  const executeCurlDirect = async (curlCommand) => {
    try {
      const { url, method, headers, body } = parseCurlCommand(curlCommand);
      if (!url) throw new Error('Invalid curl: URL not found');
      
      const fetchOptions = { method, headers };
      if (body && method !== 'GET') fetchOptions.body = body;
      
      const response = await fetch(url, fetchOptions);
      const data = await response.json();
      
      return {
        success: response.ok,
        output: data,
        raw_output: JSON.stringify(data, null, 2)
      };
    } catch (error) {
      throw new Error(`Direct fetch failed: ${error.message}`);
    }
  };

  const executeCurlBackend = async (curlCommand) => {
    const response = await fetch(backendUrl + '/api/execute-command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: curlCommand })
    });
    
    if (!response.ok) throw new Error(`Backend ${response.status}`);
    return await response.json();
  };

  const executeToolCall = async (toolName, args, currentFs) => {
    switch(toolName) {
      case 'create_directory':
        const newFs = { ...currentFs };
        newFs[args.path] = { type: 'directory', created_at: new Date().toISOString() };
        addLog(`📁 ${args.path}`, 'success');
        return { success: true, filesystem: newFs };

      case 'create_file':
        const fsFile = { ...currentFs };
        fsFile[args.path] = { type: 'file', content: args.content, created_at: new Date().toISOString() };
        addLog(`📄 ${args.path}`, 'success');
        return { success: true, filesystem: fsFile };

      case 'write_to_file':
        const fsWrite = { ...currentFs };
        fsWrite[args.path] = { type: 'file', content: args.content, created_at: new Date().toISOString() };
        addLog(`✏️ ${args.path}`, 'success');
        return { success: true, filesystem: fsWrite };

      case 'execute_command':
        let cmd = args.command;
        if (cmd.includes('YourAgentName')) {
          const name = 'Agent_' + Math.random().toString(36).substring(2, 10);
          cmd = cmd.replace(/YourAgentName/g, name);
          addLog(`🎲 ${name}`, 'success');
        }
        
        addLog(`⚙️ ${cmd}`, 'info');
        
        let result;
        try {
          result = await executeCurlBackend(cmd);
        } catch (e) {
          try {
            result = await executeCurlDirect(cmd);
          } catch (e2) {
            return { success: false, output: e2.message };
          }
        }
        
        if (result.success) {
          let output = typeof result.output === 'object' 
            ? JSON.stringify(result.output, null, 2)
            : result.output;
          
          addLog(`✅ Executed`, 'success');
          setCommandOutputs(prev => [...prev, {
            timestamp: new Date().toLocaleTimeString('id-ID'),
            command: cmd,
            output: output
          }]);
          
          return { success: true, output };
        }
        return { success: false, output: result.error };

      case 'complete_task':
        addLog(`✅ ${args.summary}`, 'success');
        return { success: true, summary: args.summary };

      default:
        return { success: false };
    }
  };

  const callMultiProviderAPI = async (messages, tools) => {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKeys.groq) headers['X-API-Key'] = apiKeys.groq;
    if (apiKeys.gemini) headers['X-Gemini-Key'] = apiKeys.gemini;
    if (apiKeys.openrouter) headers['X-OpenRouter-Key'] = apiKeys.openrouter;
    if (apiKeys.together) headers['X-Together-Key'] = apiKeys.together;

    // Try multi-provider endpoint first
    try {
      const response = await fetch(backendUrl + '/api/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          messages,
          tools,
          temperature: 0.5,
          max_tokens: 1500,
          provider_order: activeProviders
        })
      });

      if (!response.ok) {
        throw new Error(`Multi-provider failed: ${response.status}`);
      }

      const result = await response.json();
      if (result.provider) {
        setCurrentProvider(result.provider);
        addLog(`🔄 Using: ${result.provider}`, 'info');
      }

      return result;
    } catch (multiError) {
      // Fallback to legacy Groq endpoint if multi-provider fails
      addLog(`⚠️ Multi-provider failed, using legacy Groq...`, 'warning');
      
      if (!apiKeys.groq) {
        throw new Error('No Groq API key available for fallback');
      }

      const legacyResponse = await fetch(backendUrl + '/api/groq/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKeys.groq
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages,
          tools,
          temperature: 0.5,
          max_tokens: 1500
        })
      });

      if (!legacyResponse.ok) {
        const err = await legacyResponse.json();
        throw new Error(err.error || 'Legacy API failed');
      }

      const result = await legacyResponse.json();
      setCurrentProvider('groq (legacy)');
      addLog(`🔄 Using: groq (legacy)`, 'info');
      
      return result;
    }
  };

  const executeAgentTask = async () => {
    if (isRunning) return;
    if (!useSkillMode && !instruction.trim()) return alert('Masukkan instruksi!');
    if (useSkillMode && !skillFile) return alert('Upload SKILL.md!');

    setIsRunning(true);
    setVirtualFileSystem({});
    addLog('🚀 Starting...', 'info');
    
    try {
      let systemPrompt = 'Anda adalah autonomous agent. Jalankan task dengan tools.';
      let userPrompt = instruction;

      if (useSkillMode && skillFile) {
        const content = skillFile.content.substring(0, 4000);
        systemPrompt = 'Anda adalah autonomous agent. JALANKAN setiap instruksi dari SKILL.md.';
        userPrompt = `SKILL.md:\n${content}\n\n${instruction || 'Ikuti SKILL.md'}`;
      }

      const tools = [
        { type: 'function', function: { name: 'create_directory', parameters: { type: 'object', properties: { path: { type: 'string' }}, required: ['path']}}},
        { type: 'function', function: { name: 'create_file', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }}, required: ['path', 'content']}}},
        { type: 'function', function: { name: 'write_to_file', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }}, required: ['path', 'content']}}},
        { type: 'function', function: { name: 'execute_command', parameters: { type: 'object', properties: { command: { type: 'string' }}, required: ['command']}}},
        { type: 'function', function: { name: 'complete_task', parameters: { type: 'object', properties: { summary: { type: 'string' }}, required: ['summary']}}}
      ];

      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ];

      let fs = {};
      let iter = 0;

      while (iter < 10) {
        iter++;
        addLog(`🔄 Iter ${iter}`, 'info');

        if (messages.length > 15) {
          const recent = messages.slice(-10);
          messages.length = 0;
          messages.push({ role: 'system', content: systemPrompt });
          messages.push({ role: 'user', content: userPrompt });
          messages.push(...recent);
        }

        const resp = await callMultiProviderAPI(messages, tools);
        const msg = resp.choices[0].message;

        if (msg.content) addThought(msg.content, `Step ${iter}`);

        if (!msg.tool_calls || !msg.tool_calls.length) {
          addLog('✅ Done', 'success');
          break;
        }

        messages.push(msg);

        for (const tc of msg.tool_calls) {
          const fn = tc.function.name;
          const args = JSON.parse(tc.function.arguments);

          const result = await executeToolCall(fn, args, fs);
          
          if (result.filesystem) {
            fs = result.filesystem;
            setVirtualFileSystem(fs);
          }

          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(result)
          });

          if (fn === 'complete_task') {
            addThought(`Done: ${result.summary}`, 'COMPLETE');
            iter = 10;
            break;
          }
        }

        await sleep(1500);
      }

    } catch (error) {
      addLog(`❌ ${error.message}`, 'error');
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

  // Settings Modal Component
  const SettingsModal = () => (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-purple-500/30">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-white">⚙️ API Keys Settings</h2>
          <button onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-white text-2xl">×</button>
        </div>
        
        <div className="space-y-6">
          {/* Groq */}
          <div>
            <label className="block text-purple-200 text-sm font-semibold mb-2">
              Groq API Key
            </label>
            <input
              type="password"
              value={apiKeys.groq}
              onChange={(e) => setApiKeys({...apiKeys, groq: e.target.value})}
              placeholder="gsk_..."
              className="w-full px-4 py-3 bg-white/10 border border-white/30 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <p className="text-xs text-gray-400 mt-1">Get: console.groq.com/keys</p>
          </div>
          
          {/* Gemini */}
          <div>
            <label className="block text-green-200 text-sm font-bold mb-2">
              🔥 Gemini API Key (Recommended!)
            </label>
            <input
              type="password"
              value={apiKeys.gemini}
              onChange={(e) => setApiKeys({...apiKeys, gemini: e.target.value})}
              placeholder="AIza..."
              className="w-full px-4 py-3 bg-white/10 border-2 border-green-500/50 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <p className="text-xs text-green-300 mt-1">✨ 1,500 requests/day FREE • Get: aistudio.google.com/apikey</p>
          </div>
          
          {/* OpenRouter */}
          <div>
            <label className="block text-purple-200 text-sm font-semibold mb-2">
              OpenRouter API Key (Optional)
            </label>
            <input
              type="password"
              value={apiKeys.openrouter}
              onChange={(e) => setApiKeys({...apiKeys, openrouter: e.target.value})}
              placeholder="sk-or-..."
              className="w-full px-4 py-3 bg-white/10 border border-white/30 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <p className="text-xs text-gray-400 mt-1">Get: openrouter.ai/keys</p>
          </div>
          
          {/* Together */}
          <div>
            <label className="block text-purple-200 text-sm font-semibold mb-2">
              Together API Key (Optional)
            </label>
            <input
              type="password"
              value={apiKeys.together}
              onChange={(e) => setApiKeys({...apiKeys, together: e.target.value})}
              placeholder="..."
              className="w-full px-4 py-3 bg-white/10 border border-white/30 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <p className="text-xs text-gray-400 mt-1">Get: together.ai</p>
          </div>
        </div>
        
        <div className="flex gap-3 mt-8">
          <button onClick={handleSaveApiKeys} className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 text-white py-3 rounded-lg font-semibold hover:from-purple-600 hover:to-pink-600">
            💾 Save
          </button>
          <button onClick={() => setShowSettings(false)} className="px-6 bg-gray-600 hover:bg-gray-700 text-white py-3 rounded-lg font-semibold">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );

  if (!isApiKeySet) {
    return (
      <>
        <Head><title>Multi-Provider Agent</title></Head>
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-8 flex items-center justify-center">
          <div className="max-w-md w-full bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 bg-purple-500 rounded-full flex items-center justify-center text-4xl">🤖</div>
            </div>
            <h1 className="text-3xl font-bold text-white text-center mb-2">Multi-Provider Agent</h1>
            <p className="text-purple-200 text-center mb-8">Setup API keys untuk mulai</p>
            
            <button onClick={() => setShowSettings(true)} className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white py-4 rounded-lg font-semibold hover:from-purple-600 hover:to-pink-600 text-lg">
              ⚙️ Setup API Keys
            </button>
            
            <div className="mt-6 p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
              <p className="text-green-200 text-sm text-center">
                💡 Tip: Gunakan <strong>Gemini</strong> untuk 1,500 requests/day gratis!
              </p>
            </div>
          </div>
        </div>
        {showSettings && <SettingsModal />}
      </>
    );
  }

  return (
    <>
      <Head><title>Multi-Provider Agent</title></Head>
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 mb-6 border border-white/20">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-3">
                <div className="text-4xl">🤖</div>
                <div>
                  <h1 className="text-2xl font-bold text-white">Multi-Provider Agent</h1>
                  <p className="text-purple-200 text-sm">
                    Active: {activeProviders.join(', ')} {currentProvider && `• Using: ${currentProvider}`}
                  </p>
                </div>
              </div>
              <button onClick={() => setShowSettings(true)} className="px-4 py-2 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 rounded-lg flex items-center gap-2">
                ⚙️ Settings
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
                <label className="block text-purple-200 text-sm mb-2">Instruksi</label>
                <textarea
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="Tulis instruksi..."
                  className="w-full px-4 py-3 bg-white/10 border border-white/30 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 h-32 resize-none"
                />
              </div>

              <div className="flex gap-2">
                <button onClick={executeAgentTask} disabled={isRunning || (useSkillMode && !skillFile)} className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 text-white py-3 rounded-lg font-semibold hover:from-purple-600 hover:to-pink-600 disabled:opacity-50">
                  {isRunning ? '⚙️ Running...' : '▶️ Run'}
                </button>
                <button onClick={clearLogs} className="px-4 py-3 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg">Clear</button>
              </div>
            </div>

            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
              <h2 className="text-xl font-bold text-white mb-4">📋 Execution Logs</h2>
              <div className="bg-black/30 rounded-lg p-4 h-96 overflow-y-auto font-mono text-sm">
                {logs.length === 0 ? <p className="text-gray-400 text-center mt-10">Waiting...</p> : logs.map((log, idx) => (
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
              <h2 className="text-xl font-bold text-white mb-4">🧠 Reasoning</h2>
              <div className="bg-black/30 rounded-lg p-4 max-h-96 overflow-y-auto">
                {agentThoughts.length === 0 ? <p className="text-gray-400 text-center">Waiting...</p> : agentThoughts.map((t, i) => (
                  <div key={i} className="mb-4 p-4 bg-white/5 rounded-lg border border-purple-500/30">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-purple-400 text-xs">[{t.timestamp}]</span>
                      {t.action && <span className="px-2 py-1 bg-purple-500/30 text-purple-200 text-xs rounded">{t.action}</span>}
                    </div>
                    <p className="text-white text-sm">{t.thought}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
              <h2 className="text-xl font-bold text-white mb-4">⚙️ Command Outputs</h2>
              <div className="bg-black/30 rounded-lg p-4 max-h-96 overflow-y-auto">
                {commandOutputs.length === 0 ? <p className="text-gray-400 text-center">No commands...</p> : (
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
              <h2 className="text-xl font-bold text-white mb-4">📦 File System</h2>
              <div className="bg-black/30 rounded-lg p-4 max-h-96 overflow-y-auto">
                {Object.keys(virtualFileSystem).length === 0 ? <p className="text-gray-400 text-center">No files...</p> : (
                  <div className="space-y-2">
                    {Object.entries(virtualFileSystem).map(([path, data], idx) => (
                      <div key={idx} className="p-3 bg-white/5 rounded border border-green-500/30">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xl">{data.type === 'directory' ? '📁' : '📄'}</span>
                          <span className="text-green-400 font-mono text-xs">{path}</span>
                        </div>
                        {data.content && (
                          <div className="ml-7 text-xs text-gray-400 mt-1 font-mono overflow-x-auto">
                            {data.content.substring(0, 80)}...
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
      
      {showSettings && <SettingsModal />}
    </>
  );
}
