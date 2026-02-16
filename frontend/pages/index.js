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

  const logsEndRef = useRef(null);
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;

  useEffect(() => {
    const savedKey = localStorage.getItem('groq_api_key');
    if (savedKey) {
      setApiKey(savedKey);
      setIsApiKeySet(true);
      addLog('✓ API Key loaded from storage', 'success');
    }
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, agentThoughts]);

  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString('id-ID');
    setLogs(prev => [...prev, { timestamp, message, type }]);
  };

  const addThought = (thought, action = null) => {
    setAgentThoughts(prev => [...prev, { 
      timestamp: new Date().toLocaleTimeString('id-ID'), 
      thought, 
      action 
    }]);
  };

  const handleApiKeySubmit = () => {
    if (!apiKey.trim()) {
      alert('Masukkan API key terlebih dahulu!');
      return;
    }
    
    if (!apiKey.startsWith('gsk_')) {
      alert('API key harus diawali dengan "gsk_"');
      return;
    }

    // Langsung simpan tanpa validasi (avoid 429 rate limit)
    setIsApiKeySet(true);
    localStorage.setItem('groq_api_key', apiKey);
    addLog('✓ API Key tersimpan! Siap digunakan.', 'success');
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setSkillFile({
          name: file.name,
          content: event.target.result
        });
        setUseSkillMode(true);
        addLog(`✓ File ${file.name} berhasil diupload`, 'success');
      };
      reader.readAsText(file);
    }
  };

  const callBackendAPI = async (messages, tools = null) => {
    const response = await fetch(`${backendUrl}/api/groq/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: messages,
        temperature: 0.7,
        max_tokens: 2000,
        ...(tools && { tools, tool_choice: 'auto' })
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `Backend Error: ${response.statusText}`);
    }

    return await response.json();
  };

  const executeAgentTask = async () => {
    if (isRunning) return;
    
    if (!useSkillMode && !instruction.trim()) {
      alert('Masukkan instruksi untuk agent!');
      return;
    }

    if (useSkillMode && !skillFile) {
      alert('Upload file SKILL.md terlebih dahulu!');
      return;
    }

    setIsRunning(true);
    addLog('🚀 Agent mulai bekerja...', 'info');
    
    try {
      let systemPrompt = '';
      let userPrompt = '';

      if (useSkillMode && skillFile) {
        systemPrompt = 'Anda adalah autonomous agent yang mengikuti instruksi dari SKILL.md. Baca dan pahami instruksi dengan seksama, lalu eksekusi step by step. Jelaskan reasoning Anda di setiap langkah.';
        userPrompt = `SKILL.md Content:\n\n${skillFile.content}\n\nUser Instruction: ${instruction || 'Ikuti semua langkah dalam SKILL.md'}`;
        addLog('📋 Mode: Menggunakan SKILL.md', 'info');
      } else {
        systemPrompt = 'Anda adalah autonomous agent yang pintar dan mampu reasoning secara mandiri. Analisis task yang diberikan, buat plan, dan jelaskan langkah-langkah yang akan Anda ambil.';
        userPrompt = instruction;
        addLog('🤖 Mode: Autonomous (tanpa SKILL.md)', 'info');
      }

      const tools = [
        {
          type: 'function',
          function: {
            name: 'analyze_task',
            description: 'Analisis task dan buat execution plan',
            parameters: {
              type: 'object',
              properties: {
                task_breakdown: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'List langkah-langkah yang perlu dilakukan'
                }
              },
              required: ['task_breakdown']
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'execute_step',
            description: 'Eksekusi satu langkah dari plan',
            parameters: {
              type: 'object',
              properties: {
                step_number: { type: 'number' },
                action: { type: 'string' },
                result: { type: 'string' }
              },
              required: ['step_number', 'action', 'result']
            }
          }
        }
      ];

      addThought('Menganalisis task dan membuat execution plan...', null);
      
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ];

      const firstResponse = await callBackendAPI(messages, tools);
      const firstMessage = firstResponse.choices[0].message;

      if (firstMessage.content) {
        addThought(firstMessage.content, null);
      }

      if (firstMessage.tool_calls && firstMessage.tool_calls.length > 0) {
        messages.push(firstMessage);

        for (const toolCall of firstMessage.tool_calls) {
          const functionName = toolCall.function.name;
          const functionArgs = JSON.parse(toolCall.function.arguments);

          addLog(`🔧 Agent memanggil tool: ${functionName}`, 'info');
          addThought(`Menggunakan tool: ${functionName}`, JSON.stringify(functionArgs, null, 2));

          let toolResult = {};

          if (functionName === 'analyze_task') {
            toolResult = {
              success: true,
              breakdown: functionArgs.task_breakdown,
              message: 'Task berhasil dianalisis'
            };
            addLog(`✓ Task breakdown: ${functionArgs.task_breakdown.length} langkah`, 'success');
          } else if (functionName === 'execute_step') {
            await new Promise(resolve => setTimeout(resolve, 1000));
            toolResult = {
              success: true,
              step: functionArgs.step_number,
              result: functionArgs.result
            };
            addLog(`✓ Step ${functionArgs.step_number} selesai: ${functionArgs.action}`, 'success');
          }

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult)
          });
        }

        const secondResponse = await callBackendAPI(messages, tools);
        const finalMessage = secondResponse.choices[0].message;

        if (finalMessage.content) {
          addThought(finalMessage.content, 'Final Result');
          addLog('✓ Agent selesai bekerja', 'success');
        }
      } else {
        addLog('✓ Agent selesai bekerja', 'success');
      }

    } catch (error) {
      addLog(`❌ Error: ${error.message}`, 'error');
      addThought('Error occurred during execution', error.message);
    } finally {
      setIsRunning(false);  // ← FIXED: Pakai kurung!
    }
  };

  const clearLogs = () => {
    setLogs([]);
    setAgentThoughts([]);
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
        <Head>
          <title>Groq Autonomous Agent</title>
        </Head>
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-8 flex items-center justify-center">
          <div className="max-w-md w-full bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 bg-purple-500 rounded-full flex items-center justify-center text-4xl">
                🤖
              </div>
            </div>
            <h1 className="text-3xl font-bold text-white text-center mb-2">
              Groq Autonomous Agent
            </h1>
            <p className="text-purple-200 text-center mb-8">
              Masukkan API Key untuk memulai
            </p>
            
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="gsk_..."
              className="w-full px-4 py-3 bg-white/10 border border-white/30 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 mb-4"
              onKeyPress={(e) => e.key === 'Enter' && handleApiKeySubmit()}
            />
            
            <button
              onClick={handleApiKeySubmit}
              disabled={!apiKey.trim()}
              className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white py-3 rounded-lg font-semibold hover:from-purple-600 hover:to-pink-600 transition-all disabled:opacity-50"
            >
              Simpan & Mulai
            </button>

            <p className="text-xs text-purple-300 text-center mt-4">
              Belum punya API key? Daftar di <a href="https://console.groq.com" target="_blank" className="underline">console.groq.com</a>
            </p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Groq Autonomous Agent</title>
      </Head>
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-6">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 mb-6 border border-white/20">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-3">
                <div className="text-4xl">🤖</div>
                <div>
                  <h1 className="text-2xl font-bold text-white">Groq Autonomous Agent</h1>
                  <p className="text-purple-200 text-sm">Powered by Llama 3.3 70B</p>
                </div>
              </div>
              <button
                onClick={resetApiKey}
                className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg transition-all"
              >
                Reset API Key
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Control Panel */}
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
              <h2 className="text-xl font-bold text-white mb-4">Control Panel</h2>
              
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setUseSkillMode(false)}
                  className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${
                    !useSkillMode 
                      ? 'bg-purple-500 text-white' 
                      : 'bg-white/10 text-purple-200 hover:bg-white/20'
                  }`}
                >
                  ⚡ Autonomous
                </button>
                <button
                  onClick={() => setUseSkillMode(true)}
                  className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${
                    useSkillMode 
                      ? 'bg-purple-500 text-white' 
                      : 'bg-white/10 text-purple-200 hover:bg-white/20'
                  }`}
                >
                  📄 Skill-based
                </button>
              </div>

              {useSkillMode && (
                <div className="mb-4">
                  <label className="block text-purple-200 text-sm mb-2">Upload SKILL.md</label>
                  <input
                    type="file"
                    accept=".md,.txt"
                    onChange={handleFileUpload}
                    className="hidden"
                    id="file-upload"
                  />
                  <label
                    htmlFor="file-upload"
                    className="flex items-center justify-center gap-2 px-4 py-3 bg-white/10 border-2 border-dashed border-white/30 rounded-lg text-purple-200 hover:bg-white/20 cursor-pointer transition-all"
                  >
                    📁 {skillFile ? skillFile.name : 'Pilih file SKILL.md'}
                  </label>
                </div>
              )}

              <div className="mb-4">
                <label className="block text-purple-200 text-sm mb-2">
                  {useSkillMode ? 'Instruksi Tambahan (Opsional)' : 'Instruksi untuk Agent'}
                </label>
                <textarea
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder={useSkillMode 
                    ? "Tambahkan instruksi khusus..."
                    : "Contoh: Analisis trend crypto terbaru..."
                  }
                  className="w-full px-4 py-3 bg-white/10 border border-white/30 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 h-32 resize-none"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={executeAgentTask}
                  disabled={isRunning || (!useSkillMode && !instruction.trim()) || (useSkillMode && !skillFile)}
                  className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 text-white py-3 rounded-lg font-semibold hover:from-purple-600 hover:to-pink-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isRunning ? (
                    <>
                      <span className="inline-block w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                      Running...
                    </>
                  ) : (
                    <>▶️ Jalankan Agent</>
                  )}
                </button>
                <button
                  onClick={clearLogs}
                  className="px-4 py-3 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg transition-all"
                >
                  🗑️
                </button>
              </div>
            </div>

            {/* Logs */}
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
              <h2 className="text-xl font-bold text-white mb-4">Activity Logs</h2>
              <div className="bg-black/30 rounded-lg p-4 h-96 overflow-y-auto font-mono text-sm">
                {logs.length === 0 ? (
                  <p className="text-gray-400 text-center mt-10">Tidak ada activity logs...</p>
                ) : (
                  logs.map((log, idx) => (
                    <div key={idx} className={`mb-2 ${
                      log.type === 'error' ? 'text-red-400' :
                      log.type === 'success' ? 'text-green-400' :
                      log.type === 'warning' ? 'text-yellow-400' :
                      'text-blue-300'
                    }`}>
                      <span className="text-gray-500">[{log.timestamp}]</span> {log.message}
                    </div>
                  ))
                )}
                <div ref={logsEndRef} />
              </div>
            </div>
          </div>

          {/* Agent Thoughts */}
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 mt-6 border border-white/20">
            <h2 className="text-xl font-bold text-white mb-4">🧠 Agent Reasoning</h2>
            <div className="bg-black/30 rounded-lg p-4 max-h-96 overflow-y-auto">
              {agentThoughts.length === 0 ? (
                <p className="text-gray-400 text-center">Agent belum mulai berpikir...</p>
              ) : (
                agentThoughts.map((thought, idx) => (
                  <div key={idx} className="mb-4 p-4 bg-white/5 rounded-lg border border-purple-500/30">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-purple-400 font-semibold">[{thought.timestamp}]</span>
                      {thought.action && (
                        <span className="px-2 py-1 bg-purple-500/30 text-purple-200 text-xs rounded">
                          {thought.action}
                        </span>
                      )}
                    </div>
                    <p className="text-white whitespace-pre-wrap">{thought.thought}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
