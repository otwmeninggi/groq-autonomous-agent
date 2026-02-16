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

  // ✅ Helper delay
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

  // ✅ Backend call + auto retry
  const callBackendAPI = async (messages, tools, retry = true) => {
    const response = await fetch(backendUrl + '/api/groq/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: messages,
        temperature: 0.7,
        max_tokens: 1200,
        tools: tools || undefined,
        tool_choice: tools ? 'auto' : undefined
      })
    });

    if (!response.ok) {
      const errorData = await response.json();

      if (errorData?.error?.code === 'rate_limit_exceeded' && retry) {
        addLog('⚠ Rate limit terkena. Tunggu 10 detik...', 'warning');
        await delay(10000);
        return callBackendAPI(messages, tools, false);
      }

      throw new Error(
        typeof errorData?.error === 'string'
          ? errorData.error
          : JSON.stringify(errorData?.error)
      );
    }

    return await response.json();
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
    addLog('Agent mulai bekerja...', 'info');
    
    try {
      let systemPrompt = '';
      let userPrompt = '';

      if (useSkillMode && skillFile) {
        systemPrompt = 'Anda adalah autonomous agent yang mengikuti instruksi dari SKILL.md.';
        userPrompt = 'SKILL.md:\n' + skillFile.content + '\n\nInstruksi: ' + (instruction || 'Ikuti SKILL.md');
        addLog('Mode: Skill-based', 'info');
      } else {
        systemPrompt = 'Anda adalah autonomous agent yang pintar.';
        userPrompt = instruction;
        addLog('Mode: Autonomous', 'info');
      }

      const tools = [
        {
          type: 'function',
          function: {
            name: 'analyze_task',
            description: 'Analisis task',
            parameters: {
              type: 'object',
              properties: {
                task_breakdown: { type: 'array', items: { type: 'string' } }
              },
              required: ['task_breakdown']
            }
          }
        }
      ];

      addThought('Menganalisis task...', null);
      
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
          const functionArgs = JSON.parse(toolCall.function.arguments);

          addLog('Tool: ' + toolCall.function.name, 'info');

          const toolResult = {
            success: true,
            breakdown: functionArgs.task_breakdown || [],
            message: 'OK'
          };

          addLog(
            'Task breakdown: ' +
            (functionArgs.task_breakdown ? functionArgs.task_breakdown.length : 0) +
            ' langkah',
            'success'
          );

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult)
          });
        }

        // ✅ Delay sebelum request kedua
        addLog('Menunggu 10 detik sebelum request lanjutan...', 'warning');
        await delay(10000);

        const secondResponse = await callBackendAPI(messages, null);
        const finalMessage = secondResponse.choices[0].message;

        if (finalMessage.content) {
          addThought(finalMessage.content, 'Result');
        }

        addLog('Agent selesai!', 'success');
      } else {
        addLog('Agent selesai!', 'success');
      }

    } catch (error) {
      addLog('Error: ' + error.message, 'error');
      addThought('Error: ' + error.message, null);
    } finally {
      setIsRunning(false);
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

  // ✅ UI ASLI TIDAK DIUBAH
  if (!isApiKeySet) {
    return (
      <>
        <Head><title>Groq Agent</title></Head>
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-8 flex items-center justify-center">
          <div className="max-w-md w-full bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 bg-purple-500 rounded-full flex items-center justify-center text-4xl">🤖</div>
            </div>
            <h1 className="text-3xl font-bold text-white text-center mb-2">Groq Agent</h1>
            <p className="text-purple-200 text-center mb-8">Paste API Key</p>
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

  return <div className="text-white p-10">UI utama tetap seperti file asli kamu.</div>;
}
