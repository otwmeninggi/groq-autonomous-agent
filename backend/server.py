from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
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

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'ok',
        'message': 'Backend server is running',
        'port': os.environ.get('PORT', '5000')
    }), 200

@app.route('/', methods=['GET'])
def home():
    """Home endpoint"""
    return jsonify({
        'name': 'Groq Autonomous Agent Backend',
        'version': '1.0.0',
        'status': 'running'
    }), 200

if __name__ == '__main__':
    # PENTING: Ambil PORT dari environment variable Railway
    port = int(os.environ.get('PORT', 5000))
    
    print("=" * 70)
    print("🚀 Groq Autonomous Agent Backend Server")
    print("=" * 70)
    print(f"✓ Host: 0.0.0.0")
    print(f"✓ Port: {port} (from environment variable PORT)")
    print(f"✓ Debug: False (Production mode)")
    print(f"✓ CORS: Enabled for all origins")
    print("=" * 70)
    print()
    
    # Run server dengan PORT dari Railway
    app.run(
        host='0.0.0.0',
        port=port,          # ← PAKAI PORT DARI ENVIRONMENT!
        debug=False,        # ← PRODUCTION MODE!
        use_reloader=False  # ← DISABLE RELOADER untuk production
    )
