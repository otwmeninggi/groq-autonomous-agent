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

  // ======================
  // Delay helper
  // ======================
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

  // ======================
  // Backend Call + Auto Retry
  // ======================
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
        addLog('⚠ Rate limit terkena. Menunggu 10 detik...', 'warning');
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
        userPrompt =
          'SKILL.md:\n' +
          skillFile.content +
          '\n\nInstruksi: ' +
          (instruction || 'Ikuti SKILL.md');
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
                task_breakdown: {
                  type: 'array',
                  items: { type: 'string' }
                }
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
              (functionArgs.task_breakdown
                ? functionArgs.task_breakdown.length
                : 0) +
              ' langkah',
            'success'
          );

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult)
          });
        }

        // Tambahan delay sebelum request kedua
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

  if (!isApiKeySet) {
    return (
      <>
        <Head><title>Groq Agent</title></Head>
        <div className="min-h-screen flex items-center justify-center bg-black text-white">
          <div className="max-w-md w-full p-8 bg-gray-900 rounded-xl">
            <h1 className="text-2xl mb-4">Groq Agent</h1>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="gsk_..."
              className="w-full p-2 mb-4 bg-gray-800 rounded"
            />
            <button
              onClick={handleApiKeySubmit}
              className="w-full bg-purple-600 p-2 rounded"
            >
              Mulai
            </button>
          </div>
        </div>
      </>
    );
  }

  return null;
}
