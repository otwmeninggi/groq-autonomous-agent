from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import subprocess
import json
import os

app = Flask(__name__)

# Enable CORS for all routes - PERMISSIVE CONFIG
CORS(app, resources={
    r"/*": {
        "origins": "*",
        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        "allow_headers": ["*"],
        "expose_headers": ["*"],
        "supports_credentials": False,
        "max_age": 3600
    }
})

# Add CORS headers to every response
@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', '*')
    response.headers.add('Access-Control-Allow-Methods', '*')
    return response

# ====== PROVIDER CONFIGURATIONS ======
PROVIDERS = {
    'groq': {
        'url': 'https://api.groq.com/openai/v1/chat/completions',
        'model': 'llama-3.3-70b-versatile',
        'header_format': lambda key: {'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'}
    },
    'gemini': {
        'url': 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent',
        'model': 'gemini-2.0-flash-exp',
        'header_format': lambda key: {'Content-Type': 'application/json'}
    },
    'openrouter': {
        'url': 'https://openrouter.ai/api/v1/chat/completions',
        'model': 'meta-llama/llama-3.3-70b-instruct:free',
        'header_format': lambda key: {'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'}
    },
    'together': {
        'url': 'https://api.together.xyz/v1/chat/completions',
        'model': 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
        'header_format': lambda key: {'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'}
    }
}

def convert_to_gemini_format(messages, tools=None):
    """Convert OpenAI format to Gemini format"""
    contents = []
    
    for msg in messages:
        role = msg['role']
        content = msg.get('content', '')
        
        # Map roles
        if role == 'system':
            # Gemini doesn't have system role, prepend to first user message
            continue
        elif role == 'assistant':
            role = 'model'
        elif role == 'tool':
            # Handle tool results
            continue
            
        if content:
            contents.append({
                'role': role,
                'parts': [{'text': content}]
            })
    
    # Prepend system message to first user message
    system_msg = next((m['content'] for m in messages if m['role'] == 'system'), None)
    if system_msg and contents and contents[0]['role'] == 'user':
        contents[0]['parts'][0]['text'] = f"{system_msg}\n\n{contents[0]['parts'][0]['text']}"
    
    body = {'contents': contents}
    
    # Add tools if provided
    if tools:
        function_declarations = []
        for tool in tools:
            if tool['type'] == 'function':
                func = tool['function']
                function_declarations.append({
                    'name': func['name'],
                    'description': func.get('description', ''),
                    'parameters': func.get('parameters', {})
                })
        
        if function_declarations:
            body['tools'] = [{'function_declarations': function_declarations}]
    
    return body

def convert_gemini_response(gemini_response):
    """Convert Gemini response to OpenAI format"""
    try:
        candidate = gemini_response['candidates'][0]
        content_part = candidate['content']['parts'][0]
        
        # Check if it's a function call
        if 'functionCall' in content_part:
            func_call = content_part['functionCall']
            return {
                'choices': [{
                    'message': {
                        'role': 'assistant',
                        'content': None,
                        'tool_calls': [{
                            'id': f"call_{func_call['name']}",
                            'type': 'function',
                            'function': {
                                'name': func_call['name'],
                                'arguments': json.dumps(func_call.get('args', {}))
                            }
                        }]
                    }
                }]
            }
        else:
            # Regular text response
            return {
                'choices': [{
                    'message': {
                        'role': 'assistant',
                        'content': content_part.get('text', '')
                    }
                }]
            }
    except Exception as e:
        print(f"Error converting Gemini response: {e}")
        return {
            'choices': [{
                'message': {
                    'role': 'assistant',
                    'content': str(gemini_response)
                }
            }]
        }

@app.route('/api/chat', methods=['POST', 'OPTIONS'])
def multi_provider_chat():
    """Multi-provider chat endpoint with auto-fallback"""
    if request.method == 'OPTIONS':
        response = jsonify({'status': 'ok'})
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', '*')
        response.headers.add('Access-Control-Allow-Methods', '*')
        return response, 200
    
    try:
        data = request.get_json()
        
        # Get API keys from headers
        api_keys = {
            'groq': request.headers.get('X-API-Key') or request.headers.get('X-Groq-Key'),
            'gemini': request.headers.get('X-Gemini-Key'),
            'openrouter': request.headers.get('X-OpenRouter-Key'),
            'together': request.headers.get('X-Together-Key')
        }
        
        # Get preferred provider order (default: groq -> gemini -> openrouter -> together)
        provider_order = data.get('provider_order', ['groq', 'gemini', 'openrouter', 'together'])
        
        messages = data.get('messages', [])
        tools = data.get('tools')
        temperature = data.get('temperature', 0.7)
        max_tokens = data.get('max_tokens', 1500)
        
        last_error = None
        
        # Try each provider in order
        for provider_name in provider_order:
            api_key = api_keys.get(provider_name)
            
            if not api_key:
                print(f"⏭️  Skipping {provider_name}: No API key provided")
                continue
            
            provider = PROVIDERS[provider_name]
            print(f"🔄 Trying provider: {provider_name}")
            
            try:
                if provider_name == 'gemini':
                    # Special handling for Gemini
                    gemini_body = convert_to_gemini_format(messages, tools)
                    gemini_body['generationConfig'] = {
                        'temperature': temperature,
                        'maxOutputTokens': max_tokens
                    }
                    
                    url = f"{provider['url']}?key={api_key}"
                    headers = provider['header_format'](api_key)
                    
                    response = requests.post(url, headers=headers, json=gemini_body, timeout=60)
                    
                    if response.status_code == 200:
                        gemini_response = response.json()
                        openai_format = convert_gemini_response(gemini_response)
                        print(f"✅ Success with {provider_name}")
                        return jsonify({
                            'provider': provider_name,
                            'model': provider['model'],
                            **openai_format
                        }), 200
                    else:
                        raise Exception(f"Gemini API error: {response.text}")
                
                else:
                    # OpenAI-compatible providers (Groq, OpenRouter, Together)
                    headers = provider['header_format'](api_key)
                    
                    body = {
                        'model': provider['model'],
                        'messages': messages,
                        'temperature': temperature,
                        'max_tokens': max_tokens
                    }
                    
                    if tools:
                        body['tools'] = tools
                        body['tool_choice'] = 'auto'
                    
                    response = requests.post(provider['url'], headers=headers, json=body, timeout=60)
                    
                    if response.status_code == 200:
                        result = response.json()
                        result['provider'] = provider_name
                        result['model'] = provider['model']
                        print(f"✅ Success with {provider_name}")
                        return jsonify(result), 200
                    else:
                        raise Exception(f"{provider_name} API error: {response.text}")
            
            except Exception as e:
                last_error = str(e)
                print(f"❌ {provider_name} failed: {last_error}")
                continue
        
        # All providers failed
        return jsonify({
            'error': f'All providers failed. Last error: {last_error}',
            'tried_providers': provider_order
        }), 500
        
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500

