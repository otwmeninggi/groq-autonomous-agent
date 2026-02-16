from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import subprocess
import json
import re
import os

app = Flask(__name__)

# Enable CORS for all routes
CORS(app, resources={
    r"/api/*": {
        "origins": "*",
        "methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": ["Content-Type", "X-API-Key"]
    }
})

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"

@app.route('/api/groq/chat', methods=['POST', 'OPTIONS'])
def groq_chat():
    """Proxy endpoint untuk Groq API"""
    if request.method == 'OPTIONS':
        return '', 204
        
    try:
        data = request.get_json()
        api_key = request.headers.get('X-API-Key')
        
        if not api_key:
            return jsonify({'error': 'API Key tidak ditemukan'}), 400
        
        headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json'
        }
        
        response = requests.post(GROQ_API_URL, headers=headers, json=data, timeout=60)
        
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
        return '', 204
    
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
        print(f"📤 Output: {stdout[:200]}...")  # Log first 200 chars
        
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
        'message': 'Backend server is running',
        'port': os.environ.get('PORT', '5000'),
        'endpoints': [
            '/api/groq/chat',
            '/api/execute-command',
            '/api/health'
        ]
    }), 200

@app.route('/', methods=['GET'])
def home():
    """Home endpoint"""
    return jsonify({
        'name': 'Groq Autonomous Agent Backend',
        'version': '2.0.0',
        'status': 'running',
        'new_features': [
            'Execute shell commands (curl, wget)',
            'Real API integration',
            'Command output parsing'
        ]
    }), 200

if __name__ == '__main__':
    # PENTING: Ambil PORT dari environment variable Railway
    port = int(os.environ.get('PORT', 5000))
    
    print("=" * 70)
    print("🚀 Groq Autonomous Agent Backend Server v2.0")
    print("=" * 70)
    print(f"✓ Host: 0.0.0.0")
    print(f"✓ Port: {port} (from environment variable PORT)")
    print(f"✓ Debug: False (Production mode)")
    print(f"✓ CORS: Enabled for all origins")
    print(f"✓ New: /api/execute-command endpoint")
    print("=" * 70)
    print()
    
    # Run server dengan PORT dari Railway
    app.run(
        host='0.0.0.0',
        port=port,
        debug=False,
        use_reloader=False
    )