@app.route('/api/groq/chat', methods=['POST', 'OPTIONS'])
def groq_chat_legacy():
    """Legacy endpoint for backward compatibility"""
    if request.method == 'OPTIONS':
        response = jsonify({'status': 'ok'})
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', '*')
        response.headers.add('Access-Control-Allow-Methods', '*')
        return response, 200
    
    try:
        data = request.get_json()
        api_key = request.headers.get('X-API-Key')
        
        if not api_key:
            return jsonify({'error': 'API Key tidak ditemukan'}), 400
        
        headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json'
        }
        
        response = requests.post(PROVIDERS['groq']['url'], headers=headers, json=data, timeout=60)
        
        if response.status_code == 200:
            return jsonify(response.json()), 200
        else:
            return jsonify({
                'error': f'Groq API Error: {response.text}',
                'status_code': response.status_code
            }), response.status_code
            
    except requests.exceptions.Timeout:
        return jsonify({'error': 'Request timeout'}), 504
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500

@app.route('/api/execute-command', methods=['POST', 'OPTIONS'])
def execute_command():
    """Execute shell command (curl, wget, etc)"""
    if request.method == 'OPTIONS':
        response = jsonify({'status': 'ok'})
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', '*')
        response.headers.add('Access-Control-Allow-Methods', '*')
        return response, 200
    
    try:
        data = request.get_json()
        command = data.get('command', '')
        
        if not command:
            return jsonify({'error': 'Command tidak boleh kosong'}), 400
        
        # Security: hanya allow curl, wget, dan beberapa command safe lainnya
        allowed_commands = ['curl', 'wget', 'echo', 'cat']
        command_name = command.split()[0]
        
        if command_name not in allowed_commands:
            return jsonify({
                'error': f'Command "{command_name}" tidak diizinkan. Hanya: {", ".join(allowed_commands)}'
            }), 403
        
        print(f"🚀 Executing command: {command}")
        
        # Execute command
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=30
        )
        
        stdout = result.stdout.strip()
        stderr = result.stderr.strip()
        
        # Try parse JSON response jika ada
        response_data = None
        try:
            response_data = json.loads(stdout)
        except:
            response_data = stdout
        
        print(f"✅ Command executed successfully")
        print(f"📤 Output: {stdout[:200]}...")
        
        return jsonify({
            'success': result.returncode == 0,
            'command': command,
            'output': response_data,
            'raw_output': stdout,
            'error': stderr if stderr else None,
            'return_code': result.returncode
        }), 200
        
    except subprocess.TimeoutExpired:
        return jsonify({
            'success': False,
            'error': 'Command timeout (> 30 detik)'
        }), 504
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Error executing command: {str(e)}'
        }), 500

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'ok',
        'message': 'Multi-provider backend is running',
        'version': '3.0.0',
        'port': os.environ.get('PORT', '5000'),
        'providers': list(PROVIDERS.keys()),
        'endpoints': [
            '/api/chat (multi-provider)',
            '/api/groq/chat (legacy)',
            '/api/execute-command',
            '/api/health'
        ]
    }), 200

@app.route('/', methods=['GET'])
def home():
    """Home endpoint"""
    return jsonify({
        'name': 'Groq Autonomous Agent Backend',
        'version': '3.0.0 - Multi-Provider',
        'status': 'running',
        'features': [
            'Multi-provider support (Groq, Gemini, OpenRouter, Together)',
            'Auto-fallback when rate limited',
            'Execute shell commands (curl, wget)',
            'Real API integration'
        ],
        'providers': {
            'groq': 'Llama 3.3 70B Versatile',
            'gemini': 'Gemini 2.0 Flash',
            'openrouter': 'Llama 3.3 70B (Free)',
            'together': 'Llama 3.1 70B Turbo'
        }
    }), 200

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    
    print("=" * 70)
    print("🚀 Multi-Provider Autonomous Agent Backend v3.0")
    print("=" * 70)
    print(f"✓ Host: 0.0.0.0")
    print(f"✓ Port: {port}")
    print(f"✓ Providers: Groq, Gemini, OpenRouter, Together")
    print(f"✓ Auto-fallback: Enabled")
    print("=" * 70)
    print()
    
    app.run(
        host='0.0.0.0',
        port=port,
        debug=False,
        use_reloader=False
    )
